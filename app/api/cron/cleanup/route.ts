import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { drainStorageCleanup } from "@/lib/storage-cleanup";

export const maxDuration = 300;

function authorised(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily maintenance, called by Vercel Cron (see vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`:
 * - deletes declined applications after 30 days (grant, stamped copies and access log go with them)
 * - deletes stamped copies for expired or revoked grants
 * - deletes uploads that never finished
 * - creates upcoming access-log partitions and archives months older than a year
 * - removes the queued files from Storage
 */
export async function GET(request: NextRequest) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });
  const db = admin();
  const { data: summary, error } = await db.rpc("run_cleanup");
  if (error) {
    console.error("Cleanup failed", error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  const filesRemoved = await drainStorageCleanup(db);
  return Response.json({ ok: true, ...summary, files_removed: filesRemoved });
}
