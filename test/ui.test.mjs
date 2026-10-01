import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL_ID = "session-surgeon";

/**
 * Minimal browser stand-ins for the client bundle: enough for apply() to mount
 * (or fall back), so the registration the shell receives is the real one.
 * @returns the run context plus the elements and registrations it collected.
 */
function fakeBrowser() {
  const created = [];
  const registrations = [];
  const injected = [];
  const listeners = [];
  const reactCalls = [];
  const effects = [];
  const refs = [];
  const documentListeners = new Map();
  const panelSelections = [];
  const base = {
    dataset: {},
    style: {},
    children: [],
    innerHTML: "",
    isConnected: false,
    parentElement: null,
    addEventListener(type, fn) { (this.listeners ||= {})[type] = fn; },
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild(node) { this.children.push(node); node.parentElement = this; },
    replaceChildren(...nodes) { this.children = nodes; this.replaced = nodes; for (const node of nodes) node.parentElement = this; },
    remove() { this.removed = true; this.parentElement = null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
    closest() { return null; },
  };
  const documentStub = {
    documentElement: { setAttribute() {}, removeAttribute() {} },
    head: { appendChild() {} },
    body: { appendChild() {}, contains() { return true; } },
    createElement(tag) {
      const el = { ...base, tagName: String(tag).toUpperCase(), dataset: {}, style: {}, children: [] };
      created.push(el);
      return el;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) {
      const entries = documentListeners.get(type) || [];
      entries.push(fn);
      documentListeners.set(type, entries);
    },
    removeEventListener() {},
    dispatchEvent(event) { for (const fn of documentListeners.get(event.type) || []) fn(event); },
  };
  const React = {
    createElement(type, props, ...children) {
      reactCalls.push({ type, props, children });
      return { type, props, children };
    },
    useEffect(fn) { effects.push(fn); },
    useRef() { const ref = { current: null }; refs.push(ref); return ref; },
  };
  const context = {
    document: documentStub,
    window: { __ModuleLoader__: { load(value) { context.handoff = value; } } },
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async () => ({ ok: true, text: async () => "" }),
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout,
    console,
  };
  return {
    context,
    created,
    registrations,
    injected,
    listeners,
    reactCalls,
    effects,
    refs,
    panelSelections,
    createElement: (tag) => documentStub.createElement(tag),
    require(name) {
      if (name === "react") return React;
      throw new Error("unexpected module " + name);
    },
  };
}

/** Run the bundled client and hand back its factory result. */
async function loadClient(browser) {
  const source = await readFile(join(ROOT, "plugin", "client.js"), "utf8");
  vm.runInNewContext(source, browser.context, { filename: "plugin/client.js" });
  return browser.context.handoff.factory(browser.require);
}

function slotContext(browser, options) {
  return {
    locale: {
      getLocale() { return { active: "zh" }; },
      subscribe(fn) { browser.listeners.push(fn); return () => {}; },
    },
    effect() {},
    layout: { selectPanel(id) { browser.panelSelections.push(id); } },
    get(name) { return name === "layout" ? this.layout : undefined; },
    ...(options?.slots === false ? {} : {
      slots: {
        inject(name, callback) { browser.injected.push(name); callback(); return () => {}; },
        register(options2, component) { browser.registrations.push({ options: options2, component }); return () => {}; },
      },
    }),
  };
}

test("sidebar-collapse CSS matches dsh-better-sidebar's body attribute (#4/#5)", async () => {
  const css = await readFile(join(ROOT, "plugin", "ui.css"), "utf8");
  assert.ok(css.includes("body[data-dsh-sidebar-collapsed]"));
  assert.ok(!css.includes("[data-dsh-frame][data-sidebar-collapsed]"));
});

test("every session-scoped panel request names the picked root", async () => {
  const client = await readFile(join(ROOT, "plugin", "client.js"), "utf8");
  for (const endpoint of ["/scan", "/transcript", "/inspect", "/export"]) {
    assert.ok(
      client.includes('withRoot("' + endpoint + '"'),
      endpoint + " must be requested through withRoot()",
    );
  }
  // The two repair entry points POST their root in the body.
  const repairPosts = client.match(/body: JSON\.stringify\(\{ id[^}]*root: state\.root[^}]*\}\)/g) || [];
  assert.equal(repairPosts.length, 2);
  assert.ok(!client.includes('"/inspect?id="'), "raw inspect URL without a root must not come back");
  assert.ok(!client.includes('"/transcript?id="'), "raw transcript URL without a root must not come back");
});

test("the panel registers as the shell's own sidebar row and center-column page", async () => {
  const browser = fakeBrowser();
  const mod = await loadClient(browser);
  mod.apply(slotContext(browser));

  assert.deepEqual(browser.injected, ["sidebar.panellist", "main"]);
  const row = browser.registrations.find((entry) => entry.options.name === "sidebar.panellist");
  const page = browser.registrations.find((entry) => entry.options.name === "main");
  assert.ok(row, "the sidebar row seat must be registered");
  assert.ok(page, "the main seat must be registered");
  assert.equal(row.options.id, PANEL_ID);
  assert.equal(page.options.key, PANEL_ID);
  assert.equal(row.options.label(), "会话医生");
  // Negative order keeps the row ahead of Plugins (0), Schedule (10) and the
  // task board (20), which is where the plugin's own row sat before.
  assert.ok(row.options.order < 0, "the row must stay first in the panel list");

  const glyph = row.component({ size: 18, active: true });
  assert.equal(glyph.type, "svg");
  assert.equal(glyph.props["data-dsh-panel-entry"], PANEL_ID);
  assert.equal(glyph.props.width, 18);
  const panelPage = page.component();
  assert.equal(panelPage.props["data-dsh-surgeon-page"], "");
  assert.equal(panelPage.props.className, "ss-page");

  // The shell owns the row and the column now: neither the injected sidebar
  // button nor the overlay host may be created on a native shell.
  assert.ok(!browser.created.some((el) => el.dataset.dshSurgeonView === ""), "no overlay host on a native shell");
  assert.ok(!browser.created.some((el) => el.dataset.dshSurgeonEntry === ""), "no injected sidebar button on a native shell");
});

test("the native page attaches the shared shell and survives a panel switch", async () => {
  const browser = fakeBrowser();
  const mod = await loadClient(browser);
  mod.apply(slotContext(browser));
  const page = browser.registrations.find((entry) => entry.options.name === "main");
  page.component();

  const host = browser.createElement("div");
  browser.refs[0].current = host;
  const unmount = browser.effects[0]();

  const shell = host.replaced[0];
  assert.equal(shell?.className, "ss-shell");
  assert.match(shell.innerHTML, /会话医生/);
  assert.match(shell.innerHTML, /刷新列表/);

  // Switching panels unmounts the page: the shell is detached, its state stays,
  // so coming back re-attaches the same element instead of rescanning.
  unmount();
  assert.equal(shell.removed, true);
  const again = browser.createElement("div");
  browser.refs[0].current = again;
  browser.effects[0]();
  assert.equal(again.replaced[0], shell, "the same panel body must come back");
});

test("native page buttons return to chat and open the selected session", async () => {
  const browser = fakeBrowser();
  const mod = await loadClient(browser);
  mod.apply(slotContext(browser));
  const page = browser.registrations.find((entry) => entry.options.name === "main");
  page.component();
  const host = browser.createElement("div");
  browser.refs[0].current = host;
  browser.effects[0]();
  const shell = host.replaced[0];

  shell.listeners.click({ target: { closest(selector) {
    if (selector === "[data-act]") return { getAttribute() { return "close"; } };
    return null;
  } } });
  assert.deepEqual(browser.panelSelections, [null], "the back button selects the chat panel");

  const openListeners = browser.context.document;
  openListeners.dispatchEvent({ type: "dsh-surgeon-open", detail: { id: "session-picked", act: "inspect" } });
  assert.deepEqual(browser.panelSelections, [null, PANEL_ID], "the menu action selects the surgeon page");
});

test("a shell without a slot registry keeps the overlay fallback", async () => {  const browser = fakeBrowser();
  const mod = await loadClient(browser);
  mod.apply(slotContext(browser, { slots: false }));

  assert.equal(browser.injected.length, 0);
  assert.ok(browser.created.some((el) => el.dataset.dshSurgeonView === ""), "the overlay host must still mount");
  assert.ok(browser.created.some((el) => el.dataset.dshSurgeonEntry === ""), "the injected sidebar entry must still mount");
});

test("the page rides the shell's design tokens", async () => {
  const css = await readFile(join(ROOT, "plugin", "ui.css"), "utf8");
  assert.ok(css.includes("[data-dsh-surgeon-page]"), "the native page container must be styled");
  for (const token of ["--dsw-alias-bg-base", "--dsw-alias-interactive-bg-hover", "--dsw-alias-border-l3", "--dsw-radius-md"]) {
    assert.ok(css.includes("var(" + token + ")"), token + " must drive the page");
  }
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "the stylesheet must carry no hard-coded colors");
});
