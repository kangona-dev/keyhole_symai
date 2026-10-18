"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Ended = "revoked" | "expired" | "locked";
type GrantEvent = { revoked?: boolean; deleted?: boolean; expires_at?: string; doc_types?: string[] };

/** Polling is only a fallback for when the Realtime channel can't connect. */
const FALLBACK_POLL_MS = 15_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Shows the watermarked document and blanks it as soon as access ends. The
 * server pushes grant changes over a private Supabase Realtime channel, so a
 * revoke lands near-instantly with no polling. The grant is re-checked once
 * on (re)connect and when the tab becomes visible, to catch anything missed.
 */
export default function LiveDocument({
  token,
  docId,
  docType,
  expiresAt,
}: {
  token: string;
  docId: string;
  docType: string | null;
  expiresAt: string;
}) {
  const [ended, setEnded] = useState<Ended | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setInterval> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    const end = (why: Ended) => {
      if (!stopped) setEnded(why);
    };
    const scheduleExpiry = (at: string) => {
      clearTimeout(expiryTimer);
      const ms = new Date(at).getTime() - Date.now();
      expiryTimer = setTimeout(() => end("expired"), Math.min(Math.max(0, ms), MAX_TIMEOUT_MS));
    };
    const apply = (e: GrantEvent) => {
      if (e.revoked || e.deleted) return end("revoked");
      if (e.expires_at) {
        if (new Date(e.expires_at).getTime() < Date.now()) return end("expired");
        scheduleExpiry(e.expires_at);
      }
      if (docType && e.doc_types && !e.doc_types.includes(docType)) end("locked");
    };
    const recheck = async () => {
      try {
        const res = await fetch(`/api/grant/${token}`, { cache: "no-store" });
        const json = (await res.json()) as { active: boolean; reason?: string; doc_types?: string[]; expires_at?: string };
        if (!json.active) end(json.reason === "expired" ? "expired" : "revoked");
        else apply({ doc_types: json.doc_types, expires_at: json.expires_at });
      } catch {
        // Network hiccup: keep the current state and try again later.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };

    scheduleExpiry(expiresAt);
    document.addEventListener("visibilitychange", onVisible);

    (async () => {
      await supabase.realtime.setAuth(); // private channels need the signed-in user's token
      if (stopped) return;
      channel = supabase
        .channel(`grant:${token}`, { config: { private: true } })
        .on("broadcast", { event: "grant_changed" }, ({ payload }) => apply(payload as GrantEvent))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearInterval(fallback);
            fallback = undefined;
            recheck();
          } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !fallback) {
            fallback = setInterval(recheck, FALLBACK_POLL_MS);
          }
        });
    })();

    return () => {
      stopped = true;
      clearTimeout(expiryTimer);
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [token, docType, expiresAt]);

  if (ended) {
    return (
      <div className="grid min-h-[50vh] place-items-center rounded-xl border-2 border-red-300 bg-red-50 p-10 text-center">
        <div>
          <p className="text-3xl font-bold text-red-800">
            {ended === "expired"
              ? "This share link has expired"
              : ended === "locked"
                ? "This document is no longer shared"
                : "Access revoked by applicant"}
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
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
