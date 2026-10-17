import { type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/format";

// A renter previewing their own document. Nobody else can use this route.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  if (!profile || !isUuid(id)) return new Response("Not found", { status: 404 });
  const db = admin();
  const { data: doc } = await db
    .from("documents")
    .select("owner_id, storage_path, content_type")
    .eq("id", id)
    .maybeSingle();
  if (!doc || doc.owner_id !== profile.id) return new Response("Not found", { status: 404 });
  const { data: blob } = await db.storage.from("documents").download(doc.storage_path);
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(await blob.arrayBuffer(), {
    headers: { "Content-Type": doc.content_type, "Cache-Control": "private, no-store" },
  });
}
