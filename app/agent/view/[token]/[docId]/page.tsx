import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { checkGrantForAgent, REASON_TEXT } from "@/lib/grants";
import { Header, Loading, Page } from "@/components/ui";
import LiveDocument from "@/components/live-document";

type Props = { params: Promise<{ token: string; docId: string }> };

export default function ViewPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <View {...props} />
    </Suspense>
  );
}

async function View({ params }: Props) {
  const profile = await requireRole("agent");
  const { token, docId } = await params;
  const check = await checkGrantForAgent(token, profile, docId);

  return (
    <>
      <Header profile={profile} />
      <Page>
        {check.ok ? (
          <>
            <Link href={`/agent/listings/${check.listing.id}`} className="text-sm text-teal-700 underline">← Back to applicants</Link>
            <h1 className="mt-2 text-xl font-bold">{check.listing.address}</h1>
            <p className="mb-4 text-sm text-slate-600">
              Watermarked view. Every view is logged and visible to the applicant, who can revoke access at any time.
            </p>
            <LiveDocument
              token={token}
              docId={docId}
              docType={check.document?.type ?? null}
              expiresAt={check.grant.expires_at}
            />
          </>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-10 text-center">
            <p className="text-2xl font-bold text-red-800">{REASON_TEXT[check.reason]}</p>
            <Link href="/agent" className="mt-4 inline-block text-sm text-red-800 underline">Back to dashboard</Link>
          </div>
        )}
      </Page>
    </>
  );
}
