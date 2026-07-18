# Cut Tracker

Personal dashboard for cutting fat while keeping muscle. One self-contained HTML file — no build, no dependencies, data stays in the browser (localStorage).

## Run

- **Simplest:** double-click `index.html` or drag it into a browser.
- **From VS Code:** open this folder, then either
  - run `npm run dev` in the terminal and open http://localhost:8000, or
  - use the *Live Server* extension → "Go Live" on `index.html`.
- **Phone:** use the published artifact URL (see CLAUDE.md) and add it to your home screen.

Note: localStorage is per-origin — `file://`, `localhost:8000`, and the artifact URL each keep a separate log. Pick one home for your real data (the artifact URL is the best phone option) and use **Export backup** to move data between them.

## Test

`npm test` — headless smoke test (boots the app under a DOM shim, simulates logging days, asserts the guardrail verdicts).
