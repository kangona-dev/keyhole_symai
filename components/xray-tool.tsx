"use client";

import { useMemo, useState, useTransition } from "react";
import { DEMO_FORM, parseQuestions, xrayForm, type XrayResult } from "@/lib/xray-rules";
import { saveCleanQuestions } from "@/app/actions";

type ListingOption = { id: string; address: string; questions: string[] };

export default function XrayTool({ listings, initialListingId }: { listings: ListingOption[]; initialListingId?: string }) {
  const initial = listings.find((l) => l.id === initialListingId);
  const [listingId, setListingId] = useState(initial?.id ?? listings[0]?.id ?? "");
  const [text, setText] = useState(initial ? initial.questions.join("\n") : "");
  const [results, setResults] = useState<XrayResult[] | null>(initial ? xrayForm(initial.questions) : null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const flagged = useMemo(() => results?.filter((r) => r.flagged).length ?? 0, [results]);

  function runXray(source = text) {
    setMessage(null);
    setResults(xrayForm(parseQuestions(source)));
  }

  function loadListing(id: string) {
    setListingId(id);
    const l = listings.find((x) => x.id === id);
    if (l) {
      const t = l.questions.join("\n");
      setText(t);
      setResults(l.questions.length ? xrayForm(l.questions) : null);
      setMessage(null);
    }
  }

  function fixForm() {
    if (!results || !listingId) return;
    const clean = results.filter((r) => !r.flagged).map((r) => r.question);
    startTransition(async () => {
      const res = await saveCleanQuestions(listingId, clean);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setText(clean.join("\n"));
        setResults(xrayForm(clean));
      }
    });
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label htmlFor="form-text" className="mb-1 block text-sm font-medium">Form questions (one per line)</label>
        <textarea
          id="form-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
          placeholder="Paste an application form here"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => runXray()} className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800">
            X-ray this form
          </button>
          <button
            onClick={() => {
              setText(DEMO_FORM);
              runXray(DEMO_FORM);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
          >
            Load sample form
          </button>
        </div>
        {listings.length > 0 && (
          <div className="mt-5">
            <label htmlFor="listing" className="mb-1 block text-sm font-medium">Listing to save the clean form to</label>
            <select
              id="listing"
              value={listingId}
              onChange={(e) => loadListing(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              {listings.map((l) => (
                <option key={l.id} value={l.id}>{l.address}</option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section aria-live="polite">
        {!results ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            Paste a form or load the sample, then press <strong>X-ray this form</strong>.
          </div>
        ) : (
          <>
            <div className={`rounded-xl p-5 ${flagged > 0 ? "bg-red-50 text-red-900" : "bg-emerald-50 text-emerald-900"}`}>
              <p className="text-3xl font-bold">
                {flagged} of {results.length} questions flagged
              </p>
              <p className="mt-1 text-sm">
                {flagged > 0 ? "These ask for information agents don't need. Remove them before renters see the form." : "This form only asks for what's needed."}
              </p>
              {listings.length > 0 && flagged > 0 && (
                <button
                  onClick={fixForm}
                  disabled={pending}
                  className="mt-4 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Fix form: save only the green questions"}
                </button>
              )}
              {message && (
                <p className={`mt-3 text-sm font-medium ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</p>
              )}
            </div>
            <ol className="mt-4 space-y-2">
              {results.map((r, i) => (
                <li
                  key={`${i}-${r.question}`}
                  className={`rounded-lg border border-l-4 bg-white p-3 shadow-sm ${r.flagged ? "border-l-red-600" : "border-l-emerald-600"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">
                      <span className="mr-2 text-slate-400">{i + 1}.</span>
                      {r.question}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${r.flagged ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                      {r.flagged ? r.rule?.label : "OK"}
                    </span>
                  </div>
                  {r.flagged && r.rule && (
                    <p className="mt-1 text-sm text-slate-600">
                      {r.rule.reason} <span className="text-slate-400">Source: {r.rule.source}</span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
