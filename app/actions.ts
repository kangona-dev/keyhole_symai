"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { getProfile, homeFor, requireRole } from "@/lib/auth";
import { parseQuestions, xrayQuestion } from "@/lib/xray-rules";
import { isUuid } from "@/lib/format";

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

export async function markPreferred(formData: FormData) {
  const agent = await requireRole("agent");
  const applicationId = str(formData, "application_id");
  if (!isUuid(applicationId)) redirect("/agent");
  const db = admin();
  const { data: app } = await db
    .from("applications")
    .select("id, listing_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app || !(await agentOwnsListing(agent.agency_id, app.listing_id))) redirect("/agent");

  await db.from("applications").update({ status: "preferred" }).eq("id", applicationId);
  await db
    .from("share_grants")
    .update({ doc_types: ["payslip", "reference", "id"] })
    .eq("application_id", applicationId);
  revalidatePath(`/agent/listings/${app.listing_id}`);
  redirect(`/agent/listings/${app.listing_id}`);
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

  const { data: existing } = await db
    .from("applications")
    .select("id")
    .eq("listing_id", listingId)
    .eq("renter_id", renter.id)
    .maybeSingle();
  if (existing) redirect(`/renter/applications/${existing.id}`);

  const { data: app, error } = await db
    .from("applications")
    .insert({ listing_id: listingId, renter_id: renter.id, answers })
    .select("id")
    .single();
  if (error || !app) redirect(`/renter/listings/${listingId}?error=` + encodeURIComponent(error?.message ?? "Couldn't apply."));

  await db.from("share_grants").insert({ application_id: app.id, doc_types: ["payslip", "reference"] });
  revalidatePath("/renter");
  redirect(`/renter/applications/${app.id}`);
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
    await db.from("documents").delete().eq("id", docId);
  }
  revalidatePath("/renter/profile");
  redirect("/renter/profile");
}
