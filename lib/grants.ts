import { admin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/format";
import type { Profile } from "@/lib/auth";

export type GrantDocument = {
  id: string;
  type: string;
  storage_path: string;
  content_type: string;
  /** Path of this agent's cached watermarked copy in the 'stamped' bucket, if one exists. */
  stamped_path: string | null;
};

export type GrantCheck =
  | {
      ok: true;
      grant: { id: string; token: string; doc_types: string[]; expires_at: string; revoked_at: string | null };
      application: { id: string; renter_id: string; status: string };
      listing: { id: string; address: string; agency_id: string };
      /** Set when a docId was passed and it belongs to this application's renter. */
      document: GrantDocument | null;
    }
  | { ok: false; reason: "not_found" | "forbidden" | "revoked" | "expired" };

/**
 * Checks an agent may use a share token: right agency, not revoked, not expired.
 * One database round trip (the check_grant_access function). Pass a docId to
 * also load that document and the agent's cached stamped copy.
 */
export async function checkGrantForAgent(token: string, agent: Profile, docId?: string): Promise<GrantCheck> {
  if (!isUuid(token)) return { ok: false, reason: "not_found" };
  const { data, error } = await admin().rpc("check_grant_access", {
    p_token: token,
    p_agent: agent.id,
    p_document: docId && isUuid(docId) ? docId : null,
  });
  if (error || !data) {
    if (error) console.error("check_grant_access failed", error);
    return { ok: false, reason: "not_found" };
  }
  return data as GrantCheck;
}

export const REASON_TEXT: Record<string, string> = {
  not_found: "This link doesn't exist.",
  forbidden: "You don't have access to this application.",
  revoked: "Access revoked by applicant",
  expired: "This share link has expired.",
};
