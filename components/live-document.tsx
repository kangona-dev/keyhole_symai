"use client";

import { useEffect, useState } from "react";

/** Shows the watermarked document and blanks it within ~3s if access is revoked. */
export default function LiveDocument({ token, docId }: { token: string; docId: string }) {
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const res = await fetch(`/api/grant/${token}`, { cache: "no-store" });
        const json = (await res.json()) as { active: boolean; reason?: string };
        if (!stopped && !json.active) {
          setActive(false);
          setReason(json.reason ?? "revoked");
        }
      } catch {
        // Network hiccup: keep the current state and try again.
      }
    }
    const timer = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [token]);

  if (!active) {
    return (
      <div className="grid min-h-[50vh] place-items-center rounded-xl border-2 border-red-300 bg-red-50 p-10 text-center">
        <div>
          <p className="text-3xl font-bold text-red-800">
            {reason === "expired" ? "This share link has expired" : "Access revoked by applicant"}
          </p>
          <p className="mt-2 text-red-700">This document is no longer available to you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/view/${token}/${docId}`}
        alt="Watermarked document"
        className="mx-auto block max-h-[80vh] w-auto max-w-full select-none"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
