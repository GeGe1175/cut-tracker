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
    closest() { return makeEl(); }, // disconnected stub — no real DOM tree here, just avoids throwing
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
  expect("lift summary row gets an e1RM sparkline once a lift has 2+ sets, and is tap-jumpable",
    /class="lft-mini-spark"/.test(rendered["liftList"]) && /data-lift="Weighted dip"/.test(rendered["liftList"]),
    rendered["liftList"]);

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
    expect("disabled guardrail card is dropped from the guardrails list entirely",
      !/Muscle risk/i.test(strip(rendered["guardrails"])),
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

    // 11. Coach's report copies the prompt to the clipboard (the direct
    // API-key path was removed 2026-08-12 — clipboard-to-Claude-app is now
    // the only path) and must drop data for any muted guardrail — Jeff
    // doesn't want the AI to see or comment on protein numbers once he's
    // turned that guardrail off, even though kcal/steps stay in.
    const aiState = JSON.parse(store["cutTracker.v1"]);
    aiState.entries = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(day0 - i * 86400000).toISOString().slice(0, 10);
      aiState.entries.push({ date: d, weight: 76, kcal: 2300, protein: 165, steps: 9000 });
    }
    aiState.config.guardrailsOn = { rate: true, kcal: true, floor: true, muscle: true, protein: false, strength: true, steps: true };
    store["cutTracker.v1"] = JSON.stringify(aiState);
    let clipped = null;
    global.navigator.clipboard.writeText = async text => { clipped = text; };
    eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
    $("aiBtn")._fire("click");
    expect("AI prompt drops protein data for a disabled guardrail but keeps kcal/steps",
      clipped && !/avg_protein_7d/.test(clipped) && !/"protein":/.test(clipped) &&
      /"avg_kcal_7d"/.test(clipped) && /"avg_steps_7d"/.test(clipped) &&
      /excluded_note/.test(clipped) && /Protein/.test(clipped),
      clipped);

    // 12. Log page's day-by-day history must drop a disabled guardrail's
    // COLUMN entirely (not show a dash — a dash there used to be visually
    // identical to "nothing logged that day", which Jeff reported as
    // looking like his data had been lost) while kcal/steps stay, and the
    // raw value stays intact in storage (editable, just not displayed).
    // (The form's per-field hide — input.closest(".field").hidden — can't
    // be verified through this DOM shim, which has no real element tree;
    // verified live in-browser instead.)
    expect("log list drops the Protein column entirely once that guardrail is off, kcal/steps stay",
      !/Protein/i.test(strip(rendered["logList"])) &&
      /2,300/.test(strip(rendered["logList"])) && /9,000/.test(strip(rendered["logList"])) &&
      !/165/.test(strip(rendered["logList"])),
      strip(rendered["logList"]));
    $("f-date").value = aiState.entries[aiState.entries.length - 1].date;
    $("f-date")._fire("change");
    expect("the underlying protein value is untouched in storage",
      JSON.parse(store["cutTracker.v1"]).entries.find(e => e.date === aiState.entries[0].date).protein === 165,
      JSON.stringify(JSON.parse(store["cutTracker.v1"]).entries[0]));

    // 13. Loss rate band is now %/wk of trend weight, not a fixed kg/wk
    // number — the exact same 0.6 kg/wk pace that reads "On track" for
    // Jeff's real ~76-79kg (test 2) should read as too fast for a much
    // lower trend weight, since 0.6 kg/wk is a far bigger share of a
    // smaller body. Confirms the band actually recomputes, not just that
    // the config field got renamed.
    const rateState = JSON.parse(store["cutTracker.v1"]);
    rateState.entries = [];
    rateState.strength = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(day0 - i * 86400000).toISOString().slice(0, 10);
      rateState.entries.push({ date: d, weight: +(40 - (13 - i) * (0.6 / 7)).toFixed(2) });
    }
    store["cutTracker.v1"] = JSON.stringify(rateState);
    eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
    expect("loss-rate band scales down for a lower trend weight (same 0.6 kg/wk now reads too fast)",
      /Loss rate[\s\S]{0,200}(Slightly fast|Too fast)/i.test(strip(rendered["guardrails"])),
      strip(rendered["guardrails"]));

    console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL PASS");
    process.exit(failures ? 1 : 0);
  }, 10);
}, 10);
