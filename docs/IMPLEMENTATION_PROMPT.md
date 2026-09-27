# IMPLEMENTATION PROMPT — Derrotero (Week 7)

> Paste this whole file as your first message to Claude Code, from inside the
> `derrotero` repo. Do not skip the "read first" step — the schema already
> exists in Supabase and must not be redesigned.

---

## Read first, build nothing yet

Before writing any code, read these two files in this repo and tell me, in
under 15 lines, what you understood:

- `docs/PACKET.md` — the product packet (problem, user, success definition, scope cut, stack, test plan)
- `supabase/schema.sql` — the database schema, **already applied** to the live Supabase project

Then list anything in the packet you think is wrong, unbuildable in this slice,
or missing. I want the disagreement before the code, not after.

**Do not modify the schema.** Tables, columns and RLS policies are fixed. If you
believe something is genuinely missing, say so and wait — do not `alter table`.

---

## What we are building

**Derrotero** — a route-side evidence instrument for a *colectivo* route
association in Naucalpan, Estado de México.

The state commissioned demand studies on 52 concessioned routes and has not
published the results, while deciding which routes survive and which become
feeders to a new cable-car line. The operators have no evidence of their own
ridership to argue with. Derrotero gives the measured party its own measurement,
and gives it to them **first**.

**Primary user:** the *dirigente* of the route association — she sees the map,
the findings, and controls sharing.
**Secondary user:** the operator (driver) — his phone is the sensor. He is never
named, scored or ranked. He gets exactly one control.

UI language is **Spanish** (the users are Mexican). Code, comments and commit
messages in English.

---

## Non-negotiable constraints

These come from a team Blueprint. Violating any of them fails the work, so if a
requirement below conflicts with something convenient, the constraint wins.

1. **No driver identity, anywhere.** No name, phone, licence, photo, or per-person
   id in any table, type, form, log or URL. The unit (`economic_number`, e.g.
   `SB-01`) is the identified thing. A field that does not exist cannot leak.
2. **Shadow clause.** The association owns the measurement and receives it first.
   Sharing is OFF by default — enforced as the *absence* of a row in
   `share_grants`, not as a boolean. Granting is explicit, dated, logged and
   revocable. Never exclusive: multiple grants may coexist.
3. **No automated penalty, scoring, ranking, or dismissal function** of any kind.
   Not even a "driver performance" view. It must not exist in the code.
4. **Nothing is shown as a command or as certainty.** Every inferred number is
   displayed with its `confidence` label and `runs_observed` count. The driver
   view issues zero instructions.
5. **All data is simulated and must be labelled on screen** — a visible
   "DATOS SIMULADOS" badge on any panel showing inferred data. No real person's
   data, ever.
6. **No claim of safety improvement or cost saving** anywhere in the UI.

## Security floor (check before you write, not after)

- Secrets only in `.env.local` locally and Vercel environment variables in
  production. Nothing in the repo. `.env.local` is already gitignored — keep it
  that way.
- Use only the **anon/publishable** Supabase key. The `service_role` key must
  never appear in this codebase, not even server-side, for this slice.
- Auth is Supabase Auth with **Sign in with Google**. Every page that shows
  association data requires a session.
- RLS is already on for every table. Never work around it.
- Validate every form input: length and type, before it reaches the database.

---

## Stack (fixed)

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Hosting | Vercel |
| Auth + DB | Supabase (`@supabase/supabase-js`, `@supabase/ssr`) |
| Map | **MapLibre GL JS** with the free Carto Positron vector style (`https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`) — **no API key, no Google Maps** |
| ML | **DBSCAN implemented in TypeScript in this repo** (~50 lines, no Python, no heavy dependency). It must be readable and explainable — I have to defend it on camera |
| Telemetry | Browser Geolocation API (`watchPosition`) |
| PDF | Client-side generation of the dossier |

Env vars already present in `.env.local`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Visual direction

This is an instrument for a 58-year-old route representative who distrusts
software that looks governmental. It should look deliberate and sober, not like
a generic dashboard template.

- Warm off-white background (`#F7F5F1`), near-black ink (`#16171A`), one accent
  (`#B85C1E` burnt orange) and one data colour (`#1F6F6B` deep teal).
- Dense but calm. Real typographic hierarchy. No emoji, no gradients, no shadows
  everywhere, no rounded-everything.
- The shadow-clause banner is the **first thing** on the dirigente screen and is
  a working control, not a footnote.
- Mobile-first for the driver screen: one very large button, readable at arm's
  length in a vehicle at 5am.

---

## Build plan — 6 commits, 2 deploys

Work one commit at a time. **Stop after each one, show me what changed, and wait
for my go-ahead before starting the next.** Do not run ahead.

### Commit 1 — scaffold + auth
- Next.js App Router + TypeScript project in the repo root.
- Supabase browser and server clients.
- Google sign-in; a signed-out visitor sees only a login screen.
- After login, resolve the user's association via `memberships`.
- If the user has no membership, show a calm explanatory screen (this is RLS
  working correctly, not an error) with instructions to be added by the association.

*Acceptance:* signed out → login only. Signed in without membership → explanation
screen. Signed in with membership → association name is displayed.

### Commit 2 — driver view (`/operador`)
- One screen, one control: **Iniciar turno / Terminar turno**.
- Starting a shift creates a `shifts` row; ending sets `ended_at`.
- While active, `watchPosition` writes to `pings` every ~10s (batched).
- Denied location permission degrades gracefully with a readable Spanish message.
- Visible line: identity is never recorded.

*Acceptance:* a shift opens and closes; pings accumulate with `unit_id`; nothing
identifying a person is written or displayed.

### Commit 3 — seeded simulator + FIRST DEPLOY
- A script or admin action that generates **3 units × 14 runs** along the
  San Bartolo → Toreo corridor.
- Departures must be **load-triggered, not clock-triggered**: a unit leaves base
  when simulated occupancy reaches 60–85%, which is the real finding from user
  research. This produces uneven headways naturally — do not fake them.
- Realistic dwell times at stops; some stops not in the official padrón.
- Everything written with `is_simulated = true`.
- **Deploy to Vercel now.** Add the two env vars in Vercel. Confirm the live URL
  loads and login works in production.

*Acceptance:* seeded data visible in Supabase; live URL works; env vars set in
Vercel and absent from the repo.

### Commit 4 — inference engine
- `lib/dbscan.ts`: plain TypeScript DBSCAN over low-speed pings (haversine
  distance, tuned eps/minPts), clustering into stop locations.
- Compute per cluster: centroid, average dwell seconds, estimated boardings,
  `runs_observed`, and a `confidence` of `baja` / `media` / `alta` derived from
  how many runs support it.
- Compute `run_metrics`: real headway between departures and occupancy at
  departure.
- Write results to `inferred_stops` and `run_metrics`.
- Comment the algorithm so a non-engineer could follow it.

*Acceptance:* ≥8 stops inferred on the seeded corridor; obvious noise excluded;
computed headways match the seeded generator within tolerance; every row carries
a confidence value.

### Commit 5 — dirigente dashboard (`/`)
- Shadow-clause banner at the top, with the real sharing state.
- MapLibre map: route line, inferred stops as circles **sized by estimated
  boardings**, one callout for a stop not in the official padrón.
- Headway chart for the 05:00–08:00 window.
- A "hallazgo del turno" card stating the load-triggered departure finding, with
  its confidence and run count visible.
- Stat row: runs recorded, stops inferred, average dwell, and **"0 campos con
  identidad"**.
- "DATOS SIMULADOS" badge on the map panel.

*Acceptance:* matches the intent of `docs/mockup.png`; every inferred figure
shows confidence; the page is readable on a phone.

### Commit 6 — sharing + dossier + SECOND DEPLOY
- Sharing control: creating a grant writes a `share_grants` row with a recipient
  label and a token; revoking sets `revoked_at`.
- A log of grants: who, when, revoked or active.
- Public read page `/expediente/[token]` calling the `dossier_by_token`
  Postgres function. A revoked or unknown token renders exactly the same "not
  available" state — it must not reveal that a grant ever existed.
- "Descargar expediente": dated PDF with stops, headways, confidence labels,
  simulated badge, and **no identity fields**.
- **Deploy to Vercel again.**

*Acceptance:* default state shares nothing; granting produces a working public
link; revoking kills it immediately; PDF downloads and is dated.

---

## Working rules

- **One commit at a time.** Stop and report after each. I approve, then you continue.
- Commit messages in English, imperative, describing behaviour not files.
- Maintain `DECISIONS.md` at the repo root: after each session append what was
  decided, what broke, and the first move for next time.
- When something errors, show me the actual error text before guessing at a fix.
- If you are about to add a dependency, tell me what and why first. Prefer zero.
- If any instruction here conflicts with the six constraints above, stop and ask.
  The constraints win.

Start by reading `docs/PACKET.md` and `supabase/schema.sql`, then give me your
15-line summary and your disagreements. Do not write code yet.
