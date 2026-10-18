import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { DOC_LABELS, formatDate } from "@/lib/format";
import { deleteDocument } from "@/app/actions";
import { Card, ErrorNote, Header, Loading, Page } from "@/components/ui";
import DocumentUploadForm from "@/components/document-upload-form";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function ProfilePage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Documents {...props} />
    </Suspense>
  );
}

async function Documents({ searchParams }: Props) {
  const profile = await requireRole("renter");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const { data: docs } = await admin()
    .from("documents")
    .select("id, type, file_name, created_at")
    .eq("owner_id", profile.id)
    .not("uploaded_at", "is", null)
    .order("created_at", { ascending: false });

  return (
    <>
      <Header profile={profile} />
      <Page>
        <Link href="/renter" className="text-sm text-teal-700 underline">← Back</Link>
        <h1 className="mt-2 text-2xl font-bold">My documents</h1>
        <p className="mt-1 text-slate-600">
          Stored privately. Agents never get a download link. They can only view a watermarked copy while you allow it.
        </p>
        <div className="mt-6">
          <ErrorNote message={error} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <h2 className="mb-3 font-semibold">Upload a document</h2>
            <DocumentUploadForm />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Uploaded</h2>
            {(docs ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">Nothing yet. Add an ID, a payslip and a rental reference.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {(docs ?? []).map((d) => (
                  <li key={d.id} className="overflow-hidden rounded-lg border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/my-document/${d.id}`} alt={DOC_LABELS[d.type] ?? d.type} className="h-36 w-full bg-slate-100 object-cover object-top" />
                    <div className="flex items-center justify-between gap-2 p-3">
                      <div>
                        <p className="text-sm font-medium">
                          {DOC_LABELS[d.type] ?? d.type}
                          {d.type === "id" && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">High sensitivity</span>}
                        </p>
                        <p className="text-xs text-slate-500">{formatDate(d.created_at)}</p>
                      </div>
                      <form action={deleteDocument}>
                        <input type="hidden" name="document_id" value={d.id} />
                        <button className="text-xs font-medium text-red-700 underline">Delete</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Page>
    </>
  );
}
