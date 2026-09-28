# DECISIONS

Log of what was decided, what broke, and the first move for next time. One
entry per working session, newest on top.

---

## Session 14 — 2026-09-27 — Bug #3 found by observation: /expediente dates in UTC

**Found by the persona test, not by guessing — the third time this project's
real bugs came from watching actual behavior instead of reasoning about the
code.** (#1: the 42501 permission error that looked like RLS, Session 2.
#2: the iOS 0-pings bug that turned out to be a device permission, Session
7.) This one: the synthetic persona opened `/expediente/[token]` and did
date arithmetic — "corte al" read 28/9, 2:17 a.m. when she opened it at
20:17 on the 27th, exactly a 6-hour gap, and the same `salida` times that
show as 05:00–08:00 on the dashboard's headway chart showed as 11:00–13:00
in the dossier's own table. Her verbatim reaction is worth keeping as a
design note in its own right: *"Si la fecha de arriba está mal, ¿por qué
voy a creer los números de abajo?"* — for a product whose whole thesis is
measurement honesty, a wrong header date doesn't just look like a bug, it
undermines every number below it.

**Root cause: the same bug class as the Commit 3 windowStart bug, in the
display layer instead of the generator.** `date.toLocaleString("es-MX")`
only sets *locale* (date order, month names, am/pm) — it never sets
*timezone*. Without an explicit `timeZone`, it renders in whatever
timezone the process happens to run in, which is UTC on Vercel. The
dashboard's headway chart was never affected because its bucket labels
come from `lib/dashboardStats.ts`'s `mexicoHourOfDay()`, which does its own
fixed-offset math — but every *other* date display in the app used the
naive `toLocaleString`/`toLocaleDateString("es-MX")` pattern and was
silently wrong in production. Grepped for every call site rather than
patching only what was reported:

- `/expediente/[token]` — header ("compartido el"), corte al, and every
  `salida` in the corridas table (what Fatima explicitly reported).
- `app/page.tsx` — `ExpedienteCard`'s and `PrintableDossier`'s "corte al"
  dates, and every `departed_at` in the printable dossier's own table.
- `app/ShareControl.tsx` — the bitácora's `granted_at`/`revoked_at`. This
  one is worth calling out on its own: Condition 2 depends on grants being
  *dated* and *logged* — a wrong timezone in the dirigencia's own audit
  log of who-shared-what-when is a real, if quieter, honesty problem in
  the exact mechanism the shadow clause depends on. Not reported yet, but
  the same bug, so fixed the same way rather than left for someone to find
  later.

**Fix:** `lib/mexicoTime.ts` gained `formatMexicoDate()` and
`formatMexicoDateTime()` — both shift the UTC instant by the fixed
Mexico-City offset already used by `mexicoHourOfDay()`, then format with
`timeZone: "UTC"` explicitly, so the formatter reads the shifted
wall-clock fields directly rather than reapplying whatever timezone the
process runs in. Every `toLocaleString`/`toLocaleDateString("es-MX")` call
in the app now goes through these two functions — one convention, reused,
not four separate ad hoc fixes.

**Verified before reporting fixed:** ran the exact reported instant
(`2026-09-28T02:17:13Z`) through `formatMexicoDateTime` under three
different process timezones (`UTC`, `America/Mexico_City`, `Asia/Tokyo`)
— all three produced the same correct `27/9/2026, 8:17:13 p.m.`, matching
what Fatima's own clock showed. Also confirmed a sample departure now
renders the same hour on both screens (`05:04` on the dashboard's bucket,
`27/9/2026, 5:04:00 a.m.` in the dossier), closing the exact contradiction
she found.

**First move for next time:** redeploy, verify per the chat reply, then
this project has no further planned commits — future work is whatever
Fatima's own testing surfaces next.

---

## Session 13 — 2026-09-27 — Isolation test passed; added /demo for grading

**Isolation test (packet's test plan #5), passed at both layers, with an
account created for exactly this purpose:**
- Browser layer: the second Google account, made a member of the
  isolation-test association, sees that association's name and an empty
  dashboard — no San Bartolo map, stops, hallazgo, or log.
- Database layer, more rigorous: impersonated that account's session
  directly in SQL (`set local role authenticated; set local
  request.jwt.claims = '{"sub": "..."}'`) and queried San Bartolo's tables
  directly. All zero — not a permission error, just no rows, meaning
  `is_member()` correctly evaluates false for this account on every table.
  The positive control (that account's own unit count = 1) confirms RLS is
  scoping, not blanket-denying.

**Decided — `/demo` is a real grant, not a bypass, and that's the whole
design.** Fatima needs her grader to see the full dashboard without a
membership, without weakening the shadow clause for anyone else. Rejected
any approach that would add a code-level exception (e.g. "if this is the
demo association, skip the membership check") — that really would be a
crack in Condition 2. Instead: `/demo` calls the exact same
`dossier_by_token` security-definer function that `/expediente/[token]`
already uses, reading a **real, permanent `share_grants` row** Fatima
creates by hand (recipient label: "Vista de demostración académica"),
whose token lives only in a server-side env var
(`DEMO_DOSSIER_TOKEN`), never in the repo. Consequences of that choice,
which is the actual defense:
- It shows up in Fatima's own bitácora like any other grant — dated,
  logged, attributable.
- It is exactly as revocable as any other grant: hit "Revocar" on it from
  the dashboard and `/demo` shows the same "no disponible" state as an
  expired share link, with zero code change.
- No new privileged code path was written. `/demo` re-maps the same JSON
  `dossier_by_token` already returns (Spanish field names) into the same
  `InferredStopRow`/`RunMetricRow` shapes `lib/dashboardStats.ts` and
  `DashboardMap` already consume — reusing, not duplicating, everything
  already verified. The route line is `lib/corridor.ts`'s static
  coordinates, which was never a database read to begin with.
- Extracted `StatRow`/`HeadwayChart`/`HallazgoCard`/`OperadorPreview` out
  of `app/page.tsx` into `app/dashboardComponents.tsx` so `/` and `/demo`
  render from the identical components, not a copy that can drift.
- Verified locally (no token configured yet) that the route degrades to a
  calm "vista de demostración no disponible" — never a crash, never a
  hint about what a real token would look like.

**How to defend this technically, if asked:** the shadow clause's actual
claim is "no reader outside the association sees anything except through
a dated, logged, revocable grant." `/demo` doesn't violate that — it *is*
one. The thing it deliberately does not do is grant a *membership*
(RLS-level, indefinite, full read access including future data) to an
anonymous visitor; it grants exactly what any external authority gets
through the product's own sharing feature, scoped to one already-simulated
association's data, revocable the same way.

**What Fatima still needs to do:** run the `share_grants` insert SQL
(returns the token), set `DEMO_DOSSIER_TOKEN` in Vercel (Production +
Preview), redeploy.

---

## Session 12 — 2026-09-27 — Commit 6: sharing + dossier + second deploy

**Verified before shipping, not after:** a well-formed-but-nonexistent
48-hex-char token and a malformed (wrong-length) token both render the
exact same "no está disponible" page at `200` — checked directly against
the real Supabase project (`next start` locally, real `.env.local`), not
just read from the SQL. Combined with `dossier_by_token` already treating
a revoked grant the same way at the database layer (unchanged, was already
correct since Commit 1's schema), all three cases — revoked, never
existed, malformed — are indistinguishable from outside. The page itself
adds zero branching on *why* the RPC returned null; there is exactly one
boolean check.

**Decided — only the original granter can revoke, and that's the schema
as-is, not a workaround.** `share_grants`'s RLS policy's `WITH CHECK`
requires `granted_by = auth.uid()` on every UPDATE, which — since revoking
doesn't change `granted_by` — means only the account that created a grant
can revoke it; a different dirigencia member on the same association gets
a clear permission error, not a silent no-op. Schema is fixed for this
slice, so this stands. Flagging it explicitly rather than silently
building around it: worth knowing if a second dirigencia account is ever
added to an association mid-flight.

**Decided — the audit log shows "tú" / "otro integrante de la dirigencia",
not an email.** `granted_by` is a `uuid` referencing `auth.users`, which
the authenticated/anon roles have no grant to query (only `service_role`
can, and that key never appears in this codebase per the security floor).
So the log can't show a real name — it shows whether the viewing dirigencia
account was the one who granted it, which is enough for "quién concedió
qué" without needing elevated privileges.

**Decided — PDF via the browser's native print, zero new dependencies.**
The stack only said "client-side generation," not which library. Given
this session's repeated preference for the simplest thing that works
(the MapLibre worker fix, twice), and the working rule to flag a new
dependency before adding one, I skipped `jspdf` entirely: `PrintButton.tsx`
just calls `window.print()`, and both the dashboard's own `print:hidden`
interactive content and a dedicated `hidden print:block` printable dossier
section (stops table, runs table, DATOS SIMULADOS badge, cut-off date) are
styled with Tailwind's `print:` variant so only the dossier shows in the
print/"Save as PDF" dialog. If a true one-click download (vs. the print
dialog) turns out to matter, that's a small, contained swap later — say so
and I'll add `jspdf`.

**Built**

- `app/shareActions.ts` — `createShareGrant` (validates recipient length
  2–120 per Security Floor #4, returns the new token so the UI can show the
  link immediately) and `revokeShareGrant`, both dirigencia-only.
- `app/ShareControl.tsx` — replaces the read-only Commit 5 banner. Real
  ACTIVO/DESACTIVADO state, an inline grant form, and a full log (active +
  revoked) with each active grant's link shown for re-copying.
- `app/expediente/[token]/page.tsx` — the public page. No auth; calls
  `dossier_by_token` via RPC (already granted to `anon` since Commit 1).
- `app/PrintButton.tsx`, plus `ExpedienteCard` and `PrintableDossier` in
  `app/page.tsx`.

**First move for next time:** this was the last planned commit. Push (already
done — Vercel redeploys automatically from `main`), then verify on the live
site: default state shares nothing, granting produces a working
`/expediente/<token>` link, revoking kills that same link immediately
(re-check it after revoking), and "Descargar expediente" opens a clean
print dialog showing only the dossier.

---

## Session 11 — 2026-09-27 — Map bug, take two: the first fix was incomplete

**What was actually wrong.** Session 10's fix was half right: pointing
`setWorkerUrl()` at a static file did solve the MIME-type/404 problem. But
`maplibre-gl-worker.mjs` isn't self-contained — it has its own relative
import, `import {...} from "./maplibre-gl-shared.mjs"`. I'd only copied the
worker file into `public/`, not that dependency, so the worker's own module
graph 404'd one level deeper: same failure mode (worker never starts,
canvas stays blank, attribution still shows), different missing file. Not
an ESM/UMD mismatch as suspected — just an incomplete copy.

**Verified before reporting this fixed, not after:** copied
`maplibre-gl-shared.mjs` alongside the worker file, then actually
reproduced the bug and the fix locally — built a throwaway `/maptest` route
rendering `DashboardMap` directly, ran it under `next start` (production
mode, matching what Vercel runs), and opened it in a real browser via
Claude in Chrome. First screenshot reproduced Fatima's exact symptom (blank
gray panel, only CARTO attribution). After confirming both files serve
`200` with the right content type (checked with `fetch()` from the page
itself, not just curl), a later screenshot showed the actual basemap, the
route line, all 9 stop circles correctly colored, and the informal stop's
callout — console clean, no errors. Removed the test route before
committing; it was never meant to ship.

**Answering the direct questions:**
- Yes, `https://derrotero-sigma.vercel.app/maplibre-gl-worker.mjs` can be
  opened directly in a browser to check it deployed — it should show
  minified JS starting with a MapLibre license comment, not a 404 page.
- It wasn't a wrong bundle format (ESM vs UMD) — both worker and main
  library are ESM and that pairing is correct; the worker file was just
  missing its own dependency in the deploy.
- Considered raster tiles as a simpler fallback, per the question asked,
  but didn't take that path: our own overlay layers (the route line, the
  stop circles) are GeoJSON sources, which MapLibre also processes through
  its worker regardless of whether the *base* style is vector or raster —
  switching the base style away from vector tiles would not have removed
  the dependency on a working worker. Fixing the worker was the real fix
  available, not a workaround.

**First move for next time:** redeploy, verify (see chat reply), then
Commit 6.

---

## Session 10 — 2026-09-27 — Map bug resolved: MapLibre's worker, not CSS

**Root cause, one line:** Turbopack resolves MapLibre's internal web worker
to a URL that 404s in production, the browser gets Next's HTML 404 page
where it expected a JS module, refuses it on MIME-type grounds, the worker
never starts, and without it MapLibre can't process vector tiles — hence a
blank canvas with only the (worker-independent) attribution control
showing. All three things ruled out last session (CSS import, container
height, CSP) were correctly ruled out; this is a known MapLibre/Next.js +
Turbopack bundler-integration gap, not our code.

**Fix — simplest that works, per instruction, not the most elegant one:**
MapLibre exports `setWorkerUrl()` specifically for bundlers that mis-resolve
its worker. Copied `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs` to
`public/maplibre-gl-worker.mjs` (a committed static asset) and call
`setWorkerUrl("/maplibre-gl-worker.mjs")` before constructing the map.
Next's static file server always serves it with the correct
`application/javascript` content type, regardless of Turbopack's bundling
of the worker — verified locally with `next start` before shipping.
**Maintenance note:** this file is a manual copy, not generated at build
time — re-copy it if `maplibre-gl` is ever upgraded, or the worker will
silently point at stale code.

**First move for next time:** redeploy, verify the map paints (see chat
reply for the exact check), then start Commit 6 (sharing + dossier +
second deploy).

---

## Session 9 — 2026-09-27 — Two Commit 5 bugs in production: one fixed, one open

**Fixed: headway chart drew no bars.** Confirmed Fatima's own hypothesis
exactly. The bar's `style={{ height: "X%" }}` was a child of
`<div className="flex flex-1 flex-col items-center gap-1">` — a column with
no explicit height of its own (only the *outer row* had `h-32`). A
percentage height only resolves against a parent with a *definite* height;
against an auto-sized parent it computes to nothing. Fixed by giving the bar
its own fixed-height track (`h-24`) to size against, separate from the
value/hour labels that sit above and below it.

**Open: map panel renders nothing but the attribution control.** Before
touching any code, tried to reproduce this live (attempted to sign into the
production site as Fatima's dirigencia Google account via browser
automation) — got as far as the account chooser but Google's own page
stopped responding to automated clicks after two tries, so stopped rather
than loop, per the tool's own guidance. Did verify, from the actual
production build output, several things this is *not*:
- `maplibre-gl.css` is genuinely bundled and registered against `/`'s
  client-reference-manifest — the CSS import itself is not missing.
- The `.maplibregl-canvas` rule (`position:absolute; top:0; left:0`) is
  present in that bundled CSS.
- The Tailwind utilities on the container chain (`h-[360px]`, `h-full`,
  `min-h-[320px]`) all compiled correctly — not a missed-class build issue.
- `next.config.ts` sets no custom headers/CSP that could be blocking
  cross-origin tile/style requests.

None of that rules out a genuine runtime issue (container measuring 0
height at the exact moment the `Map` is constructed, a CSP or CORS block
from Vercel's own defaults, a worker-bundling issue specific to Turbopack,
or something else entirely) — those need the actual browser console/network
output, which static build inspection can't show. Asked Fatima for it
directly rather than guess further, with exact DevTools steps.

**First move for next time:** once the console/network output comes back,
diagnose and fix the map from that, not from another round of guessing.

---

## Session 8 — 2026-09-27 — Commit 5: dirigente dashboard (`/`)

**Decided — `/` now redirects an operador-role member to `/operador`**

The dashboard is explicitly the dirigencia's screen. A member whose only
role is `operador` has no reason to see the association's map/findings, and
routing them straight to their one button keeps the asymmetry the product
is built around visible in the navigation itself, not just the UI copy.

**Decided — the shadow-clause banner shows real state, but isn't a working
control yet**

Commit 5's own text says "with the real sharing state" — it queries
`share_grants` for any row with `revoked_at is null` and shows
ACTIVO/DESACTIVADO honestly. It does **not** render a toggle that does
nothing when clicked — that would be worse than an honest static badge,
especially for a persona-test participant who might click it and get
confused when nothing happens. The actual grant/revoke control is explicitly
Commit 6's job (`share_grants` writes, the token, the dossier). Same
reasoning for the mockup's "Expediente de demanda" card — left out of this
commit entirely rather than built as an inert placeholder.

**Decided — the "hallazgo del turno" card's numbers are computed, never the
mockup's illustrative figures**

The mockup (`docs/mockup.png`, an AI-generated illustration from the packet,
not literal copy) shows "78% de las corridas..." and "21 min a las 05:30" —
those are placeholder numbers from before the exact mechanics existed. The
real card always states whatever `averageOccupancy()` and
`maxHeadwayInWindow()` actually compute from `run_metrics` — currently
72.7% and a real 29.4-minute gap at 05:38, not the mockup's numbers. If the
seed changes, this text changes with it automatically.

**Decided — "detención media" excludes the base stop**

Base's dwell is the occupancy fill-wait (minutes), not boarding/alighting
dwell at a regular stop (seconds) — averaging them together would produce a
number that means nothing. `averageDwellExcludingBase()` in
`lib/dashboardStats.ts` filters out whichever stop matches
`CORRIDOR_STOPS[0].label` before averaging.

**Decided — headway chart window is a Mexico-local-time-of-day filter, not
a date range**

The seeded corridor's 14 runs/unit span several hours past 08:00 (each
cycle is ~30-40 min; 14 of them run well into the afternoon), and the
dashboard could be viewed on a different calendar day than when
`/admin/sembrar` was run. `lib/mexicoTime.ts` extracts local hour-of-day
(fixed UTC-6) from each `departed_at` and the chart only buckets
departures whose hour falls in [5, 8) — verified offline: 16 of 42 seeded
departures land in that window, spread 2–3 per 30-minute bucket, averages
ranging 3.2–13.8 minutes, with the real maximum (29.4 min) correctly
surfacing at 05:38.

**Built**

- `lib/mexicoTime.ts`, `lib/dashboardStats.ts` — pure functions, no
  Supabase dependency, computing headway buckets, dominant confidence,
  average occupancy, average dwell, and the single largest in-window
  headway. Verified offline against the actual generator+inference
  pipeline output before wiring into the page.
- `app/DashboardMap.tsx` (client) — MapLibre GL JS, free Carto Positron
  style, no API key. Route line from `lib/corridor.ts`'s known stop
  sequence (not re-derived from unordered `inferred_stops`, which have no
  sequence field); stop circles sized by `boardings_est`; a persistent
  (non-dismissing) callout on whichever stop isn't in the official padrón.
- `app/page.tsx` rebuilt as the full dashboard: shadow-clause banner, map
  panel with "DATOS SIMULADOS" badge, stat row (runs/stops/dwell/"0 campos
  con identidad"), headway chart, hallazgo card, and a small static inset
  preview of the operador screen (the mockup's third deliberate choice —
  making the measurement asymmetry visible in the interface itself).

**First move for next time:** start Commit 6 (sharing + dossier + second
deploy) — the shadow-clause banner and the omitted "Expediente" card both
get their real, working controls there.

---

## Session 7 — 2026-09-27 — iOS 0-pings bug: resolved (device, not code)

**Resolution:** the on-screen diagnostic panel added in Session 6 answered
the question directly — it was none of the four original suspects.

```
Permiso de ubicación: desconocido
Errores: 1 (code=1 User denied Geolocation)
Recargas silenciosas: 0
Pestaña oculta: 0
```

Location permission was never actually granted on that iPhone. Confirmed
across Safari and Chrome, after checking Settings and clearing site data —
five real shifts, all 0 pings. The same phone-adjacent laptop session in
production, same deploy, wrote pings normally (2 in 58s). **This is device
configuration, not an app bug** — the app already handles a denied
permission correctly (readable Spanish message, shift still opens and
closes normally, per the Commit 2 requirement). Not pursuing further.

This is the second bug this project found by making the real state visible
instead of guessing (see Session 2's 42501 permission error). Both times
the fix followed directly from what got surfaced; neither would have been
found by reasoning about the code alone. Worth keeping as a working
pattern, not just a one-off.

**Fixed for real: `flushBuffer` used to lose pings on a failed send.** It
cleared the in-memory buffer *before* attempting the insert, so any network
failure — unrelated to the iOS permission issue, but genuinely present in
the code the whole time — silently dropped those specific rows with no
retry. Now: the buffer is only trimmed by however many rows were *confirmed*
written; a failed insert leaves everything in place for the next flush
(periodic, or the final one on shift end) to retry. Flush calls are
serialized through a promise chain so an overlapping periodic tick and the
end-of-shift flush can't race on the same buffer contents.

**Removed:** the diagnostic panel and all its plumbing (`localStorage`-
persisted per-shift counters, permission/visibility/bfcache listeners) —
a driver's screen shows one button, not debug counters, once its job is
done. `app/operador/OperadorClient.tsx` is back to the Commit 2 shape plus
the `flushBuffer` fix above.

**First move for next time:** start Commit 5 (dirigente dashboard).

---

## Session 6 — 2026-09-27 — Bug: 0 pings written on iOS, diagnosis in progress

**What broke:** on the deployed HTTPS site, a real shift on an iPhone
(Safari) ran 65 seconds and opened/closed correctly in `shifts`, but wrote
**0** rows to `pings`. A same-day desktop test (Chrome, 18 seconds) wrote 5
pings correctly, so the write path itself works — something iOS-specific is
either not capturing positions, or capturing them and losing them before
they reach the database.

**Four suspects, in the order given, #3 and #4 considered most likely
because the shift closed cleanly:**
1. Location permission silently denied by iOS.
2. `watchPosition` starts but its success callback never fires.
3. The in-memory buffer (a plain ref) is lost when Safari suspends the tab
   or discards the page — the final "flush on end" would then have nothing
   to send, which is consistent with a clean-looking shift close and zero
   pings.
4. The end-of-shift flush fires but the network request doesn't complete
   before the page/context goes away.

**Not fixing yet — instrumenting first, per instruction.** Added an
on-screen, no-console-needed diagnostic panel to `/operador`
(`app/operador/OperadorClient.tsx`), visible once a shift has been tracked:

- Geolocation permission state via `navigator.permissions.query` (not
  inferred from our own error handling — directly answers suspect 1).
- Live count of positions captured this session + timestamp of the last
  one (answers suspect 2: permission granted but zero captures ever would
  point straight here).
- Count of geolocation *errors* received, with the raw code + message.
- Count of pings currently buffered but not yet sent.
- Flush attempts / successes / failures, with the actual Supabase error
  message surfaced (previously silently discarded — this alone answers
  suspect 4 if it ever fires with an error).
- **The key instrument for suspect 3:** a per-shift counter, persisted to
  `localStorage` (not React state, not a ref — those would reset along
  with the bug if the whole page reloaded) that increments every time this
  screen (re)mounts while a given shift is open. If this reads >0 after a
  shift that "closed cleanly," the page was silently torn down and
  restarted mid-shift without the driver ever noticing — the smoking gun.
- Separately, tab-hidden count and bfcache-restore count, to distinguish
  "merely backgrounded, JS state intact" from a genuine reload.

**Explicitly not changed:** `flushBuffer` still clears the in-memory buffer
before attempting the insert, so a failed flush still loses those specific
rows with no retry — this is a real latent bug candidate in its own right
(ties to suspect 4), left exactly as-is for now so the diagnostic panel
reports what actually happens, rather than a behavior already patched
underneath it.

**First move for next time:** Fatima runs a real shift on the iPhone again
against the same deploy and reports what the panel shows — permission
state, captured count, flush attempts/errors, and above all the reload
counter. That reading determines which of the four suspects gets the
actual fix, rather than guessing now.

---

## Session 5 — 2026-09-27 — Commit 3 verified in production; Commit 4: inference engine

**Verified (Commit 3, production):** live URL works, Google login works,
seed produced 14/14/14 runs on SB-01/02/03, `PRUEBA-01` absent from the
simulated set as intended.

**Decided — where the confidence numbers actually come from**

- `inferred_stops.confidence`: the fraction of all recorded runs (42 in this
  seed) that have at least one low-speed reading inside that cluster.
  ≥80% coverage = `alta`, 40–79% = `media`, below 40% = `baja`. Reasoning
  documented inline in `lib/inference/stops.ts`: a real, fixed-route stop
  should show up on nearly every run; something under 40% coverage looks
  more like a one-off (a red light, a single day's diversion) than a stop.
- `run_metrics.confidence`: how many low-speed GPS readings were captured
  *while the unit was still waiting at base*, before the first moving
  reading that marks departure. ≥5 samples = `alta`, 1–2 = `media`, 0 (we
  only caught it already moving) = `baja`.
- **Verified offline against the seeded data before writing anything to the
  database:** with this clean, noise-free generator, every one of the 9
  stops and all 42 runs came back `alta` — every run visits every stop and
  every departure is well-sampled, so there's nothing here that should score
  lower. That's the honest result, not a shortcoming of the confidence
  system: the tiers exist, are threshold-driven, and are documented; this
  particular dataset just doesn't have anything under `media`. A real
  future corridor with actual drivers, GPS dropouts, or a truly one-off stop
  would populate `media`/`baja` for real.

**Decided — departure time is inferred from pings, not read off the clock**

`shifts.started_at` marks when a run started **waiting** for passengers, not
when it left. `departed_at` (used for both headway and occupancy) is the
timestamp of the first ping in that shift whose speed is above the
low-speed threshold — the actual first moving reading. This is computed
independently per shift from its own pings only; nothing about the
generator's internal target-occupancy value is read back. That is also why
the headway computed here can be trusted to reproduce whatever the
underlying pings actually encode, bunching included (below).

**Decided — occupancy_at_departure is explicitly an estimate, not a
measurement**

There is no passenger sensor and never will be (Condition 1/3). The
estimate ranks each run's wait-at-base duration against every other run's
wait duration in the dataset, then projects that percentile onto the
60–85% band the dirigencia already reports from her own user research — it
does not invent that range, it places each run within a range she already
knows to be true. **Verified this produces a real, non-hardcoded figure**:
offline, the seeded data's occupancy estimates average **72.7%**, not the
78% mentioned as an example — whatever the actual pipeline produces is what
ships, per your instruction.

**Confirmed — the bunching from Session 4's offline check does show up in
computed headways**

Global headway (all three units' departures merged and sorted, exactly per
the Session 2 ruling that headway is a whole-corridor measure, not
per-unit) is computed by `lib/inference/runMetrics.ts` purely from inferred
`departed_at` timestamps — nothing about the generator's schedule is read
directly. Verified offline: min 0.1 min, max 29.4 min, average 11.2 min,
with 8 of 41 global gaps under 3 minutes — some units' independent 30–40
minute cycles drift into near-simultaneous departures, exactly the
"some days it's fast, some days you wait 20 minutes" pattern from Rosa's
user research. One of those gaps is ~6 seconds between two different
units — mathematically honest given the model, flagged here rather than
smoothed away, since altering it to look less coincidental would be exactly
the kind of manual insertion you told me not to do.

**Built**

- `lib/dbscan.ts` — DBSCAN, commented for someone who doesn't program (the
  "count nearby points, grow if dense enough, otherwise it's noise"
  explanation lives at the top of the file, not just in code comments).
- `lib/inference/stops.ts` — clusters low-speed pings (≤4 km/h, vs. the
  generator's 5 km/h moving floor — clean separation, no accidental noise
  from travel segments), computes centroid/dwell/boardings_est/confidence,
  matches each cluster against `lib/corridor.ts`'s known stops (reused from
  Commit 3) to set `label` and `in_official_padron`.
- `lib/inference/runMetrics.ts` — per-shift departure detection, global
  headway, occupancy estimate, confidence.
- `/admin/sembrar` gained a second button, "Calcular paradas e intervalos" →
  `computeInference()`: paginates the pings fetch (Supabase caps a query at
  1000 rows — with ~3,600 seeded pings this would have silently truncated
  without `.range()` paging), deletes only this association's previous
  *simulated* `inferred_stops`/`run_metrics` before writing fresh ones.

**Verified:** `next build`/`eslint` clean; full pipeline run offline against
the actual seeded generator output (not fabricated test data) before ever
touching Supabase — 9/9 stops recovered, all figures above.

**First move for next time**

- Fatima: on the live site, click "Calcular paradas e intervalos", then
  spot-check `inferred_stops`/`run_metrics` in Supabase's table editor.
- Then start Commit 5 (dirigente dashboard) — the "hallazgo del turno" card
  should average `run_metrics.occupancy_at_departure` from the database,
  never restate the 72.7% (or whatever it is at demo time) as a literal.

---

## Session 4 — 2026-09-27 — Commit 2 verification + Commit 3: seeded simulator

**Verified (Commit 2, on desktop):** turno opened and closed on `PRUEBA-01`,
5 pings written, `is_simulated = false` as agreed, permission prompt worked,
"CAPTURA EN VIVO — PRUEBA" label was clearly distinct. Phone test is blocked
until HTTPS exists (see lesson 2 below) — deferred to after this commit's
deploy.

**Lesson 1 — editing `schema.sql` does not touch an already-created
database**

`PRUEBA-01`'s seed insert was added to `schema.sql` §11, but Fatima's
Supabase project already existed, so nothing re-ran that file and the unit
never appeared in the picker — she had to insert it by hand.
**Rule going forward: any change to `schema.sql` gets its exact SQL handed
to Fatima separately and explicitly, to run herself in the SQL Editor.**
Editing the file only documents intent for a future from-scratch database; it
is never mistaken for having been applied.

**Lesson 2 — iOS blocks Geolocation over plain HTTP**

Real-device testing of `/operador` can't happen against `next dev` over
`http://` on iOS Safari — the Geolocation API is unavailable outside a
secure context there. Validating the actual permission prompt and
`watchPosition` on a phone waits until Commit 3's Vercel deploy gives us
HTTPS.

**Decided — corridor is fabricated but plausibly placed, one direction only**

- `lib/corridor.ts` defines 9 synthetic stops (base "San Bartolo" → terminal
  "El Toreo") with real-ish coordinates in the Naucalpan area (not surveyed —
  labeled simulated regardless). Stop `p5-informal` is deliberately placed
  off the fictional official padrón, for Commit 4 to later surface as the
  unregistered-stop finding.
- Runs are one-way (base → terminal) only; the return leg to base is not
  simulated as pings, just as elapsed clock time between runs (15–25 min).
  Modeling the return trip added ping volume and complexity for no
  Commit 4/5 deliverable that needs it. Scope-cut, not an oversight.
- **The load-triggered departure model is the piece being defended on
  camera:** each run picks a target occupancy uniformly in 60–85%, converts
  it to a passenger count against a fixed nominal capacity (18), and derives
  a wait-at-base duration from an hour-of-day passenger arrival rate (higher
  05:00–07:00, tapering after). The resulting wait time — and therefore the
  next departure's headway — is a *consequence* of that model, never a
  number chosen and inserted. Verified offline before touching the database:
  a standalone run of `generateSeededCorridorData` produced global headways
  (all 3 units' departures merged and sorted) ranging 0.3–29.3 minutes,
  average 11.2 — including a few near-simultaneous departures across
  different units, which is real bus-bunching behavior emerging from
  independent per-unit cycles drifting in and out of phase, not a bug.
- **Bug found and fixed before it shipped:** the 05:00 window start was
  originally built with `new Date().setHours(5, ...)`, which uses the
  runtime's local timezone. That's fine locally but Vercel's serverless
  functions run in UTC, so production would have silently seeded 05:00 UTC —
  11pm the previous night in Mexico City — instead of the intended rush-hour
  window. Fixed by constructing `windowStart` from UTC date parts plus a
  fixed UTC-6 offset (Mexico dropped DST nationally in 2022, so this is a
  constant, not a lookup).

**Built**

- `lib/corridor.ts`, `lib/geo.ts` (haversine + linear interpolation),
  `lib/simulator/rng.ts` (seeded PRNG so a re-seed is reproducible),
  `lib/simulator/generate.ts` — pure, no Supabase dependency, generates
  `SimUnitPlan[]` (shifts + pings) entirely in memory.
- `/admin/sembrar`: dirigencia-only page + server action
  (`app/admin/sembrar/actions.ts`) that deletes only this association's
  existing *simulated* shifts on SB-01/02/03 (cascade-deletes their pings;
  never touches `PRUEBA-01`), then inserts 3×14 fresh shifts and their pings
  in chunks of 500, all writing through the same RLS-scoped session — no
  service_role key involved.

**First move for next time**

- Push this commit, walk Fatima through the Vercel + Supabase dashboard
  steps (below, in the chat reply — not repeated here), then have her click
  "Sembrar corrida simulada" once live and confirm the row counts in
  Supabase.
- Then test `/operador` on an actual phone against the HTTPS deploy.
- Then start Commit 4 (DBSCAN inference engine) — remember to scope its
  query to `is_simulated = true` (or the three seeded units specifically) so
  a live `PRUEBA-01` test shift can never leak into the demo's inferred
  stops or headways.

---

## Session 3 — 2026-09-27 — Commit 2: driver view (`/operador`)

**Decided — `is_simulated` means "where did this row come from," not "is
this a real event"**

- `is_simulated = false` whenever a row was written by a real `watchPosition`
  call from a real device. This is the honest technical answer for that
  column, and the project's thesis is measurement honesty — the flag does
  not get bent for convenience even during dev testing.
- To keep real GPS traces (including Fatima's own, while testing the screen)
  out of the corridor being demoed, added a dedicated unit,
  `PRUEBA-01` (association 1111…, seeded in `schema.sql` §11), used for
  nothing except exercising `/operador` with a real phone. Real capture and
  seeded/simulated capture are now separated by **which unit wrote the row**,
  not by lying about `is_simulated`.
- Added `schema.sql` §14: a commented, manual-run `DELETE` block that purges
  everything under `PRUEBA-01` before a demo or recording, without touching
  the seeded corridor's units, shifts, pings, stops, or metrics. Fatima's own
  location at a specific time is her own data, even though no schema column
  names her — being cleanly deletable on purpose is what makes that
  acceptable during development.
- Two distinct, both-true on-screen labels going forward: "DATOS SIMULADOS"
  for anything read from the seeded generator (Commit 3+), "CAPTURA EN VIVO —
  PRUEBA" for anything written live from a device via `/operador` (only
  `PRUEBA-01` for now). Never conflate the two.
- Forward note for Commit 4: the DBSCAN inference pass should scope its
  query to the seeded corridor's units (or filter `is_simulated = true`) so a
  live test shift on `PRUEBA-01` can never leak into the demo's inferred
  stops or headways.

**Decided — how a phone knows which unit it is**

- The schema has no user↔unit mapping column (`memberships` only has
  `association_id` + `role`), and the schema is fixed — no new column. So a
  device's unit assignment lives in that browser's `localStorage`
  (`derrotero:unit_id`), set once via a one-time "¿Qué unidad es este
  teléfono?" picker, not re-asked on every visit. This keeps the daily driver
  screen to the required one button; unit assignment is phone setup, not a
  driver-facing control. A low-emphasis "cambiar unidad" link exists for
  reassigning a phone later.

**Built**

- `/operador`: server component gates on session + `memberships` row (same
  pattern as `/`), fetches the association's units, hands off to a client
  component.
- Unit picker (first run only, per device) → one big button that reads
  "Iniciar turno" / "Terminar turno" depending on whether an open `shifts`
  row exists for that unit (checked on load, so a reload mid-shift resumes
  rather than losing state).
- Starting a shift inserts a `shifts` row (`is_simulated: false`) and starts
  `watchPosition`; positions batch into an in-memory buffer and flush to
  `pings` every ~10s. Ending a shift stops the watch, flushes whatever is
  buffered, then sets `ended_at`.
- Denied/unavailable/unsupported geolocation each get their own readable
  Spanish message that does not blame the driver, and none of them block
  ending the shift.
- Permanent visible line: "Tu identidad nunca se registra. Solo se guarda la
  posición de la unidad {X}, nunca de una persona."

**Broke / open**

- Nothing broke. Hit a new-to-this-project ESLint rule
  (`react-hooks/set-state-in-effect`, bundled with Next 16's default config)
  that flags the standard "hydrate from localStorage" and "fetch on mount"
  patterns as errors. These are legitimate, unavoidable uses (avoiding SSR
  hydration mismatches; resuming an in-progress shift after reload) —
  suppressed with scoped, commented `eslint-disable-next-line`s rather than
  contorting the code.
- Full Google OAuth + live GPS round-trip on `/operador` still needs to be
  exercised on a real phone against the deployed/dev environment — I can
  verify the build, types, lint, and the signed-out redirect, but not the
  actual `watchPosition` permission prompt or a live shift end-to-end.

**First move for next time**

- Fatima: open `/operador` on a phone, pick `PRUEBA-01`, run a short real
  shift, confirm a `shifts` row and `pings` rows appear (`is_simulated =
  false`), then run the §14 cleanup before Commit 3's deploy.
- Then start Commit 3 (seeded simulator + first deploy).

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
