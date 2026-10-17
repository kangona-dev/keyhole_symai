import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/format";
import { xrayQuestion } from "@/lib/xray-rules";
import { applyToListing } from "@/app/actions";
import { Card, ErrorNote, Header, Loading, LockIcon, Page, buttonClass, inputClass } from "@/components/ui";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ListingPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Listing {...props} />
    </Suspense>
  );
}

async function Listing({ params, searchParams }: Props) {
  const profile = await requireRole("renter");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const db = admin();
  const { data: listing } = await db
    .from("listings")
    .select("id, address, weekly_rent, agencies(name)")
    .eq("id", id)
    .maybeSingle();
  if (!listing) notFound();

  const [{ data: questions }, { data: existing }, { data: docs }] = await Promise.all([
    db.from("listing_questions").select("id, question").eq("listing_id", id).order("position"),
    db.from("applications").select("id").eq("listing_id", id).eq("renter_id", profile.id).maybeSingle(),
    db.from("documents").select("type").eq("owner_id", profile.id),
  ]);
  const docTypes = new Set((docs ?? []).map((d) => d.type));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agencyRaw = (listing as any).agencies;
  const agencyName = Array.isArray(agencyRaw) ? agencyRaw[0]?.name : agencyRaw?.name;
  const results = (questions ?? []).map((q) => ({ ...q, xray: xrayQuestion(q.question) }));
  const flaggedCount = results.filter((r) => r.xray.flagged).length;

  return (
    <>
      <Header profile={profile} />
      <Page>
        <Link href="/renter" className="text-sm text-teal-700 underline">← Back</Link>
        <h1 className="mt-2 text-2xl font-bold">{listing.address}</h1>
        <p className="text-slate-600">
          {listing.weekly_rent ? `$${listing.weekly_rent}/week · ` : ""}
          {agencyName ?? ""}
        </p>
        <div className="mt-6">
          <ErrorNote message={typeof sp.error === "string" ? sp.error : undefined} />
        </div>

        {existing ? (
          <Card>
            <p>
              You&apos;ve already applied.{" "}
              <Link href={`/renter/applications/${existing.id}`} className="font-semibold text-teal-700 underline">
                See your application
              </Link>
            </p>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <h2 className="font-semibold">Application questions</h2>
              {flaggedCount > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Keyhole flagged {flaggedCount} question{flaggedCount === 1 ? "" : "s"} the agent likely doesn&apos;t need. You can leave {flaggedCount === 1 ? "it" : "them"} blank.
                </p>
              )}
              <form action={applyToListing} className="mt-4 space-y-4">
                <input type="hidden" name="listing_id" value={listing.id} />
                {results.length === 0 && <p className="text-sm text-slate-500">This listing has no extra questions.</p>}
                {results.map((q) => (
                  <div key={q.id}>
                    <label htmlFor={`q_${q.id}`} className="mb-1 block text-sm font-medium">
                      {q.question}
                    </label>
                    {q.xray.flagged && (
                      <p className="mb-1 text-xs text-red-700">
                        Flagged: {q.xray.rule?.reason} ({q.xray.rule?.source}). Optional.
                      </p>
                    )}
                    <input id={`q_${q.id}`} name={`q_${q.id}`} className={inputClass} />
                  </div>
                ))}
                <button className={buttonClass}>Apply securely</button>
              </form>
            </Card>

            <Card>
              <h2 className="font-semibold">What the agent will see</h2>
              <ul className="mt-3 space-y-3 text-sm">
                <li className="flex items-center justify-between">
                  <span>Payslip</span>
                  <span className={docTypes.has("payslip") ? "text-emerald-700" : "text-amber-700"}>
                    {docTypes.has("payslip") ? "Shared, watermarked" : "Not uploaded"}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Rental reference</span>
                  <span className={docTypes.has("reference") ? "text-emerald-700" : "text-amber-700"}>
                    {docTypes.has("reference") ? "Shared, watermarked" : "Not uploaded"}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>ID document</span>
                  <span className="flex items-center gap-1 text-slate-700">
                    <LockIcon /> Locked until you&apos;re preferred
                  </span>
                </li>
              </ul>
              <p className="mt-4 text-xs text-slate-500">
                Access lasts 14 days. You can revoke it at any time and see every view in your access log.
              </p>
              <Link href="/renter/profile" className="mt-3 inline-block text-sm font-medium text-teal-700 underline">
                Manage documents
              </Link>
            </Card>
          </div>
        )}
      </Page>
    </>
  );
}
