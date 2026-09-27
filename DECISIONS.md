# DECISIONS

Log of what was decided, what broke, and the first move for next time. One
entry per working session, newest on top.

---

## Session 2 — 2026-09-27 — Bug: 42501 permission denied, looked like RLS

**What broke**

- After signing in with Google and inserting the membership row by hand, the
  app still showed "Todavía no perteneces a una asociación" — the empty-
  membership screen — even though the row existed and `auth.uid()` matched.
- Real error, once logged instead of guessed at: `42501 permission denied for
  table memberships`.
- Root cause: this Supabase project has **"Automatically expose new tables"
  turned off**, so creating a table does not grant `SELECT`/`INSERT`/
  `UPDATE`/`DELETE` to the `authenticated` role by default. The query was
  rejected at the privilege-check layer, before Postgres ever evaluated Row
  Level Security.

**Lesson — a 42501 looks identical to RLS denying, but it isn't**

A missing table-level `GRANT` and an RLS policy returning zero rows produce
the *same visible symptom* from the app (empty result / "you don't belong
here"), but they are two different layers: privilege check happens first,
RLS second. Do not assume "empty result" means "policy problem" — log the
actual Postgres error code before changing any policy. This is why the
working rule "show the actual error text before guessing at a fix" mattered
here: guessing would have led to needlessly rewriting `is_member()` or the
RLS policies, which were correct all along.

**Fix**

- Added an explicit `GRANT` block to `supabase/schema.sql` (§13): `SELECT`
  only on `associations`/`memberships` (membership is administered, not
  self-service), full CRUD on the six operational tables, `USAGE` on
  sequences. `anon` gets nothing — its only door stays `dossier_by_token`.
- Removed the temporary `console.log` diagnostics from `app/page.tsx`. Kept
  the `console.error` in `/auth/callback` — that one is a permanent,
  legitimate log of a real failure path, not a one-off diagnostic.

**Verified:** association name and role `dirigencia` render correctly on
screen after the grants were applied.

---

## Session 1 — 2026-09-27 — Commit 1: scaffold + auth

**Decided**

- Padrón oficial de paradas is not public, so `inferred_stops.in_official_padron`
  can never be checked against a real reference list. The flag is set by the
  seeded generator only. Known limitation: the "parada no registrada" finding
  is a prototype assertion, not a verification, and must not be presented to
  SITRAMyTEM as proof — only as a prompt to check on the ground.
- `run_metrics.headway_minutes` is the interval between consecutive base
  departures, not something computed within a single shift. `shift_id`
  references which shift produced the departure; it is not the basis of the
  headway calculation itself.
- RLS isolation (test plan #5) is the load-bearing test of the whole build —
  it is the shadow clause demonstrated, not promised. Built assuming two
  associations with two distinct Google accounts from the start (not
  retrofitted later). Fatima will use a second Google account of her own.
  Exact verification steps land in the Commit 6 report.
- Scope for this slice stays one association, one route — confirmed out of
  scope to generalize.

**Built**

- Next.js 16 (App Router, TypeScript, Tailwind v4) scaffolded at repo root,
  keeping the existing `.env.local`, `docs/`, `supabase/`.
- Added `@supabase/supabase-js` and `@supabase/ssr` (the two packages the
  packet names as fixed stack).
- Supabase browser client (`lib/supabase/client.ts`), server client
  (`lib/supabase/server.ts`), and session-refresh helper
  (`lib/supabase/proxy.ts`).
- Root `proxy.ts` (Next.js 16 renamed the `middleware.ts` convention to
  `proxy.ts` — migrated at scaffold time rather than starting on a deprecated
  convention).
- `/auth/callback` route exchanging the OAuth code for a session.
- `/login` — Google sign-in only, Spanish copy.
- `/` — server component: redirects signed-out visitors to `/login`; queries
  `memberships` (RLS-scoped) and shows a calm "no perteneces a una asociación
  todavía" screen when there is no membership row, or the association name
  when there is one. Sign-out is a server action.
- Applied the fixed palette (`#F7F5F1` / `#16171A` / `#B85C1E` / `#1F6F6B`) in
  `globals.css` as the baseline for every later screen.
- Removed the default `create-next-app` demo assets (`public/*.svg`,
  boilerplate `page.tsx`).

**Verified**

- `next build` compiles clean, no type errors, no lint errors.
- Dev server manually checked: `/` signed-out → 307 to `/login`; `/login`
  renders the Google button and copy.
- Full Google OAuth round-trip **not yet tested** — needs the Google OAuth
  client configured in the Supabase Auth dashboard (redirect URI, consent
  screen) before Commit 1's acceptance criteria can be fully exercised. This
  is dashboard configuration, not code; flagged to Fatima before her go-ahead
  on Commit 2.

**Broke / open**

- Nothing broke. Two concurrent `npm install` runs against the same directory
  were started by mistake (base install + Supabase packages); waited for both
  to finish and rebuilt clean rather than risk a half-written lockfile — no
  corruption found, but worth not repeating.

**First move for next time**

- Confirm Google OAuth works end-to-end against the live Supabase project
  (needs the Supabase dashboard Google provider configured and the bootstrap
  membership insert from `schema.sql` §12 run for Fatima's account), then
  start Commit 2 (`/operador` driver view).
