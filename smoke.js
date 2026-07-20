// Headless smoke test for index.html — run with: node smoke.js
// Boots the page script under a minimal DOM shim, then simulates logging days
// and asserts the guardrail verdicts. No dependencies.
const fs = require("fs");

const rendered = {};
function makeEl(id) {
  const listeners = {};
  return {
    id, value: "", dataset: {}, style: { setProperty() {}, opacity: "" },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    set innerHTML(v) { rendered[id || "anon"] = v; this._html = v; },
    get innerHTML() { return this._html || ""; },
    set textContent(v) { rendered[(id || "anon") + ".text"] = v; },
    get textContent() { return ""; },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    _fire(t, ev) { (listeners[t] || []).forEach(f => f(ev || { preventDefault() {} })); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    appendChild() {}, setAttribute() {}, getBoundingClientRect() { return { left: 0, width: 660 }; },
    click() {},
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || makeEl(id)),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
};
let store = {};
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
global.confirm = () => false;
global.alert = () => {};
global.Blob = class {}; global.URL = { createObjectURL: () => "" }; global.FileReader = class {};

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);

const strip = h => (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const $ = id => global.document.getElementById(id);
let failures = 0;
function expect(name, cond, context) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond ? "" : "  →  " + context));
  if (!cond) failures++;
}

// 1. empty state boots
expect("boots with empty log", /Getting started|Log your weight/i.test(strip(rendered["verdict"])), strip(rendered["verdict"]));

// 2. log a normal on-plan stretch: weigh-ins over 2 weeks at target intake
const day0 = Date.now();
for (let i = 14; i >= 0; i -= 2) {
  const d = new Date(day0 - i * 86400000).toISOString().slice(0, 10);
  $("f-date").value = d;
  $("f-weight").value = (77.5 - (14 - i) * 0.085).toFixed(1);  // ~0.6 kg/wk
  $("f-kcal").value = "2300";
  $("f-protein").value = "165";
  $("logForm")._fire("submit");
}
expect("on-plan reads 'On track'", /On track/i.test(strip(rendered["verdict"])), strip(rendered["verdict"]));

// 3. under-eating day flips the verdict
const today = new Date(day0).toISOString().slice(0, 10);
$("f-date").value = today; $("f-kcal").value = "1700"; $("logForm")._fire("submit");
expect("under-eating triggers alert", /under-eating|eat more/i.test(strip(rendered["verdict"])), strip(rendered["verdict"]));

// 4. Health import: shortcut-style JSON on the clipboard merges into the log
global.navigator = {
  clipboard: {
    readText: async () =>
      JSON.stringify({ date: today, weight: "76.2 kg", kcal: "2,250 kcal", protein: "162 g" }),
  },
};
$("healthBtn")._fire("click");
setTimeout(() => {
  const row = JSON.parse(store["cutTracker.v1"]).entries.find(e => e.date === today);
  expect("health import merges clipboard day",
    row && row.weight === 76.2 && row.kcal === 2250 && row.protein === 162,
    JSON.stringify(row));

  // 5. low-step week warns that the calorie math is miscalibrated
  // (import overwrote the under-eating day, so everything else reads good)
  $("f-kcal").value = "2300"; $("f-date").value = today; $("logForm")._fire("submit");
  for (let i = 6; i >= 0; i--) {
    const d = new Date(day0 - i * 86400000).toISOString().slice(0, 10);
    $("f-date").value = d; $("f-steps").value = "3000"; $("logForm")._fire("submit");
  }
  expect("low steps flag miscalibration", /steps are down|low movement/i.test(strip(rendered["verdict"])), strip(rendered["verdict"]));

  // 6. strength decline outranks everything else that's merely warn:
  // seed a cut-best dip set 25 days back and a much weaker recent one, re-boot
  const st = JSON.parse(store["cutTracker.v1"]);
  const dstr = off => new Date(day0 - off * 86400000).toISOString().slice(0, 10);
  st.strength = [
    { date: dstr(25), lift: "Weighted dip", w: 40, reps: 8 },  // e1RM ≈ 50.7 (cut best)
    { date: dstr(1), lift: "Weighted dip", w: 30, reps: 8 },   // e1RM ≈ 38 → 75% → crit
  ];
  store["cutTracker.v1"] = JSON.stringify(st);
  eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  expect("strength drop flags crit", /strength/i.test(strip(rendered["verdict"])), strip(rendered["verdict"]));

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}, 10);
