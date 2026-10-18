import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { DOC_LABELS, formatDate, isUuid } from "@/lib/format";
import { declineApplication, markPreferred } from "@/app/actions";
import { Card, Header, Loading, LockIcon, Page, StatusBadge } from "@/components/ui";
import SubmitButton from "@/components/submit-button";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 20;
/** The first few applicants on each page open automatically; the rest load when opened. */
const OPEN_BY_DEFAULT = 3;

type Grant = { token: string; doc_types: string[]; revoked_at: string | null; expires_at: string };
type Applicant = {
  id: string;
  status: string;
  created_at: string;
  renter_id: string;
  name: string;
  grant: Grant | null;
  expired: boolean;
};
type Doc = { id: string; owner_id: string; type: string };

const SUMMARY_COLUMNS =
  "id, status, created_at, renter_id, profiles(display_name), share_grants(token, doc_types, revoked_at, expires_at)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toApplicant(row: any): Applicant {
  const renter = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const grant = Array.isArray(row.share_grants) ? row.share_grants[0] : row.share_grants;
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    renter_id: row.renter_id,
    name: renter?.display_name ?? "Applicant",
    grant: grant ?? null,
    expired: grant ? new Date(grant.expires_at).getTime() < Date.now() : true,
  };
}

export default function AgentListingPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <AgentListing {...props} />
    </Suspense>
  );
}

async function AgentListing({ params, searchParams }: Props) {
  const profile = await requireRole("agent");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const page = Math.max(1, parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const opened = typeof sp.open === "string" && isUuid(sp.open) ? sp.open : null;

  const db = admin();
  const { data: listing } = await db.from("listings").select("id, address, weekly_rent, agency_id").eq("id", id).maybeSingle();
  if (!listing || listing.agency_id !== profile.agency_id) notFound();

  // The preferred applicant is pinned on top; everyone else is paginated by application time.
  const from = (page - 1) * PAGE_SIZE;
  const [{ data: questions }, { data: preferredRows }, { data: pageRows, count }] = await Promise.all([
    db.from("listing_questions").select("id, question, flagged_reason").eq("listing_id", id).order("position"),
    db.from("applications").select(SUMMARY_COLUMNS).eq("listing_id", id).eq("status", "preferred").limit(1),
    db
      .from("applications")
      .select(SUMMARY_COLUMNS, { count: "exact" })
      .eq("listing_id", id)
      .neq("status", "preferred")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1),
  ]);
  const preferred = preferredRows?.[0] ? toApplicant(preferredRows[0]) : null;
  const applicants = (pageRows ?? []).map(toApplicant);
  const others = count ?? 0;
  const total = others + (preferred ? 1 : 0);
  const pages = Math.max(1, Math.ceil(others / PAGE_SIZE));

  // Answers and documents load only for open applications.
  const openIds = new Set<string>(applicants.slice(0, OPEN_BY_DEFAULT).map((a) => a.id));
  if (preferred) openIds.add(preferred.id);
  if (opened) openIds.add(opened);
  const open = [...(preferred ? [preferred] : []), ...applicants].filter((a) => openIds.has(a.id));
  const [answersById, docs] = open.length
    ? await Promise.all([
        db
          .from("applications")
          .select("id, answers")
          .in("id", open.map((a) => a.id))
          .then(({ data }) => new Map((data ?? []).map((r) => [r.id as string, (r.answers ?? {}) as Record<string, string>]))),
        db
          .from("documents")
          .select("id, owner_id, type")
          .in("owner_id", open.map((a) => a.renter_id))
          .not("uploaded_at", "is", null)
          .order("created_at")
          .then(({ data }) => (data ?? []) as Doc[]),
      ])
    : [new Map<string, Record<string, string>>(), [] as Doc[]];
  const flagged = (questions ?? []).filter((q) => q.flagged_reason).length;

  const base = `/agent/listings/${listing.id}`;
  const card = (a: Applicant) => (
    <ApplicantCard
      key={a.id}
      applicant={a}
      base={base}
      page={page}
      isOpen={openIds.has(a.id)}
      openedByLink={a.id === opened && !applicants.slice(0, OPEN_BY_DEFAULT).some((x) => x.id === a.id)}
      answers={answersById.get(a.id)}
      docs={docs.filter((d) => d.owner_id === a.renter_id)}
      preferredName={preferred && preferred.id !== a.id ? preferred.name : null}
    />
  );

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
            <h2 className="font-semibold">Applicants ({total})</h2>
            {total === 0 && <Card><p className="text-sm text-slate-500">No applications yet.</p></Card>}
            {preferred && page === 1 && card(preferred)}
            {applicants.map(card)}
            {pages > 1 && (
              <nav className="flex items-center justify-between text-sm" aria-label="Applicant pages">
                {page > 1 ? (
                  <Link href={`${base}?page=${page - 1}`} className="font-medium text-teal-700 underline">← Previous</Link>
                ) : <span />}
                <span className="text-slate-500">Page {page} of {pages}</span>
                {page < pages ? (
                  <Link href={`${base}?page=${page + 1}`} className="font-medium text-teal-700 underline">Next →</Link>
                ) : <span />}
              </nav>
            )}
          </div>
        </div>
      </Page>
    </>
  );
}

function ApplicantCard({
  applicant: a,
  base,
  page,
  isOpen,
  openedByLink,
  answers,
  docs,
  preferredName,
}: {
  applicant: Applicant;
  base: string;
  page: number;
  isOpen: boolean;
  openedByLink: boolean;
  answers: Record<string, string> | undefined;
  docs: Doc[];
  preferredName: string | null;
}) {
  const grant = a.grant;
  const revoked = !!grant?.revoked_at;
  const allowed: string[] = grant && !revoked && !a.expired ? grant.doc_types : [];
  const answerList = Object.entries(answers ?? {});

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-semibold">{a.name}</p>
        <p className="text-xs text-slate-500">Applied {formatDate(a.created_at)}</p>
      </div>
      <StatusBadge status={a.status} />
    </div>
  );

  if (!isOpen) {
    return (
      <Card>
        <div id={`app-${a.id}`} className="scroll-mt-4">
          {heading}
          <Link
            href={`${base}?page=${page}&open=${a.id}#app-${a.id}`}
            className="mt-3 inline-block text-sm font-medium text-teal-700 underline"
          >
            Open application
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div id={`app-${a.id}`} className="scroll-mt-4">
        {heading}

        {answerList.length > 0 && (
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {answerList.map(([q, v]) => (
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
            {docs.length === 0 && <li className="text-slate-500">No documents uploaded.</li>}
            {docs.map((d) => {
              const canView = allowed.includes(d.type);
              return (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span>{DOC_LABELS[d.type] ?? d.type}</span>
                  {canView && grant ? (
                    <Link
                      href={`/agent/view/${grant.token}/${d.id}`}
                      className="rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800"
                    >
                      View
                    </Link>
                  ) : d.type === "id" && !revoked && a.status !== "declined" ? (
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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {a.status !== "preferred" && !revoked && (
            <form action={markPreferred}>
              <input type="hidden" name="application_id" value={a.id} />
              <SubmitButton
                pendingText="Saving…"
                className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                {preferredName ? `Make preferred instead (locks ${preferredName}'s ID again)` : "Mark as preferred applicant"}
              </SubmitButton>
            </form>
          )}
          {a.status !== "declined" && (
            <form action={declineApplication}>
              <input type="hidden" name="application_id" value={a.id} />
              <input type="hidden" name="page" value={page} />
              <SubmitButton
                pendingText="Declining…"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Decline
              </SubmitButton>
            </form>
          )}
          {openedByLink && (
            <Link href={`${base}?page=${page}`} className="text-sm text-slate-500 underline">Close</Link>
          )}
        </div>
      </div>
    </Card>
  );
}
