import Link from "next/link";
import { Header } from "@/components/ui";

const points = [
  {
    title: "Form X-ray",
    body: "Agents paste their application form. Keyhole flags every question the Privacy Commissioner and the new NSW renter privacy law say they don't need, and removes it in one click.",
  },
  {
    title: "ID stays locked",
    body: "Your passport or licence is only released if you become the preferred applicant. Everyone else never sees it.",
  },
  {
    title: "Watermarked, logged, revocable",
    body: "Every view of your payslip is stamped with the agent's name and time, recorded in your access log, and can be switched off instantly.",
  },
];

export default function Home() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 sm:py-24">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-teal-700">For renters in Sydney</p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Apply for rentals without handing over your life.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-600">
            Rental apps ask for your passport, visa expiry, payslips and more, then keep them forever. Keyhole shares only
            what an agent actually needs, only for one listing, and only for as long as you allow.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800">
              Create an account
            </Link>
            <Link href="/login" className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 hover:bg-slate-50">
              Sign in
            </Link>
          </div>
        </section>
        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          {points.map((p) => (
            <div key={p.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-slate-900">{p.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{p.body}</p>
            </div>
          ))}
        </section>
        <footer className="border-t border-slate-200 py-6 text-xs text-slate-500">
          Hackathon prototype. All data is synthetic. Keyhole flags questions with published reasons; it isn&apos;t legal advice.
        </footer>
      </main>
    </>
  );
}
