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

  // 7. Chat: a food photo/description round-trips through Claude tool-use
  // and produces a taggable kcal/protein/carbs/fat estimate in state.chat.
  store["cutTracker.apiKey"] = "fake-key-for-test";
  let lastFetchBody = null;
  global.fetch = async (url, opts) => {
    lastFetchBody = JSON.parse(opts.body);
    return {
      json: async () => ({
        content: [
          { type: "text", text: "Looks like a solid protein bowl." },
          { type: "tool_use", name: "log_food_estimate",
            input: { food_description: "chicken rice bowl", kcal: 620, protein: 52, carbs: 55, fat: 18 } }
        ]
      })
    };
  };
  $("chatText").value = "chicken rice bowl for lunch";
  $("chatForm")._fire("submit");
  setTimeout(() => {
    expect("chat request includes the user message",
      lastFetchBody && lastFetchBody.messages.length === 1 && lastFetchBody.tools[0].name === "log_food_estimate",
      JSON.stringify(lastFetchBody && lastFetchBody.messages));

    const chat = JSON.parse(store["cutTracker.v1"]).chat;
    const reply = chat[1];
    expect("chat tool-use response captures kcal/protein/carbs/fat",
      reply && reply.kcal === 620 && reply.protein === 52 && reply.carbs === 55 && reply.fat === 18,
      JSON.stringify(reply));
    expect("chat renders an add-to-today button with all four macros",
      /\+ Add 620 kcal, 52g protein, 55g carbs, 18g fat to today/.test(strip(rendered["chatList"])),
      strip(rendered["chatList"]));

    // 8. Guardrail on/off: disabling "Muscle risk" removes it from the
    // verdict even though its own numbers would otherwise flag a crit.
    const gState = JSON.parse(store["cutTracker.v1"]);
    gState.strength = []; // isolate from step 6's crit-triggering strength data
    gState.entries = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(day0 - i * 86400000).toISOString().slice(0, 10);
      gState.entries.push({ date: d, weight: 76, kcal: 2300, protein: 165, steps: 9000 });
    }
    gState.config.maintenance = 3200; // widen the intake deficit past the fat ceiling -> muscle risk crit
    gState.config.guardrailsOn = { rate: true, kcal: true, floor: true, muscle: false, protein: true, strength: true, steps: true };
    store["cutTracker.v1"] = JSON.stringify(gState);
    eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
    expect("disabled guardrail card explains it's off",
      /Muscle risk[\s\S]{0,120}Disabled in Targets/i.test(strip(rendered["guardrails"])),
      strip(rendered["guardrails"]));
    // (the segment strip always shows the plain word "Muscle" as a label
    // regardless of on/off state, so check the verdict tag/message, not
    // whether "muscle" appears anywhere in the hero's markup)
    expect("disabled guardrail excluded from verdict even though its data would crit",
      /On track/i.test(strip(rendered["verdict"])) && !/muscle's at risk/i.test(strip(rendered["verdict"])),
      strip(rendered["verdict"]));

    // 9. Personal records: best reps per weight, with a same-weight regression
    // (8 reps -> 6 reps at 40kg) surfaced for "am I getting weaker" at a glance.
    // (The per-weight trend chart and the delete-a-set button only render/wire
    // on click, which this DOM shim's querySelectorAll stub can't simulate —
    // both were verified live in-browser instead; see CLAUDE.md.)
    const prState = JSON.parse(store["cutTracker.v1"]);
    prState.strength = [
      { date: dstr(20), lift: "Weighted dip", w: 40, reps: 8 },
      { date: dstr(5), lift: "Weighted dip", w: 40, reps: 6 },
    ];
    store["cutTracker.v1"] = JSON.stringify(prState);
    eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
    expect("personal records table flags a rep regression at the same weight",
      /40 kg[\s\S]{0,150}best 8 reps[\s\S]{0,50}latest 6 reps/i.test(strip(rendered["liftDetail"])),
      strip(rendered["liftDetail"]));

    // 10. Deleting a set (what the row's × button does under the hood —
    // splice the entry out, save, re-render) should drop the regression
    // badge once only the best set remains.
    const delState = JSON.parse(store["cutTracker.v1"]);
    delState.strength = delState.strength.filter(s => !(s.w === 40 && s.reps === 6));
    store["cutTracker.v1"] = JSON.stringify(delState);
    eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
    expect("removing the regressed set clears the warning badge",
      /40 kg[\s\S]{0,60}1 set[\s\S]{0,60}best 8 reps/i.test(strip(rendered["liftDetail"])) &&
      !/latest 6 reps/i.test(strip(rendered["liftDetail"])),
      strip(rendered["liftDetail"]));

    console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL PASS");
    process.exit(failures ? 1 : 0);
  }, 10);
}, 10);
