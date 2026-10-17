import Link from "next/link";
import { signOut } from "@/app/actions";
import type { Profile } from "@/lib/auth";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <circle cx="12" cy="9" r="4" />
          <path d="M10 12h4l1.5 8h-7z" />
        </svg>
      </span>
      <span className="text-lg tracking-tight">Keyhole</span>
    </Link>
  );
}

export function Header({ profile }: { profile?: Profile | null }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        {profile ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {profile.display_name}
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {profile.role === "agent" ? `Agent · ${profile.agency_name ?? "No agency"}` : "Renter"}
              </span>
            </span>
            <form action={signOut}>
              <button className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <nav className="flex gap-2 text-sm">
            <Link href="/login" className="rounded-md px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
              Sign in
            </Link>
            <Link href="/signup" className="rounded-md bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800">
              Sign up
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

export function Page({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </p>
  );
}

export function Loading() {
  return <p className="mx-auto max-w-5xl px-4 py-8 text-sm text-slate-500">Loading…</p>;
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";
export const buttonClass =
  "inline-flex items-center justify-center rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: "bg-slate-100 text-slate-700",
    preferred: "bg-emerald-100 text-emerald-800",
    declined: "bg-red-100 text-red-800",
  };
  const label: Record<string, string> = { submitted: "Submitted", preferred: "Preferred applicant", declined: "Declined" };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status] ?? styles.submitted}`}>
      {label[status] ?? status}
    </span>
  );
}

export function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.5-2" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}
