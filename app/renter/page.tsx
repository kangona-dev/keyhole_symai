import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { Card, Header, Loading, Page, StatusBadge } from "@/components/ui";

export default function RenterHome() {
  return (
    <Suspense fallback={<Loading />}>
      <RenterDashboard />
    </Suspense>
  );
}

async function RenterDashboard() {
  const profile = await requireRole("renter");
  const db = admin();
  const [{ data: listings }, { data: applications }, { data: docs }] = await Promise.all([
    db.from("listings").select("id, address, weekly_rent, agencies(name)").order("created_at", { ascending: false }).limit(50),
    db
      .from("applications")
      .select("id, status, created_at, listings(address)")
      .eq("renter_id", profile.id)
      .order("created_at", { ascending: false }),
    db.from("documents").select("type").eq("owner_id", profile.id),
  ]);
  const docTypes = new Set((docs ?? []).map((d) => d.type));
  const missing = ["id", "payslip", "reference"].filter((t) => !docTypes.has(t));

  return (
    <>
      <Header profile={profile} />
      <Page>
        <h1 className="text-2xl font-bold">Welcome, {profile.display_name}</h1>
        <p className="mt-1 text-slate-600">Apply once. Share only what each agent needs.</p>

        {missing.length > 0 && (
          <Card className="mt-6 border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-900">
              Add your documents before applying ({missing.length} missing).{" "}
              <Link href="/renter/profile" className="font-semibold underline">Go to my documents</Link>
            </p>
          </Card>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Available rentals</h2>
              <Link href="/renter/profile" className="text-sm font-medium text-teal-700 underline">My documents</Link>
            </div>
            {(listings ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No listings yet. An agent needs to create one.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(listings ?? []).map((l) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const agency = (l as any).agencies;
                  return (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium">{l.address}</p>
                        <p className="text-sm text-slate-500">
                          {l.weekly_rent ? `$${l.weekly_rent}/week · ` : ""}
                          {(Array.isArray(agency) ? agency[0]?.name : agency?.name) ?? ""}
                        </p>
                      </div>
                      <Link href={`/renter/listings/${l.id}`} className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800">
                        View
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">My applications</h2>
            {(applications ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">You haven&apos;t applied anywhere yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(applications ?? []).map((a) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const listing = (a as any).listings;
                  const address = (Array.isArray(listing) ? listing[0]?.address : listing?.address) ?? "Listing";
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <Link href={`/renter/applications/${a.id}`} className="font-medium underline-offset-2 hover:underline">
                          {address}
                        </Link>
                        <p className="text-sm text-slate-500">Applied {formatDate(a.created_at)}</p>
                      </div>
                      <StatusBadge status={a.status} />
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
