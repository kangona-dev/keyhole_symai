import { type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { checkGrantForAgent } from "@/lib/grants";

// One-off grant check used by the agent's viewer when its Realtime channel
// (re)connects or the tab becomes visible. Not polled on a timer.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await getProfile();
  if (!profile) return Response.json({ active: false, reason: "forbidden" }, { status: 401 });
  const check = await checkGrantForAgent(token, profile);
  return Response.json(
    check.ok
      ? { active: true, doc_types: check.grant.doc_types, expires_at: check.grant.expires_at }
      : { active: false, reason: check.reason },
    { headers: { "Cache-Control": "no-store" } },
  );
}
