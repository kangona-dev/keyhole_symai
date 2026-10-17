import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";

export type Role = "renter" | "agent";

export type Profile = {
  id: string;
  email: string;
  role: Role;
  agency_id: string | null;
  display_name: string;
  agency_name: string | null;
};

/** Returns the signed-in user's profile, or null if signed out. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const db = admin();
  let { data: profile } = await db
    .from("profiles")
    .select("id, role, agency_id, display_name, agencies(name)")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    // Account created before the database trigger existed: build the profile now.
    const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
    const role: Role = meta.role === "agent" ? "agent" : "renter";
    await db.from("profiles").upsert({
      id: user.id,
      role,
      agency_id: role === "agent" && meta.agency_id ? meta.agency_id : null,
      display_name: meta.display_name || (user.email ?? "").split("@")[0],
    });
    const again = await db
      .from("profiles")
      .select("id, role, agency_id, display_name, agencies(name)")
      .eq("id", user.id)
      .maybeSingle();
    profile = again.data;
  }
  if (!profile) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = profile as any;
  const agency = Array.isArray(p.agencies) ? p.agencies[0] : p.agencies;
  return {
    id: p.id,
    email: user.email ?? "",
    role: p.role,
    agency_id: p.agency_id,
    display_name: p.display_name,
    agency_name: agency?.name ?? null,
  };
}

export function homeFor(role: Role) {
  return role === "agent" ? "/agent" : "/renter";
}

/** Use at the top of protected pages and actions. */
export async function requireRole(role: Role): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== role) redirect(homeFor(profile.role));
  return profile;
}
