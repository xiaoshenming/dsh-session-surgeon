/** Browser half: settings-tab only. No aionui details slot, no DOM patch. */
import { settingsCopy } from "./settings-card.mjs";

export const name = "session-surgeon";
export const inject = [];
export function apply() {}
export { settingsCopy };

if (typeof globalThis !== "undefined" && globalThis.__ModuleLoader__ && typeof globalThis.__ModuleLoader__.load === "function") {
  globalThis.__ModuleLoader__.load({
    id: "dsh-session-surgeon",
    factory: () => ({ name, inject, apply, settingsCopy }),
  });
}
