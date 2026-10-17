import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { Header, Loading, Page } from "@/components/ui";
import XrayTool from "@/components/xray-tool";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function XrayPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Xray {...props} />
    </Suspense>
  );
}

async function Xray({ searchParams }: Props) {
  const profile = await requireRole("agent");
  const sp = await searchParams;
  const db = admin();
  const { data: listings } = profile.agency_id
    ? await db
        .from("listings")
        .select("id, address, listing_questions(question, position)")
        .eq("agency_id", profile.agency_id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const options = (listings ?? []).map((l) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = l as any;
    const qs = [...(row.listing_questions ?? [])]
      .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
      .map((q: { question: string }) => q.question);
    return { id: row.id as string, address: row.address as string, questions: qs as string[] };
  });

  return (
    <>
      <Header profile={profile} />
      <Page>
        <Link href="/agent" className="text-sm text-teal-700 underline">← Back</Link>
        <h1 className="mt-2 text-2xl font-bold">Form X-ray</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Paste any rental application form. Keyhole flags questions the Privacy Commissioner (2Apply determination,
          April 2026) and the 2026 NSW renter privacy law say agents don&apos;t need, then saves a clean form to your listing.
        </p>
        <XrayTool listings={options} initialListingId={typeof sp.listing === "string" ? sp.listing : undefined} />
      </Page>
    </>
  );
}
