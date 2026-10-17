import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { DOC_LABELS, formatDate, formatDateTime, isUuid } from "@/lib/format";
import { restoreAccess, revokeAccess } from "@/app/actions";
import { Card, Header, Loading, LockIcon, Page, StatusBadge, secondaryButtonClass } from "@/components/ui";

type Props = { params: Promise<{ id: string }> };

export default function ApplicationPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Application {...props} />
    </Suspense>
  );
}

async function Application({ params }: Props) {
  const profile = await requireRole("renter");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = admin();
  const { data: app } = await db
    .from("applications")
    .select("id, status, created_at, renter_id, listing_id, listings(address)")
    .eq("id", id)
    .maybeSingle();
  if (!app || app.renter_id !== profile.id) notFound();

  const { data: grant } = await db
    .from("share_grants")
    .select("id, doc_types, expires_at, revoked_at")
    .eq("application_id", id)
    .maybeSingle();
  const { data: log } = grant
    ? await db
        .from("access_log")
        .select("id, viewed_at, profiles(display_name), documents(type)")
        .eq("grant_id", grant.id)
        .order("viewed_at", { ascending: false })
        .limit(50)
    : { data: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listingRaw = (app as any).listings;
  const address = (Array.isArray(listingRaw) ? listingRaw[0]?.address : listingRaw?.address) ?? "Listing";
  const revoked = !!grant?.revoked_at;
  const expired = grant ? new Date(grant.expires_at).getTime() < Date.now() : false;
  const active = !!grant && !revoked && !expired;
  const shared: string[] = grant?.doc_types ?? [];

  return (
    <>
      <Header profile={profile} />
      <Page>
        <Link href="/renter" className="text-sm text-teal-700 underline">← Back</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{address}</h1>
          <StatusBadge status={app.status} />
        </div>
        <p className="text-slate-600">Applied {formatDate(app.created_at)}</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <Card>
            <h2 className="font-semibold">Your sharing</h2>
            <p className={`mt-2 text-sm font-medium ${active ? "text-emerald-700" : "text-red-700"}`}>
              {active
                ? `Active until ${formatDate(grant!.expires_at)}`
                : revoked
                  ? "Access revoked. The agent can't see any of your documents."
                  : "Expired."}
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              {["payslip", "reference", "id"].map((t) => {
                const on = shared.includes(t) && active;
                return (
                  <li key={t} className="flex items-center justify-between">
                    <span>{DOC_LABELS[t]}</span>
                    <span className={`flex items-center gap-1 ${on ? "text-emerald-700" : "text-slate-500"}`}>
                      <LockIcon open={on} />
                      {on ? "Shared (watermarked)" : t === "id" && !shared.includes("id") ? "Locked until preferred" : "Not shared"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              {revoked || expired ? (
                <form action={restoreAccess}>
                  <input type="hidden" name="application_id" value={app.id} />
                  <button className={secondaryButtonClass}>Restore access for 14 days</button>
                </form>
              ) : (
                <form action={revokeAccess}>
                  <input type="hidden" name="application_id" value={app.id} />
                  <button className="w-full rounded-lg bg-red-600 px-4 py-3 text-lg font-semibold text-white hover:bg-red-700">
                    Revoke access
                  </button>
                  <p className="mt-2 text-xs text-slate-500">The agent&apos;s open document goes blank within seconds.</p>
                </form>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="font-semibold">Access log</h2>
            <p className="text-sm text-slate-500">Every time an agent opens one of your documents.</p>
            {(log ?? []).length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No views yet.</p>
            ) : (
              <ol className="mt-4 space-y-3">
                {(log ?? []).map((row) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const r = row as any;
                  const viewer = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
                  const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents;
                  return (
                    <li key={r.id} className="flex items-start gap-3 text-sm">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
                      <span>
                        <span className="font-medium">{viewer?.display_name ?? "An agent"}</span> viewed your{" "}
                        {(DOC_LABELS[doc?.type] ?? "document").toLowerCase()}
                        <span className="block text-xs text-slate-500">{formatDateTime(r.viewed_at)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </Page>
    </>
  );
}
