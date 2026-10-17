import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { DOC_LABELS, formatDate, isUuid } from "@/lib/format";
import { markPreferred } from "@/app/actions";
import { Card, Header, Loading, LockIcon, Page, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }> };

export default function AgentListingPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <AgentListing {...props} />
    </Suspense>
  );
}

async function AgentListing({ params }: Props) {
  const profile = await requireRole("agent");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = admin();
  const { data: listing } = await db.from("listings").select("id, address, weekly_rent, agency_id").eq("id", id).maybeSingle();
  if (!listing || listing.agency_id !== profile.agency_id) notFound();

  const [{ data: questions }, { data: apps }] = await Promise.all([
    db.from("listing_questions").select("id, question, flagged_reason").eq("listing_id", id).order("position"),
    db
      .from("applications")
      .select("id, status, answers, created_at, renter_id, profiles(display_name), share_grants(token, doc_types, revoked_at, expires_at)")
      .eq("listing_id", id)
      .order("created_at", { ascending: true }),
  ]);
  const renterIds = (apps ?? []).map((a) => a.renter_id);
  const { data: docs } = renterIds.length
    ? await db.from("documents").select("id, owner_id, type, created_at").in("owner_id", renterIds).order("created_at")
    : { data: [] };
  const flagged = (questions ?? []).filter((q) => q.flagged_reason).length;

  return (
    <>
      <Header profile={profile} />
      <Page>
        <Link href="/agent" className="text-sm text-teal-700 underline">← Back</Link>
        <h1 className="mt-2 text-2xl font-bold">{listing.address}</h1>
        <p className="text-slate-600">{listing.weekly_rent ? `$${listing.weekly_rent}/week` : ""}</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Application form</h2>
              <Link href={`/agent/xray?listing=${listing.id}`} className="text-sm font-medium text-teal-700 underline">
                X-ray this form
              </Link>
            </div>
            {flagged > 0 && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {flagged} question{flagged === 1 ? "" : "s"} flagged as not needed.
              </p>
            )}
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {(questions ?? []).map((q) => (
                <li key={q.id} className={q.flagged_reason ? "text-red-700" : ""}>{q.question}</li>
              ))}
              {(questions ?? []).length === 0 && <li className="list-none text-slate-500">No questions.</li>}
            </ol>
          </Card>

          <div className="space-y-4">
            <h2 className="font-semibold">Applicants ({(apps ?? []).length})</h2>
            {(apps ?? []).length === 0 && <Card><p className="text-sm text-slate-500">No applications yet.</p></Card>}
            {(apps ?? []).map((a) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const row = a as any;
              const renter = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
              const grant = Array.isArray(row.share_grants) ? row.share_grants[0] : row.share_grants;
              const revoked = !!grant?.revoked_at;
              const expired = grant ? new Date(grant.expires_at).getTime() < Date.now() : true;
              const allowed: string[] = grant && !revoked && !expired ? grant.doc_types : [];
              const renterDocs = (docs ?? []).filter((d) => d.owner_id === row.renter_id);
              const answers = Object.entries((row.answers ?? {}) as Record<string, string>);
              return (
                <Card key={row.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{renter?.display_name ?? "Applicant"}</p>
                      <p className="text-xs text-slate-500">Applied {formatDate(row.created_at)}</p>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>

                  {answers.length > 0 && (
                    <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      {answers.map(([q, v]) => (
                        <div key={q}>
                          <dt className="text-slate-500">{q}</dt>
                          <dd className="font-medium">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-sm font-medium">Documents</p>
                    {revoked && (
                      <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">Access revoked by applicant</p>
                    )}
                    <ul className="space-y-2 text-sm">
                      {renterDocs.length === 0 && <li className="text-slate-500">No documents uploaded.</li>}
                      {renterDocs.map((d) => {
                        const canView = allowed.includes(d.type);
                        return (
                          <li key={d.id} className="flex items-center justify-between gap-2">
                            <span>{DOC_LABELS[d.type] ?? d.type}</span>
                            {canView ? (
                              <Link
                                href={`/agent/view/${grant.token}/${d.id}`}
                                className="rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800"
                              >
                                View
                              </Link>
                            ) : d.type === "id" && !revoked ? (
                              <span className="flex items-center gap-1 text-xs text-slate-600">
                                <LockIcon /> Released only if they&apos;re your preferred applicant
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">Not shared</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {row.status !== "preferred" && !revoked && (
                    <form action={markPreferred} className="mt-4">
                      <input type="hidden" name="application_id" value={row.id} />
                      <button className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
                        Mark as preferred applicant
                      </button>
                    </form>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </Page>
    </>
  );
}
