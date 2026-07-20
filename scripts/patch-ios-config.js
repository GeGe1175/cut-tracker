// `npx cap sync ios` recomputes packageClassList from installed npm plugin
// packages and silently wipes any custom entry we hand-write in the root
// capacitor.config.json — our HealthSyncPlugin isn't an npm package, so it's
// invisible to that scan. Capacitor's native runtime (CapacitorBridge.swift)
// reads this exact bundled file to know which extra Swift classes to
// register via NSClassFromString, so without this patch the plugin compiles
// fine but is never registered, and registerPlugin() fails at runtime with
// "plugin is not implemented on ios". Re-apply after every sync.
const fs = require("fs");
const path = "ios/App/App/capacitor.config.json";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.packageClassList = ["HealthSyncPlugin"];
fs.writeFileSync(path, JSON.stringify(cfg, null, "\t") + "\n");
console.log("Patched " + path + " packageClassList -> HealthSyncPlugin");
