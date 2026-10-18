import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth";
import type { GrantDocument } from "@/lib/grants";
import { DOC_LABELS, formatDateTime } from "@/lib/format";
import { flattenWatermark } from "@/lib/flatten";

/** Private bucket holding watermarked copies. Originals stay in 'documents'. */
export const STAMPED_BUCKET = "stamped";

/** How long a signed link to a stamped copy works. Each view gets a fresh one. */
export const SIGNED_URL_SECONDS = 60;

/**
 * Renders the watermarked copy for one agent, grant and document, stores it
 * in the stamped bucket and records it in stamped_copies so later views skip
 * the render. Returns the stored path, or null if the original is missing.
 * Two concurrent first views both render and upsert the same path, which is harmless.
 */
export async function createStampedCopy(
  db: SupabaseClient,
  opts: { grantId: string; address: string; agent: Profile; doc: GrantDocument },
) {
  const { data: blob } = await db.storage.from("documents").download(opts.doc.storage_path);
  if (!blob) return null;

  // The stamp records who the copy was issued to and when. Every view is
  // still logged separately in access_log with its own time.
  const when = formatDateTime(new Date());
  const name = opts.agent.display_name;
  const jpeg = await flattenWatermark({
    bytes: Buffer.from(await blob.arrayBuffer()),
    text: `For ${opts.address} application only · ${name} · ${when}`,
    footer: `${DOC_LABELS[opts.doc.type] ?? opts.doc.type} · issued to ${name} (${opts.agent.agency_name ?? "agency"}) · ${when} · via Keyhole`,
  });

  const path = `${opts.grantId}/${opts.doc.id}/${opts.agent.id}.jpg`;
  const { error: uploadError } = await db.storage
    .from(STAMPED_BUCKET)
    .upload(path, jpeg, { contentType: "image/jpeg", upsert: true, cacheControl: "300" });
  if (uploadError) throw uploadError;

  const { error } = await db
    .from("stamped_copies")
    .upsert(
      { grant_id: opts.grantId, document_id: opts.doc.id, viewer_id: opts.agent.id, storage_path: path },
      { onConflict: "grant_id,document_id,viewer_id" },
    );
  if (error) {
    // Without the row the file would never be cleaned up, so don't keep it.
    await db.storage.from(STAMPED_BUCKET).remove([path]);
    throw error;
  }
  return path;
}
