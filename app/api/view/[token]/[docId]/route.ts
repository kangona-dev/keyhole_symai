import { type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { checkGrantForAgent, REASON_TEXT } from "@/lib/grants";
import { isUuid } from "@/lib/format";
import { messageSvg } from "@/lib/watermark";
import { createStampedCopy, SIGNED_URL_SECONDS, STAMPED_BUCKET } from "@/lib/stamped";

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
 * document type) and writes an access-log row. The watermarked copy is
 * rendered once per agent and document, cached in the private 'stamped'
 * bucket, and served through a signed link that expires in a minute.
 * The original file never reaches the browser.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; docId: string }> },
) {
  const { token, docId } = await params;
  const profile = await getProfile();
  if (!profile || profile.role !== "agent") return svg(messageSvg("Access denied", "Sign in as the listing's agent."), 403);
  if (!isUuid(docId)) return svg(messageSvg("Access denied", "Unknown document."), 403);

  const check = await checkGrantForAgent(token, profile, docId);
  if (!check.ok) return svg(messageSvg(check.reason === "revoked" ? "Access revoked" : "Access denied", REASON_TEXT[check.reason]), 403);
  const doc = check.document;
  if (!doc) return svg(messageSvg("Access denied", "Unknown document."), 403);
  if (!check.grant.doc_types.includes(doc.type)) {
    return svg(messageSvg("Locked", "Released only if this renter is the preferred applicant."), 403);
  }

  const db = admin();
  const stamp = () => createStampedCopy(db, { grantId: check.grant.id, address: check.listing.address, agent: profile, doc });
  let signedUrl: string | null = null;
  try {
    let path = doc.stamped_path ?? (await stamp());
    if (!path) return svg(messageSvg("Unavailable", "The file couldn't be loaded."), 404);
    let signed = await db.storage.from(STAMPED_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (signed.error && doc.stamped_path) {
      // The cached file was removed (cleanup or a manual purge): render it again.
      path = await stamp();
      if (!path) return svg(messageSvg("Unavailable", "The file couldn't be loaded."), 404);
      signed = await db.storage.from(STAMPED_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    }
    signedUrl = signed.data?.signedUrl ?? null;
  } catch (err) {
    console.error("Watermark failed", err);
  }
  // Never fall back to the unwatermarked original.
  if (!signedUrl) return svg(messageSvg("Couldn't render document", "Please try again."), 500);

  const { error: logError } = await db
    .from("access_log")
    .insert({ grant_id: check.grant.id, viewer_id: profile.id, document_id: doc.id });
  if (logError) {
    // An unlogged view would break the renter's audit trail, so don't serve it.
    console.error("Access log write failed", logError);
    return svg(messageSvg("Couldn't open document", "Please try again."), 500);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: signedUrl,
      "Cache-Control": "no-store, private, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Keyhole-Watermark": "burned-in",
    },
  });
}
