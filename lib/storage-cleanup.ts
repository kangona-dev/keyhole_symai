import type { SupabaseClient } from "@supabase/supabase-js";

const BATCH = 500;

/**
 * Removes files queued in storage_cleanup by the database triggers (deleted
 * documents and stamped copies). Rows are only cleared once the Storage API
 * confirms the removal, so a failure is retried on the next run.
 */
export async function drainStorageCleanup(db: SupabaseClient, maxBatches = 20) {
  let removed = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { data: rows, error } = await db.from("storage_cleanup").select("id, bucket, path").order("id").limit(BATCH);
    if (error) {
      console.error("Couldn't read storage cleanup queue", error);
      break;
    }
    if (!rows || rows.length === 0) break;

    const byBucket = new Map<string, { ids: number[]; paths: string[] }>();
    for (const r of rows) {
      const entry = byBucket.get(r.bucket) ?? { ids: [], paths: [] };
      entry.ids.push(r.id);
      entry.paths.push(r.path);
      byBucket.set(r.bucket, entry);
    }

    const done: number[] = [];
    for (const [bucket, { ids, paths }] of byBucket) {
      const { error: removeError } = await db.storage.from(bucket).remove(paths);
      if (removeError) console.error(`Couldn't remove files from ${bucket}`, removeError);
      else done.push(...ids);
    }
    if (done.length > 0) await db.from("storage_cleanup").delete().in("id", done);
    removed += done.length;
    if (done.length < rows.length || rows.length < BATCH) break;
  }
  return removed;
}
