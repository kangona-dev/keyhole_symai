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
| **Watermarked viewing** | Agents never get a file link. Every view goes through a server route that checks the agent's agency, the grant, the expiry and the document type, then returns a copy stamped with the listing, the agent's name and the time. |
| **Access log** | Every view is recorded and shown to the renter. |
| **Revoke** | One tap. The agent's open document goes blank within seconds. Renters can restore access. |

## Architecture

- **Next.js 16** (App Router, server actions, route handlers) deployed on **Vercel**.
- **Supabase**: Postgres, Auth (email/password) and a private Storage bucket.
- Row Level Security is enabled on every table with no public policies, so browsers can't query the database directly. All reads and writes go through server code that checks the signed-in user's role and agency.
- Share tokens are random UUIDs; nothing sequential appears in URLs.
- Watermarks are burned into the image pixels on the server with sharp, so the browser only ever receives the stamped copy, never the original file. Text is drawn as vector outlines, so no fonts are needed on the server.

**Data model:** `agencies` → `profiles` (renter or agent) → `listings` → `listing_questions`; renters own `documents`; an `application` links a renter to a listing and has one `share_grant` (token, allowed document types, expiry, revoked time); every view writes to `access_log`.

**What breaks first at 10,000 users:** serving watermarked documents (each view downloads and re-encodes a file). Fix: watermark once per grant and cache it behind short-lived signed URLs and a CDN. Next: access-log writes (append-only, indexed by grant, partition by month) and listing search (pagination and indexes).

## Run locally

```
npm install
cp .env.example .env.local   # fill in your Supabase values
npm run dev
```

Run `supabase/migrations/001_keyhole.sql` in the Supabase SQL Editor first.

## Honesty notes

- All people, agencies and documents are synthetic. Sample documents are in `public/samples/`.
- Form X-ray flags questions using published reasons; it isn't legal advice. The 2Apply determination concerns one platform and is reportedly under review.
- Not built: identity verification, notifications, agency CRM integrations, automatic deletion after a declined application.

Built with Next.js, React, Tailwind CSS, Supabase and Vercel, with help from AI coding tools (Cursor and Claude).
