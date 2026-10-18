import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { normaliseUpload } from "@/lib/images";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const ALLOWED = ["image/png", "image/jpeg"];
const TYPES = ["id", "payslip", "reference"];

function back(request: NextRequest, error?: string) {
  const url = new URL("/renter/profile", request.url);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

/**
 * Upload order: save the row as pending, upload the file, then mark the row
 * uploaded. If any step fails the row is deleted (which queues its path for
 * removal), and pending rows left by a crash are swept by the cleanup job.
 * So a failed upload never leaves an orphaned file in storage.
 */
export async function POST(request: NextRequest) {
  const profile = await getProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (profile.role !== "renter") return back(request, "Only renters can upload documents.");
  if (!(await rateLimit(`upload:${profile.id}`, LIMITS.uploadPerUser))) {
    return back(request, "Too many uploads. Please wait a while and try again.");
  }

  const form = await request.formData();
  const file = form.get("file");
  const type = String(form.get("type") ?? "");
  if (!TYPES.includes(type)) return back(request, "Choose a document type.");
  if (!(file instanceof File) || file.size === 0) return back(request, "Choose an image to upload.");
  if (!ALLOWED.includes(file.type)) return back(request, "Only PNG or JPG images are supported.");
  if (file.size > 4 * 1024 * 1024) return back(request, "That image is over 4 MB.");

  let image: Awaited<ReturnType<typeof normaliseUpload>>;
  try {
    image = await normaliseUpload(Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return back(request, "That image couldn't be read. Try a different file.");
  }

  const db = admin();
  const path = `${profile.id}/${crypto.randomUUID()}.${image.ext}`;
  const { data: row, error } = await db
    .from("documents")
    .insert({
      owner_id: profile.id,
      type,
      storage_path: path,
      content_type: image.contentType,
      file_name: file.name.slice(0, 200),
      sensitivity: type === "id" ? "high" : "normal",
      uploaded_at: null,
    })
    .select("id")
    .single();
  if (error || !row) return back(request, `Couldn't save: ${error?.message ?? "unknown error"}`);

  const { error: uploadError } = await db.storage
    .from("documents")
    .upload(path, image.bytes, { contentType: image.contentType, upsert: false });
  if (uploadError) {
    await db.from("documents").delete().eq("id", row.id);
    return back(request, `Upload failed: ${uploadError.message}`);
  }

  const { error: readyError } = await db
    .from("documents")
    .update({ uploaded_at: new Date().toISOString() })
    .eq("id", row.id);
  if (readyError) {
    await db.storage.from("documents").remove([path]);
    await db.from("documents").delete().eq("id", row.id);
    return back(request, `Couldn't save: ${readyError.message}`);
  }
  return back(request);
}
