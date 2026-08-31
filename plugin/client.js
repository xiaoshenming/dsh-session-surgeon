window.__ModuleLoader__.load({
  id: "dsh-session-surgeon",
  factory: () => {
    const API = "/api/session-surgeon";
    const ACTIVE = "data-dsh-surgeon-active";
    const EVENT = "dsh-panel-activate";
    function ensureCss() {
      if (document.querySelector("style[data-plugin-css='dsh-session-surgeon']")) return;
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-session-surgeon";
      document.head.appendChild(tag);
      fetch(API + "/ui.css").then((res) => res.text()).then((css) => { tag.textContent = css; }).catch(() => {});
    }
    const HEALTH = {
      ok: ["正常", "文件完好，日常聊天不用动。"],
      "header-ok": ["正常", "文件头完好，日常聊天不用动。"],
      "raw-jsonl": ["未压缩", "明文日志，一般仍能打开。"],
      "orphan-tmp": ["残留临时文件", "有 .tmp，没有正式会话文件。"],
      "header-frame-corrupt": ["文件头损坏", "官方会拒绝打开。通常只能找备份。"],
      "no-zstd-frame": ["空文件", "里面没有完整数据。"],
      "failed-middle-frame": ["中间一帧坏了", "工具不会瞎补，避免越修越坏。"],
      "seq-gap-committed": ["中间缺了一段", "官方因此打不开。若是崩溃恢复插进来的短闭包，会丢掉那几条、保住后面还在写的内容；packed 行只重叠已经提交的前缀时会接上后面连续的真内容；否则裁到缺口前最后一个完整回合。"],
      "seq-gap-tail": ["结尾不完整", "写入中断了。修复会丢掉脏尾巴。"],
      "packed-overlap-suffix": ["packed 行重叠", "官方因此打不开。修复会丢掉已经提交的前缀、保住后面连续的真内容，不发明 seq。"],
      "unparsable-line": ["有一行读不懂", "修复会丢掉读不懂的尾巴。"],
      "message-missing-id": ["消息缺 ID", "官方会整段拒读。修复只补 id，不丢内容。"],
      "dangling-tool-call": ["悬空工具调用", "文件能打开，但下次模型请求会永久 400。只定位，不会编假 tool/result。"],
      "unknown-type": ["未知事件类型", "会报告，不会删行，也不会盖 ignorable。"],
    };
    function settingsCopy() {
      return {
        title: "Session surgeon / 会话医生",
        description: "点开一条看对话；会话打不开时再检查和修好磁盘文件。",
        body: "会话医生：有 session- 前缀和没有前缀是同一种会话。\n最常用：会话 ⋯ → 复制会话 ID。\nAgent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
      };
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
      el.style.cssText = "position:fixed;z-index:90;right:16px;bottom:16px;max-width:360px;padding:8px 12px;border-radius:8px;background:#222;color:#fff;font-size:13px";
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
      entry.setAttribute("title", "查看会话内容，或修好打不开的会话");
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
    const pretty = (value) => JSON.stringify(value, null, 2);
    const sessionIdOf = (row) => row?.header?.id || row?.sessionDir || "";
    const esc = (text) => String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    const healthOf = (row) => row?.health || "?";
    const isBad = (health) => health && health !== "header-ok" && health !== "ok";
    const labelOf = (health) => (HEALTH[health] || [health, "把右侧技术细节发给我。"])[0];
    const hintOf = (health) => (HEALTH[health] || [health, "把右侧技术细节发给我。"])[1];
    const workspaceOf = (row) => row?.header?.cwd?.replace(/^\/home\/[^/]+/, "~") || (row?.project || "").replace(/^--+|--+$/g, "").replace(/-/g, "/") || "未分组";
    function explain(data) {
      if (!data || typeof data !== "object") return String(data ?? "");
      if (data.error) return "出错了：" + data.error;
      if (data.plan) {
        if (data.plan.refuse) return "现在不能修：\n" + data.plan.refuse;
        const acts = (data.plan.actions || []).map((a) => "- " + (a.detail || a.code)).join("\n");
        if (data.wrote) return "已经写回磁盘（先留了 .bak）。\n" + (acts || "没有改动。");
        return data.plan.mustWrite ? "还没改文件。若点「修好这个会话」，会做：\n" + (acts || "- 重写文件") : "检查过了，这个文件不用修。";
      }
      if (data.sessions) return "点左边一条就能看对话。有 session- 前缀和没有前缀是同一种会话。";
      if (data.messages) return (data.title ? "标题：" + data.title + "。 " : "") + "共 " + data.count + " 条可读消息。";
      if (data.health) return labelOf(data.health) + "。\n" + hintOf(data.health);
      return pretty(data);
    }
    function mountPanel(controller, ctx) {
      let container;
      const state = { rows: [], selected: "", detail: "", raw: "", busy: false, scanned: false, chat: null, titles: {} };
      const selectedRow = () => state.rows.find((r) => sessionIdOf(r) === state.selected);
        const listHtml = () => {
          const groups = new Map();
          for (const row of state.rows) { const key = workspaceOf(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
          return [...groups].flatMap(([name, rows]) => ['<div class="ss-group">' + esc(name) + " · " + rows.length + "</div>", ...rows.map((row) => { const id = sessionIdOf(row); const h = healthOf(row); return '<div class="ss-row" data-id="' + id + '"' + (id === state.selected ? " data-on" : "") + '><span class="ss-id"><span class="ss-title">' + esc(state.titles[id] || id.replace(/^session-/, "")) + '</span><span class="ss-sid">' + esc(id) + '</span></span><span class="ss-badge' + (isBad(h) ? " bad" : "") + '">' + esc(labelOf(h)) + "</span></div>"; })]).join("") || '<div class="ss-note">还没有扫描结果</div>';
        };
        const chatHtml = () => {
          const chat = state.chat;
          if (!state.selected) return "";
          if (!chat) return '<div class="ss-note">正在读对话…</div>';
          if (chat.error) return '<div class="ss-note">读对话失败：' + esc(chat.error) + "</div>";
          if (!chat.messages?.length) return '<div class="ss-note">这个文件里还没有可读的用户/助手消息。</div>';
          return '<div class="ss-chat">' + (chat.omitted ? '<div class="ss-note">更早的 ' + chat.omitted + " 条已省略。</div>" : "") + chat.messages.map((m) => '<div class="ss-msg ' + m.role + '"><div class="ss-who">' + (m.role === "user" ? "你" : "助手") + '</div><div class="ss-bubble">' + esc(m.text) + "</div></div>").join("") + "</div>";
        };
      const render = () => {
        if (!container) return;
        const selected = selectedRow();
        const health = selected ? healthOf(selected) : "";
        const main = selected
          ? '<div class="ss-note"><b>' + esc(state.chat?.title || labelOf(health)) + "</b> — " + esc(hintOf(health)) + (state.chat?.cwd ? "<br>工作区：" + esc(state.chat.cwd) : "") + "</div>"
            + '<div class="ss-idbox"><span>' + esc(state.selected) + '</span><button type="button" class="ss-btn primary" data-act="copy">复制这个 ID</button></div>'
            + '<div class="ss-actions"><button type="button" class="ss-btn" data-act="inspect">用人话检查</button><button type="button" class="ss-btn" data-act="repair">先看会改什么</button><button type="button" class="ss-btn danger" data-act="repair-apply">修好这个会话</button><button type="button" class="ss-btn" data-act="export">导出备份</button></div>'
            + '<div class="ss-note">' + (state.busy ? "处理中…" : esc(state.detail || "下面是这个会话里的对话。")) + "</div>"
            + chatHtml()
            + '<details><summary>技术细节</summary><pre>' + esc(state.raw || "还没有详细结果") + "</pre></details>"
          : '<div class="ss-note">点左边一条看对话。每个工作区各自存一套会话；有 session- 前缀和没有前缀只是新旧 ID 写法不同。<br><br>只有打不开时，才需要「先看会改什么 / 修好」。</div>';
        container.innerHTML = '<div class="ss-shell"><div class="ss-head"><div><h1>会话医生</h1><p class="ss-sub">点一条就能看对话。有 session- 前缀和没有前缀是同一种文件，不是两种会话。</p></div><div class="ss-actions"><button type="button" class="ss-btn" data-act="scan">刷新列表</button><button type="button" class="ss-btn" data-act="close">关闭</button></div></div><div class="ss-body"><div class="ss-list">' + listHtml() + '</div><div class="ss-main">' + main + "</div></div></div>";
      };
      const run = async (label, fn) => {
        if (state.busy) return;
        state.busy = true; state.detail = label + "…"; render();
        try {
          const out = await fn();
          state.raw = typeof out === "string" ? out : pretty(out);
          state.detail = explain(out);
        } catch (error) {
          state.raw = String(error?.message || error);
          state.detail = "请求失败：" + state.raw + "。若是 not found，先重启 dsh web。";
        }
        state.busy = false; render();
      };
      const loadChat = async (id) => {
        state.selected = id; state.chat = null; render();
        try {
          const data = await api(API + "/transcript?id=" + encodeURIComponent(id));
          if (state.selected !== id) return;
          state.chat = data;
          if (data.title) state.titles[id] = data.title;
          state.detail = explain(data);
        } catch (error) {
          if (state.selected !== id) return;
          state.chat = { error: String(error?.message || error), messages: [] };
        }
        render();
      };
      const scan = () => run("正在列出本机会话", async () => {
        const data = await api(API + "/scan");
        state.rows = data.sessions || [];
        state.scanned = true;
        if (!state.selected && state.rows[0]) state.selected = sessionIdOf(state.rows[0]);
        if (state.selected) loadChat(state.selected);
        return data;
      });
      const onClick = (event) => {
        const act = event.target?.closest?.("[data-act]")?.getAttribute("data-act");
        const row = event.target?.closest?.("[data-id]");
        if (row?.dataset.id && !act) loadChat(row.dataset.id);
        if (act === "close") controller.close();
        if (act === "scan") scan();
        if (act === "inspect") {
          if (!state.selected) return toast("先在左边选一个会话");
          run("正在检查", () => api(API + "/inspect?id=" + encodeURIComponent(state.selected)));
        }
        if (act === "copy") {
          const id = state.selected || currentFromCtx(ctx);
          if (!id) return toast("没有可复制的会话 ID");
          navigator.clipboard?.writeText(id).then(() => toast("已复制 " + id), () => toast(id));
        }
        if (act === "repair" || act === "repair-apply") {
          if (!state.selected) return toast("先在左边选一个会话");
          const applyWrite = act === "repair-apply";
          if (applyWrite && !window.confirm("将改写这个会话文件，并先留一份 .bak 备份。确定？")) return;
          run(applyWrite ? "正在写回文件" : "先看会改什么", () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: state.selected, apply: applyWrite }) }));
        }
        if (act === "export") {
          if (!state.selected) return toast("先在左边选一个会话");
          run("正在导出备份", async () => {
            const data = await api(API + "/export?id=" + encodeURIComponent(state.selected));
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([data.text || ""], { type: "application/x-ndjson" }));
            a.download = (data.id || state.selected) + ".jsonl";
            a.click();
            URL.revokeObjectURL(a.href);
            return "已下载备份 " + a.download;
          });
        }
      };
      const ensure = () => {
        if (container?.isConnected) return;
        container = document.createElement("div");
        container.dataset.dshSurgeonView = "";
        container.addEventListener("click", onClick);
        document.body.appendChild(container);
        render();
      };
      const applyActive = () => {
        if (controller.getSnapshot().panelOpen) {
          document.documentElement.setAttribute(ACTIVE, "");
          document.dispatchEvent(new CustomEvent(EVENT, { detail: "session-surgeon" }));
          ensure();
          if (!state.scanned) scan();
        } else document.documentElement.removeAttribute(ACTIVE);
      };
      const unsub = controller.subscribe(applyActive);
      const onActivate = (event) => { if (event.detail !== "session-surgeon") controller.close(); };
      const onOpen = (event) => {
        const id = event.detail?.id;
        if (!id) return;
        controller.open();
        loadChat(id);
        if (event.detail?.act === "repair") run("先看会改什么", () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, apply: false }) }));
      };
      document.addEventListener(EVENT, onActivate);
      document.addEventListener("dsh-surgeon-open", onOpen);
      applyActive();
      return () => { unsub(); document.removeEventListener(EVENT, onActivate); document.removeEventListener("dsh-surgeon-open", onOpen); document.documentElement.removeAttribute(ACTIVE); container?.remove(); };
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
        add("用会话医生查看", () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast("读不到会话 ID");
          document.dispatchEvent(new CustomEvent("dsh-surgeon-open", { detail: { id, act: "inspect" } }));
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
