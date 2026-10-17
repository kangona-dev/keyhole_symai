import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/app/actions";
import { getProfile, homeFor } from "@/lib/auth";
import { Card, ErrorNote, Header, Loading, buttonClass, inputClass } from "@/components/ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function LoginPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Login {...props} />
    </Suspense>
  );
}

async function Login({ searchParams }: Props) {
  const profile = await getProfile();
  if (profile) redirect(homeFor(profile.role));
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return (
    <>
      <Header />
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-6 text-2xl font-bold">Sign in</h1>
        <ErrorNote message={error} />
        <Card>
          <form action={signIn} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
              <input id="password" name="password" type="password" required autoComplete="current-password" className={inputClass} />
            </div>
            <button className={`${buttonClass} w-full`}>Sign in</button>
          </form>
        </Card>
        <p className="mt-4 text-sm text-slate-600">
          New here? <Link href="/signup" className="font-medium text-teal-700 underline">Create an account</Link>
        </p>
      </main>
    </>
  );
}
