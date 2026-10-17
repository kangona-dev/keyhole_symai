import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signUp } from "@/app/actions";
import { getProfile, homeFor } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { Card, ErrorNote, Header, Loading, buttonClass, inputClass } from "@/components/ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function SignupPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Signup {...props} />
    </Suspense>
  );
}

async function Signup({ searchParams }: Props) {
  const profile = await getProfile();
  if (profile) redirect(homeFor(profile.role));
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const { data: agencies } = await admin().from("agencies").select("id, name").order("name");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-6 text-2xl font-bold">Create an account</h1>
        <ErrorNote message={error} />
        <Card>
          <form action={signUp} className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium">Your name</label>
              <input id="name" name="name" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">Password (6+ characters)</label>
              <input id="password" name="password" type="password" minLength={6} required autoComplete="new-password" className={inputClass} />
            </div>
            <fieldset>
              <legend className="mb-1 block text-sm font-medium">I am a…</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 has-[:checked]:border-teal-700 has-[:checked]:bg-teal-50">
                  <input type="radio" name="role" value="renter" defaultChecked /> Renter
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 has-[:checked]:border-teal-700 has-[:checked]:bg-teal-50">
                  <input type="radio" name="role" value="agent" /> Agent
                </label>
              </div>
            </fieldset>
            <div>
              <label htmlFor="agency_id" className="mb-1 block text-sm font-medium">Agency (agents only)</label>
              <select id="agency_id" name="agency_id" className={inputClass} defaultValue="">
                <option value="">Choose an agency</option>
                {(agencies ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <button className={`${buttonClass} w-full`}>Create account</button>
          </form>
        </Card>
        <p className="mt-4 text-sm text-slate-600">
          Already have an account? <Link href="/login" className="font-medium text-teal-700 underline">Sign in</Link>
        </p>
      </main>
    </>
  );
}
