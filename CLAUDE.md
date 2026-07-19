# Cut Tracker — context for Claude

Personal single-user app for Jeff: cut fat, keep muscle. Everything lives in `index.html` (markup + CSS + ~400 lines vanilla JS). No framework, no build step, no backend — this is deliberate; don't introduce tooling unless Jeff asks for a capability that needs it (device sync, API imports).

## Where it's published
**Primary (Jeff's phone): GitHub Pages** — https://gege1175.github.io/cut-tracker/ (repo `GeGe1175/cut-tracker`, Pages serves `main` at `/`). Deploy = `git push`. Installed as a home-screen PWA (manifest + apple meta tags + `sw.js` network-first service worker for offline). Jeff still needs to migrate his log from the artifact origin (Export backup there → Import here); until confirmed, his real data is on the artifact origin below.

**Legacy: claude.ai artifact** at https://claude.ai/code/artifact/9490127c-1f5e-46e8-9312-84ba30e07094 — kept as a fallback; claude.ai wraps it in its own page (iframe), so PWA tags can't work there and the manifest/icon/sw requests silently fail (harmless, guarded). To update it: call the Artifact tool with `index.html`'s path AND `url` set to that link — without `url`, a new conversation mints a different URL. Keep favicon 🎯 and title "Cut Tracker".

## What the app does
- Daily log (date / weight kg / kcal / protein g) → localStorage under key `cutTracker.v1`. Partial entries fine; fields merge per date.
- Trend chart: raw weigh-ins as faint dots, 7-day trailing average as the line, dashed goal lines at 12% (74 kg) and 10% (72.2 kg). Mark legend below; 1w/1m/All range chips (`config.chartRange`) window the *display only* — regression and averages always use full data.
- Daily log rows: tap to load a day back into the form for editing (same-date submit merges non-null fields); swipe left to reveal Delete (two-step on purpose — the old always-visible × was too easy to fat-finger).
- Six guardrails over the last 7 logged days, worst one becomes the headline verdict:
  1. **Loss rate** — target band 0.5–0.7 kg/wk; >1.0 is crit.
  2. **Eating your target** — flags *under*-eating vs the 2,300 kcal target. This is the app's reason to exist: Jeff once averaged ~1,700 vs a 2,300 target and lost serious strength (weighted dips 40 kg → bodyweight). Under-target must always be at least as loud as over-target.
  3. **Energy floor** — any single day below RMR (1,964) is crit.
  4. **Muscle risk** — intake-based deficit (maintenance − avg kcal) vs fat-supply ceiling (fatMass × 30 kcal/kg/day ≈ 381).
  5. **Protein** — ≥160 g/day.
  6. **Activity** — 7-day avg steps vs the 8k–12k band the maintenance estimate assumes. Warn-only (never crit) and deliberately LAST in order: it's a calibration check on the calorie math, not a compliance target, and steps must never enter the deficit calculation (device burn numbers are 20–30% noise — the scale trend is the real expenditure meter).
- Progress bars to both goals with ETA from current rate; settings panel (all targets editable); JSON export/import.
- **Import from Health**: reads clipboard JSON put there by Jeff's iOS Shortcut (`{"date":"yyyy-mm-dd","weight":"76.2 kg","kcal":"2,250 kcal","protein":"162 g","steps":"9,800"}`, single object or array). Units/commas stripped; zero kcal/protein skipped (zero = "no Health samples", importing it would fabricate a crit under-eating day). Merges per date like manual entry. This is the stepping stone to a Capacitor+HealthKit native app (Jeff's stated goal) — keep the parse/merge split so native can reuse it.

## Non-obvious design decisions (don't silently reverse)
- **Loss rate = linear regression** over the last 21 days of weigh-ins, widening to all data when the window has <2 points or <7 days span. Never day-to-day deltas — daily swings are glycogen/water.
- **Muscle risk uses the intake deficit, not the scale-derived one.** Early-cut water/glycogen losses make kg-on-the-scale × 7,700 kcal wildly overstate the true deficit and would contradict the other cards.
- **Muscle-risk bands are deliberately loose** (good ≤ ceiling+200, warn to +450, crit beyond): Jeff's *planned* 500 kcal deficit slightly exceeds the ~381 fat ceiling. If on-plan reads yellow forever, the signal dies. Keep "on-plan = green".
- Verdict priority is crit > warn > good, first match in guardrail order — deliberate, so under-eating outranks everything else at equal severity.
- Weekly averages over daily numbers, everywhere, in every message shown to Jeff.
- **Visual identity** (2026-07 pass): "clinical instrument" — cool grey-blue neutrals, tabular mono numerals, severity colors. Wordmark + day counter use Avenir Next Condensed via `--display` (ships on Apple platforms; no font files — CSP). The signature element is the six-segment strip in the verdict hero (RATE·KCAL·FLOOR·MUSCLE·PROTEIN·STEPS — plain words; Jeff couldn't parse cuter abbreviations), one tick per guardrail in card order, tap scrolls to the card — it exists to make the "verdict = worst of six" logic visible; don't decorate it or reorder it away from the guardrail order.

## Jeff's numbers (defaults baked into `DEFAULTS.config`)
RMR 1,964 (hard floor) · cut target 2,300 · maintenance ~2,800 · protein 160 g · rate band 0.5–0.7 kg/wk · cut start 2026-06-25 @ 79.4 kg · goals 74.0 (12%) / 72.2 kg (10%) · fat mass 12.7 kg (June 2026 DEXA). If Jeff reports a new DEXA, update these defaults AND remind him to change the settings panel (localStorage config overrides defaults for existing users).

Upcoming: 2-week Japan trip at maintenance (~2,800) — if he mentions it, that's planned, not a lapse; guardrails judge vs whatever calTarget is set to, so he should bump it in settings for the trip.

## Verify changes
`npm test` runs `smoke.js`: boots the script under a minimal DOM shim, simulates two weeks of on-plan logging, then an under-eating day, and asserts the verdicts ("On track" → "under-eating"). Extend it when adding guardrails. There's no browser automation here; for visual checks, open `index.html` (or `npm run dev` → localhost:8000).

## Gotchas
- localStorage is per-origin: file://, localhost, GitHub Pages, and the artifact URL hold separate data. Jeff's real data belongs on the GitHub Pages origin (migration from the artifact via Export/Import was pending as of 2026-07-19 — confirm it happened before assuming).
- Storage key is `cutTracker.v1`. If you change the data shape, migrate on load — don't bump the key and orphan his log.
- The page is published as an artifact: strict CSP, no external requests, so it must stay fully self-contained (it already is — keep it that way).
- File starts with `<title>` directly (no doctype/html/head/body) because the Artifact tool wraps it; browsers handle it fine locally too.
