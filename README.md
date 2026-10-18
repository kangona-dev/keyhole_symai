# Keyhole

**Apply for rentals without handing over your life.**

Keyhole is a privacy-first alternative to rental application platforms such as 2Apply and Snug, built for international students renting in Sydney. Built at Sym AI Open 2026 (Macquarie University, 17–18 October 2026).

## The problem

- In April 2026 the Privacy Commissioner found that 2Apply's operator collected personal information that wasn't reasonably necessary, by unfair means, across more than 8.5 million applications. Flagged categories include gender, student status and visa expiry.
- NSW passed a renter privacy law in September 2026 (expected to start in early 2027): a standard form, no questions about social media, personal photos, tattoos or children, and ID collected only from the preferred applicant.
- In February 2026, Guardian Australia reported rental documents on several platforms reachable through links with no login, including one using sequential codes.

## What Keyhole does

| Feature | How it works |
| --- | --- |
| **Form X-ray** | Agents paste any application form. Rules based on the Privacy Commissioner's determination and the NSW law flag unnecessary questions with a reason and source, and "Fix form" saves only the clean questions. |
| **Renter-side flags** | Renters see flagged questions marked as optional when they apply. |
| **ID locked** | Only payslip and reference are shared on apply. ID unlocks only when the agent marks the renter as the preferred applicant. |
| **Watermarked viewing** | Agents never get a link to the original file. Every view goes through a server route that checks the agent's agency, the grant, the expiry and the document type, logs the view, then redirects to a one-minute signed link for a copy stamped with the listing, the agent's name and the time it was issued. |
| **Access log** | Every view is recorded and shown to the renter. |
| **Revoke** | One tap. The agent's open document goes blank straight away (pushed over Supabase Realtime). Renters can restore access. |

## Architecture

- **Next.js 16** (App Router, server actions, route handlers) deployed on **Vercel**.
- **Supabase**: Postgres, Auth (email/password) and a private Storage bucket.
- Row Level Security is enabled on every table with no public policies, so browsers can't query the database directly. All reads and writes go through server code that checks the signed-in user's role and agency.
- Share tokens are random UUIDs; nothing sequential appears in URLs.
- Watermarks are burned into the image pixels on the server with sharp, so the browser only ever receives the stamped copy, never the original file. Text is drawn as vector outlines, so no fonts are needed on the server.
- Each stamped copy is rendered once per agent, grant and document, cached in the private `stamped` bucket, and served through signed links that expire after 60 seconds. Revoking, losing ID access or expiry deletes the cached copies.
- Photos are shrunk to 1600px wide in the browser before upload, then resized and stripped of metadata (including GPS) on the server.
- Grant changes are pushed to the agent's viewer over a private Supabase Realtime broadcast channel (`grant:<token>`) by a database trigger. Only agents at the listing's agency can subscribe.
- Every grant check is a single database function call (`check_grant_access`). Applying, choosing the preferred applicant and declining are database functions too, so each runs in one transaction. A unique index allows only one preferred applicant per listing.
- `access_log` is partitioned by month. A daily job (`/api/cron/cleanup`, run by Vercel Cron) creates upcoming partitions, archives months older than a year, deletes declined applications after 30 days, removes stale stamped copies and unfinished uploads, and deletes the queued files from Storage.
- Sign-up, sign-in and uploads are rate limited with fixed-window counters in Postgres.

**Data model:** `agencies` → `profiles` (renter or agent) → `listings` → `listing_questions`; renters own `documents`; an `application` links a renter to a listing and has one `share_grant` (token, allowed document types, expiry, revoked time); every view writes to `access_log`.

**Scaling notes:** watermarking, polling, access-log growth, the agent dashboard counts and the applicant list have been addressed (see `supabase/migrations/002_scalability.sql`). Still open: pagination and search on the renter's listings page, verifying login tokens locally instead of calling Supabase Auth on every request, and Row Level Security policies as a second layer behind the server checks.

## Run locally

```
npm install
cp .env.example .env.local   # fill in your Supabase values
npm run dev
```

Run `supabase/migrations/001_keyhole.sql` and then `supabase/migrations/002_scalability.sql` in the Supabase SQL Editor first. Realtime must be enabled for the project.

Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` (any long random string; Vercel Cron sends it to `/api/cron/cleanup`).

## Honesty notes

- All people, agencies and documents are synthetic. Sample documents are in `public/samples/`.
- Form X-ray flags questions using published reasons; it isn't legal advice. The 2Apply determination concerns one platform and is reportedly under review.
- Not built: identity verification, notifications, agency CRM integrations.
- Revoking stops new views straight away, but nothing can un-take a screenshot. The watermark names the agent who took it.

Built with Next.js, React, Tailwind CSS, Supabase and Vercel, with help from AI coding tools (Cursor and Claude).
