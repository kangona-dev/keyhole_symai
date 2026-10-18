import { type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { checkGrantForAgent, REASON_TEXT } from "@/lib/grants";
import { DOC_LABELS, formatDateTime, isUuid } from "@/lib/format";
import { messageSvg } from "@/lib/watermark";
import { flattenWatermark } from "@/lib/flatten";

function svg(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * The only way an agent can see a renter's document. Every request checks the
 * agent's agency, the share grant (not revoked, not expired, includes this
 * document type), writes an access-log row, then returns a copy with the
 * watermark burned into the pixels. The original file never reaches the browser.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; docId: string }> },
) {
  const { token, docId } = await params;
  const profile = await getProfile();
  if (!profile || profile.role !== "agent") return svg(messageSvg("Access denied", "Sign in as the listing's agent."), 403);

  const check = await checkGrantForAgent(token, profile);
  if (!check.ok) return svg(messageSvg(check.reason === "revoked" ? "Access revoked" : "Access denied", REASON_TEXT[check.reason]), 403);
  if (!isUuid(docId)) return svg(messageSvg("Access denied", "Unknown document."), 403);

  const db = admin();
  const { data: doc } = await db
    .from("documents")
    .select("id, owner_id, type, storage_path, content_type")
    .eq("id", docId)
    .maybeSingle();
  if (!doc || doc.owner_id !== check.application.renter_id) return svg(messageSvg("Access denied", "Unknown document."), 403);
  if (!check.grant.doc_types.includes(doc.type)) {
    return svg(messageSvg("Locked", "Released only if this renter is the preferred applicant."), 403);
  }

  const { data: blob } = await db.storage.from("documents").download(doc.storage_path);
  if (!blob) return svg(messageSvg("Unavailable", "The file couldn't be loaded."), 404);

  await db.from("access_log").insert({ grant_id: check.grant.id, viewer_id: profile.id, document_id: doc.id });

  const when = formatDateTime(new Date());
  try {
    const jpeg = await flattenWatermark({
      bytes: Buffer.from(await blob.arrayBuffer()),
      text: `For ${check.listing.address} application only · ${profile.display_name} · ${when}`,
      footer: `${DOC_LABELS[doc.type] ?? doc.type} · viewed by ${profile.display_name} (${profile.agency_name ?? "agency"}) · ${when} · via Keyhole`,
    });
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Keyhole-Watermark": "burned-in",
      },
    });
  } catch (err) {
    console.error("Watermark failed", err);
    // Never fall back to the unwatermarked original.
    return svg(messageSvg("Couldn't render document", "Please try again."), 500);
  }
}
