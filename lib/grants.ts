import { admin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/format";
import type { Profile } from "@/lib/auth";

export type GrantCheck =
  | {
      ok: true;
      grant: { id: string; token: string; doc_types: string[]; expires_at: string; revoked_at: string | null };
      application: { id: string; renter_id: string; status: string };
      listing: { id: string; address: string; agency_id: string };
    }
  | { ok: false; reason: "not_found" | "forbidden" | "revoked" | "expired" };

/** Checks an agent may use a share token: right agency, not revoked, not expired. */
export async function checkGrantForAgent(token: string, agent: Profile): Promise<GrantCheck> {
  if (!isUuid(token)) return { ok: false, reason: "not_found" };
  const db = admin();
  const { data: grant } = await db
    .from("share_grants")
    .select("id, token, doc_types, expires_at, revoked_at, application_id")
    .eq("token", token)
    .maybeSingle();
  if (!grant) return { ok: false, reason: "not_found" };

  const { data: application } = await db
    .from("applications")
    .select("id, renter_id, status, listing_id")
    .eq("id", grant.application_id)
    .maybeSingle();
  if (!application) return { ok: false, reason: "not_found" };

  const { data: listing } = await db
    .from("listings")
    .select("id, address, agency_id")
    .eq("id", application.listing_id)
    .maybeSingle();
  if (!listing) return { ok: false, reason: "not_found" };

  if (agent.role !== "agent" || !agent.agency_id || listing.agency_id !== agent.agency_id) {
    return { ok: false, reason: "forbidden" };
  }
  if (grant.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(grant.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };

  return { ok: true, grant, application, listing };
}

export const REASON_TEXT: Record<string, string> = {
  not_found: "This link doesn't exist.",
  forbidden: "You don't have access to this application.",
  revoked: "Access revoked by applicant",
  expired: "This share link has expired.",
};
