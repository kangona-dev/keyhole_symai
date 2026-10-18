"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { getProfile, homeFor, requireRole } from "@/lib/auth";
import { parseQuestions, xrayQuestion } from "@/lib/xray-rules";
import { isUuid } from "@/lib/format";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { drainStorageCleanup } from "@/lib/storage-cleanup";

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// ---------- Auth ----------

export async function signUp(formData: FormData) {
  const name = str(formData, "name");
  const email = str(formData, "email").toLowerCase();
  const password = str(formData, "password");
  const role = str(formData, "role") === "agent" ? "agent" : "renter";
  const agencyId = role === "agent" ? str(formData, "agency_id") : "";

  if (!name || !email || password.length < 6) {
    redirect("/signup?error=" + encodeURIComponent("Enter your name, email and a password of at least 6 characters."));
  }
  if (role === "agent" && !isUuid(agencyId)) {
    redirect("/signup?error=" + encodeURIComponent("Agents need to pick an agency."));
  }
  if (!(await rateLimit(`signup:ip:${await clientIp()}`, LIMITS.signupPerIp))) {
    redirect("/signup?error=" + encodeURIComponent("Too many sign-ups from your network. Please try again later."));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { role, agency_id: agencyId, display_name: name } },
  });
  if (error) redirect("/signup?error=" + encodeURIComponent(error.message));

  if (data.user) {
    // Make sure the profile exists even if the database trigger is missing.
    await admin()
      .from("profiles")
      .upsert(
        { id: data.user.id, role, agency_id: agencyId || null, display_name: name },
        { onConflict: "id" },
      );
  }
  if (!data.session) {
    redirect(
      "/login?error=" +
        encodeURIComponent("Account created. Turn off 'Confirm email' in Supabase, or confirm your email, then sign in."),
    );
  }
  redirect(homeFor(role));
}

export async function signIn(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = str(formData, "password");
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`login:ip:${await clientIp()}`, LIMITS.loginPerIp),
    rateLimit(`login:email:${email}`, LIMITS.loginPerEmail),
  ]);
  if (!ipOk || !emailOk) {
    redirect("/login?error=" + encodeURIComponent("Too many sign-in attempts. Please wait 15 minutes and try again."));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=" + encodeURIComponent(error.message));
  const profile = await getProfile();
  redirect(profile ? homeFor(profile.role) : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------- Agent ----------

export async function createListing(formData: FormData) {
  const agent = await requireRole("agent");
  if (!agent.agency_id) redirect("/agent?error=" + encodeURIComponent("Your account has no agency."));
  const address = str(formData, "address");
  const rent = parseInt(str(formData, "weekly_rent"), 10);
  const questions = parseQuestions(str(formData, "questions"));
  if (!address) redirect("/agent?error=" + encodeURIComponent("Add an address."));

  const db = admin();
  const { data: listing, error } = await db
    .from("listings")
    .insert({
      agency_id: agent.agency_id,
      created_by: agent.id,
      address,
      weekly_rent: Number.isFinite(rent) ? rent : null,
    })
    .select("id")
    .single();
  if (error || !listing) redirect("/agent?error=" + encodeURIComponent(error?.message ?? "Couldn't save the listing."));

  if (questions.length > 0) {
    await db.from("listing_questions").insert(
      questions.map((q, i) => ({
        listing_id: listing.id,
        position: i,
        question: q,
        flagged_reason: xrayQuestion(q).rule?.reason ?? null,
      })),
    );
  }
  revalidatePath("/agent");
  redirect(`/agent/listings/${listing.id}`);
}

async function agentOwnsListing(agencyId: string | null, listingId: string) {
  if (!agencyId || !isUuid(listingId)) return false;
  const { data } = await admin().from("listings").select("agency_id").eq("id", listingId).maybeSingle();
  return !!data && data.agency_id === agencyId;
}

/** Replaces a listing's questions with the cleaned set from Form X-ray. */
export async function saveCleanQuestions(listingId: string, questions: string[]) {
  const agent = await requireRole("agent");
  if (!(await agentOwnsListing(agent.agency_id, listingId))) {
    return { ok: false, message: "You can only edit your own agency's listings." };
  }
  const db = admin();
  const clean = questions.map((q) => q.trim()).filter((q) => q.length > 0).slice(0, 100);
  await db.from("listing_questions").delete().eq("listing_id", listingId);
  if (clean.length > 0) {
    const { error } = await db.from("listing_questions").insert(
      clean.map((q, i) => ({
        listing_id: listingId,
        position: i,
        question: q,
        flagged_reason: xrayQuestion(q).rule?.reason ?? null,
      })),
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/agent/listings/${listingId}`);
  return { ok: true, message: `Saved ${clean.length} questions to the listing.` };
}

/**
 * Makes one applicant the listing's preferred applicant and unlocks their ID.
 * Runs in one database transaction: any previous preferred applicant goes back
 * to submitted and their ID is locked again, and a unique index guarantees
 * there's never more than one.
 */
export async function markPreferred(formData: FormData) {
  const agent = await requireRole("agent");
  const applicationId = str(formData, "application_id");
  if (!isUuid(applicationId)) redirect("/agent");
  const { data, error } = await admin().rpc("set_preferred_applicant", {
    p_application: applicationId,
    p_agent: agent.id,
  });
  if (error) console.error("set_preferred_applicant failed", error);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; listing_id?: string };
  if (!result.listing_id) redirect("/agent");
  after(() => drainStorageCleanup(admin(), 1));
  revalidatePath(`/agent/listings/${result.listing_id}`);
  redirect(`/agent/listings/${result.listing_id}`);
}

/** Declines an application: sharing stops now, and it's deleted automatically after 30 days. */
export async function declineApplication(formData: FormData) {
  const agent = await requireRole("agent");
  const applicationId = str(formData, "application_id");
  const page = str(formData, "page");
  if (!isUuid(applicationId)) redirect("/agent");
  const { data, error } = await admin().rpc("decline_application", {
    p_application: applicationId,
    p_agent: agent.id,
  });
  if (error) console.error("decline_application failed", error);
  const result = (data ?? {}) as { ok?: boolean; listing_id?: string };
  if (!result.listing_id) redirect("/agent");
  after(() => drainStorageCleanup(admin(), 1));
  revalidatePath(`/agent/listings/${result.listing_id}`);
  redirect(`/agent/listings/${result.listing_id}${/^\d+$/.test(page) ? `?page=${page}` : ""}`);
}

// ---------- Renter ----------

export async function applyToListing(formData: FormData) {
  const renter = await requireRole("renter");
  const listingId = str(formData, "listing_id");
  if (!isUuid(listingId)) redirect("/renter");
  const db = admin();

  const { data: questions } = await db
    .from("listing_questions")
    .select("id, question")
    .eq("listing_id", listingId)
    .order("position");
  const answers: Record<string, string> = {};
  for (const q of questions ?? []) {
    const value = str(formData, `q_${q.id}`);
    if (value) answers[q.question] = value.slice(0, 1000);
  }

  // Insert, or return the existing application, plus its share grant, in one
  // transaction. A double-clicked Apply just lands on the same application.
  const { data, error } = await db.rpc("apply_to_listing", {
    p_listing: listingId,
    p_renter: renter.id,
    p_answers: answers,
  });
  const result = (data ?? {}) as { ok?: boolean; reason?: string; application_id?: string };
  if (error || !result.ok || !result.application_id) {
    if (error) console.error("apply_to_listing failed", error);
    redirect(`/renter/listings/${listingId}?error=` + encodeURIComponent("Couldn't apply. Please try again."));
  }
  revalidatePath("/renter");
  redirect(`/renter/applications/${result.application_id}`);
}

async function renterOwnsApplication(renterId: string, applicationId: string) {
  if (!isUuid(applicationId)) return false;
  const { data } = await admin().from("applications").select("renter_id").eq("id", applicationId).maybeSingle();
  return !!data && data.renter_id === renterId;
}

export async function revokeAccess(formData: FormData) {
  const renter = await requireRole("renter");
  const applicationId = str(formData, "application_id");
  if (!(await renterOwnsApplication(renter.id, applicationId))) redirect("/renter");
  await admin()
    .from("share_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("application_id", applicationId);
  // The database trigger pushes the revoke to the agent's open viewer and
  // queues the stamped copies for deletion; remove those files straight away.
  after(() => drainStorageCleanup(admin(), 1));
  revalidatePath(`/renter/applications/${applicationId}`);
  redirect(`/renter/applications/${applicationId}`);
}

export async function restoreAccess(formData: FormData) {
  const renter = await requireRole("renter");
  const applicationId = str(formData, "application_id");
  if (!(await renterOwnsApplication(renter.id, applicationId))) redirect("/renter");
  await admin()
    .from("share_grants")
    .update({
      revoked_at: null,
      expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    })
    .eq("application_id", applicationId);
  revalidatePath(`/renter/applications/${applicationId}`);
  redirect(`/renter/applications/${applicationId}`);
}

export async function deleteDocument(formData: FormData) {
  const renter = await requireRole("renter");
  const docId = str(formData, "document_id");
  if (!isUuid(docId)) redirect("/renter/profile");
  const db = admin();
  const { data: doc } = await db
    .from("documents")
    .select("id, owner_id, storage_path")
    .eq("id", docId)
    .maybeSingle();
  if (doc && doc.owner_id === renter.id) {
    await db.storage.from("documents").remove([doc.storage_path]);
    // Deleting the row also deletes its stamped copies; the trigger queues
    // their files (and this one, in case the remove above failed).
    await db.from("documents").delete().eq("id", docId);
    after(() => drainStorageCleanup(admin(), 1));
  }
  revalidatePath("/renter/profile");
  redirect("/renter/profile");
}
