import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

const ALLOWED: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };
const TYPES = ["id", "payslip", "reference"];

function back(request: NextRequest, error?: string) {
  const url = new URL("/renter/profile", request.url);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const profile = await getProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (profile.role !== "renter") return back(request, "Only renters can upload documents.");

  const form = await request.formData();
  const file = form.get("file");
  const type = String(form.get("type") ?? "");
  if (!TYPES.includes(type)) return back(request, "Choose a document type.");
  if (!(file instanceof File) || file.size === 0) return back(request, "Choose an image to upload.");
  const ext = ALLOWED[file.type];
  if (!ext) return back(request, "Only PNG or JPG images are supported.");
  if (file.size > 4 * 1024 * 1024) return back(request, "That image is over 4 MB.");

  const db = admin();
  const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await db.storage
    .from("documents")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return back(request, `Upload failed: ${uploadError.message}`);

  const { error } = await db.from("documents").insert({
    owner_id: profile.id,
    type,
    storage_path: path,
    content_type: file.type,
    file_name: file.name.slice(0, 200),
    sensitivity: type === "id" ? "high" : "normal",
  });
  if (error) return back(request, `Couldn't save: ${error.message}`);
  return back(request);
}
