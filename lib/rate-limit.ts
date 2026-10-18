import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { admin } from "@/lib/supabase/admin";

export const LIMITS = {
  signupPerIp: { limit: 5, windowSeconds: 3600 },
  loginPerIp: { limit: 20, windowSeconds: 900 },
  loginPerEmail: { limit: 10, windowSeconds: 900 },
  uploadPerUser: { limit: 30, windowSeconds: 3600 },
} as const;

/**
 * Records one hit for `key` and returns false once the limit for the current
 * window is used up. Keys are hashed so emails and IPs aren't stored as-is.
 * Fails open: if the database call fails, the request is allowed and logged.
 */
export async function rateLimit(key: string, { limit, windowSeconds }: { limit: number; windowSeconds: number }) {
  const hashed = createHash("sha256").update(key).digest("hex");
  const { data, error } = await admin().rpc("rate_limit_hit", {
    p_key: hashed,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limit check failed", error);
    return true;
  }
  return data === true;
}

/** The caller's IP. On Vercel, x-forwarded-for is set by the platform and can't be spoofed. */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
