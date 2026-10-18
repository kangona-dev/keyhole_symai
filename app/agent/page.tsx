import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { createListing } from "@/app/actions";
import { Card, ErrorNote, Header, Loading, Page, buttonClass, inputClass } from "@/components/ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function AgentHome(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <AgentDashboard {...props} />
    </Suspense>
  );
}

async function AgentDashboard({ searchParams }: Props) {
  const profile = await requireRole("agent");
  const sp = await searchParams;
  const db = admin();
  // listing_summaries counts applications and flagged questions in the
  // database, so the dashboard never loads individual application rows.
  const { data: listings } = profile.agency_id
    ? await db
        .from("listing_summaries")
        .select("id, address, weekly_rent, application_count, flagged_count")
        .eq("agency_id", profile.agency_id)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <Header profile={profile} />
      <Page>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Welcome, {profile.display_name}</h1>
            <p className="text-slate-600">{profile.agency_name ?? "No agency"}</p>
          </div>
          <Link href="/agent/xray" className={buttonClass}>Open Form X-ray</Link>
        </div>
        <div className="mt-6">
          <ErrorNote message={typeof sp.error === "string" ? sp.error : undefined} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <h2 className="mb-3 font-semibold">New listing</h2>
            <form action={createListing} className="space-y-4">
              <div>
                <label htmlFor="address" className="mb-1 block text-sm font-medium">Address</label>
                <input id="address" name="address" required placeholder="12 Oak St, Kensington" className={inputClass} />
              </div>
              <div>
                <label htmlFor="weekly_rent" className="mb-1 block text-sm font-medium">Weekly rent ($)</label>
                <input id="weekly_rent" name="weekly_rent" type="number" min="0" placeholder="520" className={inputClass} />
              </div>
              <div>
                <label htmlFor="questions" className="mb-1 block text-sm font-medium">Application questions (one per line)</label>
                <textarea id="questions" name="questions" rows={8} className={inputClass} placeholder={"Full name\nWeekly income\nPrevious landlord reference"} />
              </div>
              <button className={buttonClass}>Create listing</button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Your agency&apos;s listings</h2>
            {(listings ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No listings yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(listings ?? []).map((row) => {
                  const apps: number = row.application_count ?? 0;
                  const flagged: number = row.flagged_count ?? 0;
                  return (
                    <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <Link href={`/agent/listings/${row.id}`} className="font-medium hover:underline">{row.address}</Link>
                        <p className="text-sm text-slate-500">
                          {apps} application{apps === 1 ? "" : "s"}
                          {row.weekly_rent ? ` · $${row.weekly_rent}/week` : ""}
                        </p>
                      </div>
                      {flagged > 0 ? (
                        <Link href={`/agent/xray?listing=${row.id}`} className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                          {flagged} flagged
                        </Link>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Clean form</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </Page>
    </>
  );
}
