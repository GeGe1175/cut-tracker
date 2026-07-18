# Cut Tracker

Personal dashboard for cutting fat while keeping muscle. One self-contained HTML file — no build, no dependencies, data stays in the browser (localStorage).

## Run

- **Simplest:** double-click `index.html` or drag it into a browser.
- **From VS Code:** open this folder, then either
  - run `npm run dev` in the terminal and open http://localhost:8000, or
  - use the *Live Server* extension → "Go Live" on `index.html`.
- **Phone (recommended):** open https://gege1175.github.io/cut-tracker/ in Safari → Share → **Add to Home Screen**. It installs as a full-screen app with its own icon and works offline (service worker).

Note: localStorage is per-origin — `file://`, `localhost:8000`, the GitHub Pages URL, and the old claude.ai artifact each keep a separate log. Pick one home for your real data (the GitHub Pages URL is the best phone option) and use **Export backup** to move data between them.

## Deploy

Hosted on GitHub Pages from `main`. `git push` = deployed (allow a minute for the Pages build; the service worker picks up new versions on the next online launch).

## Test

`npm test` — headless smoke test (boots the app under a DOM shim, simulates logging days, asserts the guardrail verdicts).
