/** Browser bundle: classic script loaded by the DSH web2 client module system. */
window.__ModuleLoader__.load({
  id: "dsh-session-surgeon",
  factory: () => {
    const API = "/api/session-surgeon";
    const ACTIVE = "data-dsh-surgeon-active";
    const OTHER = ["data-dsh-ssh-active", "data-dsh-taskboard-active"];
    const EVENT = "dsh-panel-activate";
    const CSS = "[data-pane='conversation'],[class*='centerCol']{position:relative}[data-dsh-surgeon-view]{position:absolute;inset:0;display:none;z-index:60;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);overflow:auto}html[data-dsh-surgeon-active]:not([data-dsh-ssh-active]):not([data-dsh-taskboard-active]) [data-dsh-surgeon-view]{display:flex;flex-direction:column}html[data-dsh-surgeon-active]:not([data-dsh-ssh-active]):not([data-dsh-taskboard-active]) [data-pane='conversation']>:not([data-dsh-surgeon-view]),html[data-dsh-surgeon-active]:not([data-dsh-ssh-active]):not([data-dsh-taskboard-active]) [class*='centerCol']>:not([data-dsh-surgeon-view]){display:none!important}[data-dsh-surgeon-entry]{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 12px;background:transparent;border:none;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px}[data-dsh-surgeon-entry]:hover{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}[data-dsh-surgeon-entry][data-active]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:600}[data-dsh-frame][data-sidebar-collapsed] [data-dsh-surgeon-entry] span[data-label]{display:none}[data-dsh-surgeon-view] .ss-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 8px}[data-dsh-surgeon-view] h1{margin:0;font-size:18px}[data-dsh-surgeon-view] .ss-sub,[data-dsh-surgeon-view] .ss-msg{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:0 20px 12px}[data-dsh-surgeon-view] .ss-toolbar{display:flex;flex-wrap:wrap;gap:8px;padding:0 20px 12px}[data-dsh-surgeon-view] .ss-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:inherit;border-radius:8px;padding:6px 10px;font-size:13px}[data-dsh-surgeon-view] .ss-btn.danger{color:var(--dsw-alias-state-error-primary)}[data-dsh-surgeon-view] .ss-list{flex:1;overflow:auto;padding:0 12px 16px}[data-dsh-surgeon-view] .ss-row{display:flex;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer}[data-dsh-surgeon-view] .ss-row:hover,[data-dsh-surgeon-view] .ss-row[data-on]{background:var(--dsw-alias-interactive-bg-hover)}[data-dsh-surgeon-view] .ss-id{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px ui-monospace,monospace}[data-dsh-surgeon-view] .ss-health{font-size:12px}[data-dsh-surgeon-view] .ss-health.bad{color:var(--dsw-alias-state-error-primary)}[data-dsh-surgeon-view] .ss-detail{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 20px 24px;white-space:pre-wrap;font:12px/18px ui-monospace,monospace}";

    function settingsCopy() {
      return {
        title: "Session surgeon / 会话医生",
        description: "Scan and repair DeepSeek Harness sessions that refuse to load (seq gap, torn zstd, lone surrogate).",
        body: [
          "GUI: 左侧「会话医生」打开面板；会话 ⋯ 菜单可复制 ID / 检查 / 预览修复。",
          "CLI: node bin/dsh-session-surgeon.mjs scan | inspect <id> | repair <id> [--apply]",
          "Agent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
        ].join("\n"),
      };
    }

    function ensureCss() {
      if (document.querySelector("style[data-plugin-css='dsh-session-surgeon']")) return;
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-session-surgeon";
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    async function api(path, opts) {
      const res = await fetch(path, opts);
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
      if (!res.ok) throw new Error(body.error || res.statusText || String(res.status));
      return body;
    }

    function toast(message) {
      const el = document.createElement("div");
      el.textContent = message;
      el.style.cssText = "position:fixed;z-index:9999;right:16px;bottom:16px;max-width:360px;padding:8px 12px;border-radius:8px;background:#222;color:#fff;font-size:13px";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2400);
    }

    function currentFromCtx(ctx) {
      try { return ctx?.sessions?.list?.getSnapshot?.()?.current; } catch { return undefined; }
    }

    function idFromRow(row, ctx) {
      const list = ctx?.sessions?.list?.getSnapshot?.();
      if (!row) return list?.current;
      if (row.getAttribute("aria-selected") === "true" && list?.current) return list.current;
      const title = row.querySelector("[class*='title']")?.textContent?.trim();
      if (list?.byId && title) {
        const hits = Object.values(list.byId).filter((s) => s && (s.id === title || s.displayTitle === title || s.title === title));
        if (hits.length === 1) return hits[0].id;
      }
      return list?.current || title;
    }

    function createController() {
      let open = false;
      const subs = new Set();
      const notify = () => { for (const fn of subs) fn(); };
      return {
        getSnapshot() { return { panelOpen: open }; },
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
        open() { open = true; notify(); },
        close() { open = false; notify(); },
        toggle() { open = !open; notify(); },
      };
    }

    function sidebarRoot() {
      const column = document.querySelector("[data-pane='sidebar'], [class*='sidebarCol']");
      return column?.querySelector("[class*='logoRow']")?.parentElement ?? column?.firstElementChild;
    }

    function mountSidebar(controller) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.dshSurgeonEntry = "";
      entry.setAttribute("aria-label", "会话医生");
      entry.innerHTML = '<span aria-hidden="true">✚</span><span data-label>会话医生</span>';
      entry.addEventListener("click", () => controller.toggle());
      let placed = false;
      const place = () => {
        if (placed && document.body.contains(entry)) return;
        const root = sidebarRoot();
        const button = root?.querySelector("button[class*='newSession']") ?? Array.from(root?.children ?? []).find((c) => c.tagName === "BUTTON");
        if (!root || !button) return;
        const row = button.closest("[class*='logoRow']");
        const base = row && row.parentElement === root ? row : button;
        const family = Array.from(root.children).filter((el) => el.matches?.("[data-dsh-taskboard-entry],[data-dsh-ssh-entry],[data-dsh-surgeon-entry]"));
        root.insertBefore(entry, (family.at(-1) ?? base).nextElementSibling);
        placed = true;
      };
      const wait = new MutationObserver(place);
      wait.observe(document.body, { childList: true, subtree: true });
      const unsub = controller.subscribe(() => {
        if (controller.getSnapshot().panelOpen) entry.dataset.active = "true";
        else delete entry.dataset.active;
      });
      place();
      return () => { wait.disconnect(); unsub(); entry.remove(); };
    }

    function pretty(value) { return JSON.stringify(value, null, 2); }
    function sessionIdOf(row) { return row?.header?.id || row?.sessionDir || ""; }
    function esc(text) { return String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

    function mountPanel(controller, ctx) {
      let container;
      const state = { rows: [], selected: "", detail: "点「刷新扫描」列出全部会话。", busy: false };
      const render = () => {
        if (!container) return;
        const selected = state.rows.find((r) => sessionIdOf(r) === state.selected);
        const rows = state.rows.map((row) => {
          const id = sessionIdOf(row);
          const bad = row.health && row.health !== "header-ok" && row.health !== "ok";
          return '<div class="ss-row" data-id="' + id + '"' + (id === state.selected ? " data-on" : "") + '><span class="ss-id">' + esc(id) + '</span><span class="ss-health' + (bad ? " bad" : "") + '">' + esc(row.health || "?") + "</span></div>";
        }).join("");
        container.innerHTML = '<div class="ss-head"><h1>会话医生</h1><button type="button" class="ss-btn" data-act="close">关闭</button></div><div class="ss-sub">扫描 / 检查 / 预览修复 / 压缩 / 导出。应用修复会先写 .bak。</div><div class="ss-toolbar"><button type="button" class="ss-btn" data-act="scan">刷新扫描</button><button type="button" class="ss-btn" data-act="inspect">检查</button><button type="button" class="ss-btn" data-act="copy">复制 ID</button><button type="button" class="ss-btn" data-act="repair">预览修复</button><button type="button" class="ss-btn danger" data-act="repair-apply">应用修复</button><button type="button" class="ss-btn" data-act="compact">预览压缩</button><button type="button" class="ss-btn" data-act="export">导出 JSONL</button></div><div class="ss-msg">' + (state.busy ? "处理中…" : esc(selected?.health || "未选择会话")) + '</div><div class="ss-list">' + (rows || '<div class="ss-msg">还没有扫描结果</div>') + '</div><pre class="ss-detail">' + esc(state.detail) + "</pre>";
      };
      const run = async (label, fn) => {
        if (state.busy) return;
        state.busy = true; state.detail = label + "…"; render();
        try { const out = await fn(); state.detail = typeof out === "string" ? out : pretty(out); }
        catch (error) { state.detail = error?.message || String(error); }
        state.busy = false; render();
      };
      const onClick = (event) => {
        const act = event.target?.getAttribute?.("data-act");
        const row = event.target?.closest?.("[data-id]");
        if (row?.dataset.id) { state.selected = row.dataset.id; render(); }
        if (act === "close") controller.close();
        if (act === "scan") run("扫描", async () => {
          const data = await api(API + "/scan");
          state.rows = data.sessions || [];
          if (!state.selected && state.rows[0]) state.selected = sessionIdOf(state.rows[0]);
          return "共 " + (data.count ?? state.rows.length) + " 个会话\n" + pretty(data);
        });
        if (act === "inspect") {
          if (!state.selected) return toast("先选一个会话");
          run("检查", () => api(API + "/inspect?id=" + encodeURIComponent(state.selected)));
        }
        if (act === "copy") {
          const id = state.selected || currentFromCtx(ctx);
          if (!id) return toast("没有可复制的会话 ID");
          navigator.clipboard?.writeText(id).then(() => toast("已复制 " + id), () => toast(id));
        }
        if (act === "repair" || act === "repair-apply") {
          if (!state.selected) return toast("先选一个会话");
          const applyWrite = act === "repair-apply";
          if (applyWrite && !window.confirm("将改写磁盘上的 session.jsonl.zstd，并先写 .bak。<utc>。确定？")) return;
          run(applyWrite ? "应用修复" : "预览修复", () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: state.selected, apply: applyWrite }) }));
        }
        if (act === "compact") {
          if (!state.selected) return toast("先选一个会话");
          run("预览压缩", () => api(API + "/compact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: state.selected, keepLastTurns: 3, apply: false }) }));
        }
        if (act === "export") {
          if (!state.selected) return toast("先选一个会话");
          run("导出", async () => {
            const data = await api(API + "/export?id=" + encodeURIComponent(state.selected));
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([data.text || ""], { type: "application/x-ndjson" }));
            a.download = (data.id || state.selected) + ".jsonl";
            a.click();
            URL.revokeObjectURL(a.href);
            return "已下载 " + a.download + "（" + (data.bytes || 0) + " bytes）";
          });
        }
      };
      const ensure = () => {
        if (container?.isConnected) return;
        const column = document.querySelector("[data-pane='conversation'], [class*='centerCol']");
        if (!column) return;
        container = document.createElement("div");
        container.dataset.dshSurgeonView = "";
        container.addEventListener("click", onClick);
        column.appendChild(container);
        render();
      };
      const applyActive = () => {
        if (controller.getSnapshot().panelOpen) {
          for (const attr of OTHER) document.documentElement.removeAttribute(attr);
          document.documentElement.setAttribute(ACTIVE, "");
          document.dispatchEvent(new CustomEvent(EVENT, { detail: "session-surgeon" }));
        } else document.documentElement.removeAttribute(ACTIVE);
        ensure();
      };
      const wait = new MutationObserver(ensure);
      wait.observe(document.body, { childList: true, subtree: true });
      const unsub = controller.subscribe(applyActive);
      const onActivate = (event) => { if (event.detail !== "session-surgeon") controller.close(); };
      const onOpen = (event) => {
        const id = event.detail?.id;
        const act = event.detail?.act || "inspect";
        if (!id) return;
        state.selected = id;
        controller.open();
        render();
        if (act === "inspect") run("检查", () => api(API + "/inspect?id=" + encodeURIComponent(id)));
        if (act === "repair") run("预览修复", () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, apply: false }) }));
      };
      document.addEventListener(EVENT, onActivate);
      document.addEventListener("dsh-surgeon-open", onOpen);
      applyActive();
      return () => { wait.disconnect(); unsub(); document.removeEventListener(EVENT, onActivate); document.removeEventListener("dsh-surgeon-open", onOpen); document.documentElement.removeAttribute(ACTIVE); container?.remove(); };
    }

    function mountMenu(controller, ctx) {
      let lastRow;
      const onPointer = (event) => { const row = event.target?.closest?.("[role='treeitem']"); if (row) lastRow = row; };
      document.addEventListener("pointerdown", onPointer, true);
      const inject = (menu) => {
        if (menu.querySelector("[data-dsh-surgeon-item]")) return;
        const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map((el) => el.textContent || "");
        if (!labels.some((t) => /归档会话|Archive session|分叉会话|Fork session/.test(t))) return;
        const sample = menu.querySelector("[role='menuitem']");
        const add = (label, fn) => {
          const btn = document.createElement("button");
          btn.type = "button"; btn.role = "menuitem"; btn.dataset.dshSurgeonItem = "";
          if (sample) btn.className = sample.className;
          btn.textContent = label;
          btn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); fn(); });
          (sample?.parentElement || menu).appendChild(btn);
        };
        add("复制会话 ID", async () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast("读不到会话 ID");
          try { await navigator.clipboard.writeText(id); toast("已复制 " + id); } catch { toast(id); }
        });
        add("检查会话", () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast("读不到会话 ID");
          document.dispatchEvent(new CustomEvent("dsh-surgeon-open", { detail: { id, act: "inspect" } }));
        });
        add("预览修复", () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast("读不到会话 ID");
          document.dispatchEvent(new CustomEvent("dsh-surgeon-open", { detail: { id, act: "repair" } }));
        });
      };
      const obs = new MutationObserver(() => { for (const menu of document.querySelectorAll("[role='menu']")) inject(menu); });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => { document.removeEventListener("pointerdown", onPointer, true); obs.disconnect(); };
    }

    function apply(ctx) {
      try {
        ensureCss();
        const controller = createController();
        const disposers = [mountSidebar(controller), mountPanel(controller, ctx), mountMenu(controller, ctx)];
        ctx?.effect?.(() => () => { for (const d of disposers) d(); }, "session-surgeon: ui");
      } catch (error) {
        console.warn("[dsh-session-surgeon] mount failed:", error);
      }
    }

    return { name: "session-surgeon", inject: ["sessions"], apply, settingsCopy };
  },
});
