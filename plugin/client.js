window.__ModuleLoader__.load({
  id: "dsh-session-surgeon",
  factory: () => {
    const API = "/api/session-surgeon";
    const ACTIVE = "data-dsh-surgeon-active";
    const EVENT = "dsh-panel-activate";
    // dsh-i18n local patch: UI copy now follows the app locale (zh / en / nl).
    // Texts are looked up through T()/H() below; the module subscribes to the
    // locale service and re-renders live on switch.
    const COPY = {
      zh: {
        s: {
          "panel.title": "会话医生",
          "panel.sub": "点一条就能看对话。有 session- 前缀和没有前缀是同一种文件，不是两种会话。",
          "scan": "刷新列表",
          "close": "关闭",
          "pickHint": "点左边一条看对话。每个工作区各自存一套会话；有 session- 前缀和没有前缀只是新旧 ID 写法不同。",
          "repairHint": "只有打不开时，才需要「先看会改什么 / 修好」。",
          "emptyScan": "还没有扫描结果",
          "loadingChat": "正在读对话…",
          "chatFail": "读对话失败：",
          "chatEmpty": "这个文件里还没有可读的用户/助手消息。",
          "omitted": "更早的 {n} 条已省略。",
          "whoUser": "你",
          "whoAssistant": "助手",
          "cwd": "工作区：",
          "copyIdBtn": "复制这个 ID",
          "actInspect": "用人话检查",
          "actRepair": "先看会改什么",
          "actApply": "修好这个会话",
          "actExport": "导出备份",
          "busy": "处理中…",
          "detailDefault": "下面是这个会话里的对话。",
          "tech": "技术细节",
          "techEmpty": "还没有详细结果",
          "busyScan": "正在列出本机会话",
          "busyInspect": "正在检查",
          "busyRepairPreview": "先看会改什么",
          "busyRepairApply": "正在写回文件",
          "busyExport": "正在导出备份",
          "exported": "已下载备份 ",
          "reqFail": "请求失败：{msg}。若是 not found，先重启 dsh web。",
          "toast.pickFirst": "先在左边选一个会话",
          "toast.noCopyId": "没有可复制的会话 ID",
          "toast.copied": "已复制 ",
          "toast.noId": "读不到会话 ID",
          "confirm.apply": "将改写这个会话文件，并先留一份 .bak 备份。确定？",
          "explain.error": "出错了：",
          "explain.refuse": "现在不能修：",
          "explain.wrote": "已经写回磁盘（先留了 .bak）。",
          "explain.willDo": "还没改文件。若点「修好这个会话」，会做：",
          "explain.rewrite": "- 重写文件",
          "explain.noFix": "检查过了，这个文件不用修。",
          "explain.sessions": "点左边一条就能看对话。有 session- 前缀和没有前缀是同一种会话。",
          "explain.title": "标题：",
          "explain.count": "共 {n} 条可读消息。",
          "workspaceUngrouped": "未分组",
          "sidebar.aria": "会话医生",
          "sidebar.title": "查看会话内容，或修好打不开的会话",
          "menu.copyId": "复制会话 ID",
          "menu.view": "用会话医生查看",
          "hint.default": "把右侧技术细节发给我。",
          "settings.title": "Session surgeon / 会话医生",
          "settings.description": "点开一条看对话；会话打不开时再检查和修好磁盘文件。",
          "settings.body": "会话医生：有 session- 前缀和没有前缀是同一种会话。\n最常用：会话 ⋯ → 复制会话 ID。\nAgent tools: session_scan / session_inspect / session_repair (apply defaults to false)."
        },
        h: {
          "ok": ["正常", "文件完好，日常聊天不用动。"],
          "header-ok": ["正常", "文件头完好，日常聊天不用动。"],
          "raw-jsonl": ["未压缩", "明文日志，一般仍能打开。"],
          "orphan-tmp": ["残留临时文件", "有 .tmp，没有正式会话文件。"],
          "header-frame-corrupt": ["文件头损坏", "官方会拒绝打开。通常只能找备份。"],
          "no-zstd-frame": ["空文件", "里面没有完整数据。"],
          "failed-middle-frame": ["中间一帧坏了", "工具不会瞎补，避免越修越坏。"],
          "seq-gap-committed": ["中间缺了一段", "官方打不开。崩溃恢复短闭包会丢掉并保住后面真内容；packed 行前缀一致则接上后缀；否则裁到上一完整回合。"],
          "seq-gap-tail": ["结尾不完整", "写入中断了。修复会丢掉脏尾巴。"],
          "packed-overlap-suffix": ["packed 行重叠", "丢掉已提交且与原文一致的前缀，保住后面连续内容。"],
          "newer-format-ranges": ["较新格式", "Alpha 把 sourceEventSeqs 压成区间。不是 seq gap，不会改成旧格式，请用同一版本打开。"],
          "unparsable-line": ["有一行读不懂", "修复会丢掉读不懂的尾巴。"],
          "message-missing-id": ["消息缺 ID", "官方会整段拒读。修复只补 id，不丢内容。"],
          "empty-tool-call-id": ["空工具调用 ID", "文件能打开，但下次请求会 400（id cannot be empty）。只定位，不会编假 callId。根因在引擎出栈过滤。"],
          "dangling-tool-call": ["悬空工具调用", "文件能打开，但下次模型请求会永久 400。只定位，不会编假 tool/result。"],
          "unknown-type": ["未知事件类型", "会报告，不会删行，也不会盖 ignorable。"]
        }
      },
      en: {
        s: {
          "panel.title": "Session surgeon",
          "panel.sub": "Click a session to read the conversation. Files with and without the session- prefix are the same kind of file, not two kinds of sessions.",
          "scan": "Refresh list",
          "close": "Close",
          "pickHint": "Click a session on the left to read it. Each workspace keeps its own set of sessions; with or without the session- prefix is just an old/new ID spelling.",
          "repairHint": "Only when a session will not open do you need the “preview repair / repair” actions.",
          "emptyScan": "Nothing scanned yet",
          "loadingChat": "Reading conversation…",
          "chatFail": "Could not read the conversation: ",
          "chatEmpty": "This file has no readable user/assistant messages yet.",
          "omitted": "{n} earlier messages omitted.",
          "whoUser": "You",
          "whoAssistant": "Assistant",
          "cwd": "Workspace: ",
          "copyIdBtn": "Copy this ID",
          "actInspect": "Inspect in plain words",
          "actRepair": "Preview what would change",
          "actApply": "Repair this session",
          "actExport": "Export backup",
          "busy": "Working…",
          "detailDefault": "Below is the conversation in this session.",
          "tech": "Technical details",
          "techEmpty": "No detailed result yet",
          "busyScan": "Listing local sessions",
          "busyInspect": "Inspecting",
          "busyRepairPreview": "Previewing changes",
          "busyRepairApply": "Writing file back",
          "busyExport": "Exporting backup",
          "exported": "Downloaded backup ",
          "reqFail": "Request failed: {msg}. If it says not found, restart dsh web first.",
          "toast.pickFirst": "Select a session on the left first",
          "toast.noCopyId": "No session ID to copy",
          "toast.copied": "Copied ",
          "toast.noId": "Could not read the session ID",
          "confirm.apply": "This will rewrite the session file and keep a .bak backup first. Continue?",
          "explain.error": "Error: ",
          "explain.refuse": "Cannot repair right now:\n",
          "explain.wrote": "Written back to disk (a .bak was kept first).",
          "explain.willDo": "No file change yet. If you click “Repair this session”, it will:\n",
          "explain.rewrite": "- rewrite the file",
          "explain.noFix": "Checked: this file needs no repair.",
          "explain.sessions": "Click a session on the left to read it. With and without the session- prefix is the same session.",
          "explain.title": "Title: ",
          "explain.count": "{n} readable messages in total.",
          "workspaceUngrouped": "Ungrouped",
          "sidebar.aria": "Session surgeon",
          "sidebar.title": "View session content, or repair sessions that will not open",
          "menu.copyId": "Copy session ID",
          "menu.view": "View with session surgeon",
          "hint.default": "Send me the technical details on the right.",
          "settings.title": "Session surgeon / 会话医生",
          "settings.description": "Click a session to read it; check and repair disk files when a session will not open.",
          "settings.body": "Session surgeon: files with and without the session- prefix are the same kind of session.\nMost used: session ⋯ → Copy session ID.\nAgent tools: session_scan / session_inspect / session_repair (apply defaults to false)."
        },
        h: {
          "ok": ["OK", "File is intact; daily chat needs no action."],
          "header-ok": ["OK", "File header is intact; daily chat needs no action."],
          "raw-jsonl": ["Uncompressed", "Plain-text log; usually still opens."],
          "orphan-tmp": ["Leftover temp file", "A .tmp exists with no real session file."],
          "header-frame-corrupt": ["Corrupt file header", "The official loader will refuse it. Usually only a backup can help."],
          "no-zstd-frame": ["Empty file", "No complete data inside."],
          "failed-middle-frame": ["Broken middle frame", "The tool will not invent data, to avoid making it worse."],
          "seq-gap-committed": ["Gap in the middle", "The official loader cannot open it. Crash-recovery short closers are dropped while the real tail is kept; packed rows with a matching prefix get their suffix stitched on; otherwise it truncates to the last complete turn."],
          "seq-gap-tail": ["Incomplete ending", "The write was interrupted. Repair drops the dirty tail."],
          "packed-overlap-suffix": ["Overlapping packed row", "Drops the committed prefix that matches the original and keeps the continuous content after it."],
          "newer-format-ranges": ["Newer format", "Alpha packs sourceEventSeqs into ranges. Not a seq gap; it will not be rewritten to the old format — open it with the same version."],
          "unparsable-line": ["Unreadable line", "Repair drops the unreadable tail."],
          "message-missing-id": ["Message missing ID", "The official loader rejects the whole section. Repair only fills ids; nothing is dropped."],
          "empty-tool-call-id": ["Empty tool-call ID", "The file opens, but the next request 400s (id cannot be empty). Only located, no fake callId is invented. Root cause is in the engine's stack filtering."],
          "dangling-tool-call": ["Dangling tool call", "The file opens, but the next model request will 400 forever. Only located, no fake tool/result is invented."],
          "unknown-type": ["Unknown event type", "Reported; no rows deleted, nothing marked ignorable."]
        }
      },
      nl: {
        s: {
          "panel.title": "Sessie-chirurg",
          "panel.sub": "Klik op een sessie om het gesprek te lezen. Bestanden met en zonder het session- voorvoegsel zijn hetzelfde soort bestand, niet twee soorten sessies.",
          "scan": "Lijst vernieuwen",
          "close": "Sluiten",
          "pickHint": "Klik links op een sessie om hem te lezen. Elke werkruimte heeft zijn eigen set sessies; met of zonder het session- voorvoegsel is alleen een oud/nieuw-ID-schrijfwijze.",
          "repairHint": "Alleen als een sessie niet opent, heb je de acties “wijzigingen bekijken / repareren” nodig.",
          "emptyScan": "Nog niets gescand",
          "loadingChat": "Gesprek lezen…",
          "chatFail": "Gesprek kon niet worden gelezen: ",
          "chatEmpty": "Dit bestand bevat nog geen leesbare gebruiker/assistent-berichten.",
          "omitted": "{n} eerdere berichten weggelaten.",
          "whoUser": "Jij",
          "whoAssistant": "Assistent",
          "cwd": "Werkruimte: ",
          "copyIdBtn": "Deze ID kopiëren",
          "actInspect": "In gewone taal controleren",
          "actRepair": "Bekijk wat er zou veranderen",
          "actApply": "Deze sessie repareren",
          "actExport": "Back-up exporteren",
          "busy": "Bezig…",
          "detailDefault": "Hieronder staat het gesprek in deze sessie.",
          "tech": "Technische details",
          "techEmpty": "Nog geen gedetailleerd resultaat",
          "busyScan": "Lokale sessies weergeven",
          "busyInspect": "Controleren",
          "busyRepairPreview": "Wijzigingen bekijken",
          "busyRepairApply": "Bestand wegschrijven",
          "busyExport": "Back-up exporteren",
          "exported": "Back-up gedownload ",
          "reqFail": "Aanvraag mislukt: {msg}. Staat er not found, start dan eerst dsh web opnieuw.",
          "toast.pickFirst": "Selecteer eerst links een sessie",
          "toast.noCopyId": "Geen sessie-ID om te kopiëren",
          "toast.copied": "Gekopieerd ",
          "toast.noId": "Sessie-ID kon niet worden gelezen",
          "confirm.apply": "Dit herschrijft het sessiebestand en maakt eerst een .bak-back-up. Doorgaan?",
          "explain.error": "Fout: ",
          "explain.refuse": "Nu niet te repareren:\n",
          "explain.wrote": "Teruggeschreven naar schijf (er is eerst een .bak bewaard).",
          "explain.willDo": "Nog geen bestandswijziging. Klik je op “Deze sessie repareren”, dan gebeurt dit:\n",
          "explain.rewrite": "- het bestand herschrijven",
          "explain.noFix": "Gecontroleerd: dit bestand hoeft niet gerepareerd te worden.",
          "explain.sessions": "Klik links op een sessie om hem te lezen. Met en zonder session- voorvoegsel is dezelfde sessie.",
          "explain.title": "Titel: ",
          "explain.count": "{n} leesbare berichten in totaal.",
          "workspaceUngrouped": "Niet gegroepeerd",
          "sidebar.aria": "Sessie-chirurg",
          "sidebar.title": "Sessie-inhoud bekijken of sessies repareren die niet openen",
          "menu.copyId": "Sessie-ID kopiëren",
          "menu.view": "Bekijken met sessie-chirurg",
          "hint.default": "Stuur mij de technische details rechts.",
          "settings.title": "Session surgeon / 会话医生",
          "settings.description": "Klik op een sessie om hem te lezen; controleer en repareer schijfbestanden als een sessie niet opent.",
          "settings.body": "Sessie-chirurg: bestanden met en zonder session- voorvoegsel zijn hetzelfde soort sessie.\nMeest gebruikt: sessie ⋯ → Sessie-ID kopiëren.\nAgenttools: session_scan / session_inspect / session_repair (apply defaults to false)."
        },
        h: {
          "ok": ["OK", "Bestand is intact; voor dagelijks chatten is niets nodig."],
          "header-ok": ["OK", "Bestandskop is intact; voor dagelijks chatten is niets nodig."],
          "raw-jsonl": ["Niet gecomprimeerd", "Logboek in platte tekst; opent meestal gewoon."],
          "orphan-tmp": ["Overgebleven tijdelijk bestand", "Er is een .tmp maar geen echt sessiebestand."],
          "header-frame-corrupt": ["Bestandskop beschadigd", "De officiële lader weigert het. Meestal helpt alleen een back-up."],
          "no-zstd-frame": ["Leeg bestand", "Er zit geen complete data in."],
          "failed-middle-frame": ["Middelste frame kapot", "De tool verzint niets om te voorkomen dat het erger wordt."],
          "seq-gap-committed": ["Ontbrekend stuk in het midden", "De officiële lader kan het niet openen. Korte crashherstel-closers worden weggegooid en de echte staart blijft behouden; packed-rijen met een overeenkomend voorvoegsel krijgen hun achtervoegsel eraan vastgemaakt; anders kapt hij af tot de laatste volledige beurt."],
          "seq-gap-tail": ["Onvolledig einde", "Het wegschrijven is onderbroken. Reparatie gooit de vuile staart weg."],
          "packed-overlap-suffix": ["Overlappende packed-rij", "Gooit het vastgelegde voorvoegsel weg dat overeenkomt met het origineel en behoudt de doorlopende inhoud erna."],
          "newer-format-ranges": ["Nieuwere indeling", "Alpha perst sourceEventSeqs in bereiken. Geen seq-gap; het wordt niet naar de oude indeling herschreven — open het met dezelfde versie."],
          "unparsable-line": ["Onleesbare regel", "Reparatie gooit de onleesbare staart weg."],
          "message-missing-id": ["Bericht zonder ID", "De officiële lader wijst het hele stuk af. Reparatie vult alleen id's aan; er gaat niets verloren."],
          "empty-tool-call-id": ["Lege tool-call-ID", "Het bestand opent, maar de volgende aanvraag geeft 400 (id cannot be empty). Wordt alleen gelokaliseerd, er wordt geen nep-callId verzonnen. De oorzaak ligt in de stackfiltering van de engine."],
          "dangling-tool-call": ["Hangende tool-aanroep", "Het bestand opent, maar de volgende modelaanvraag blijft 400 geven. Wordt alleen gelokaliseerd, er wordt geen nep-tool/resultaat verzonnen."],
          "unknown-type": ["Onbekend gebeurtenistype", "Wordt gemeld; er worden geen regels verwijderd en niets wordt als ignorable gemarkeerd."]
        }
      }
    };
    const DICT_LANGS = { zh: "zh", en: "en", nl: "nl" };
    let localeId = "en";
    const REFRESHERS = new Set();
    function pickLocale(active) {
      return DICT_LANGS[active] ?? "en";
    }
    function T(key, params) {
      let text = COPY[localeId]?.s?.[key] ?? COPY.en.s[key] ?? key;
      if (params) for (const name of Object.keys(params)) text = text.replaceAll("{" + name + "}", String(params[name]));
      return text;
    }
    function H(code) {
      return COPY[localeId]?.h?.[code] ?? COPY.en.h[code] ?? [code, T("hint.default")];
    }
    function ensureCss() {
      if (document.querySelector("style[data-plugin-css='dsh-session-surgeon']")) return;
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-session-surgeon";
      document.head.appendChild(tag);
      fetch(API + "/ui.css").then((res) => res.text()).then((css) => { tag.textContent = css; }).catch(() => {});
    }
    function settingsCopy() {
      return {
        title: T("settings.title"),
        description: T("settings.description"),
        body: T("settings.body"),
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
    function mountSidebar(controller, refreshLabels) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.dshSurgeonEntry = "";
      entry.setAttribute("aria-label", T("sidebar.aria"));
      entry.setAttribute("title", T("sidebar.title"));
      entry.innerHTML = '<span aria-hidden="true">✚</span><span data-label>' + T("sidebar.aria") + "</span>";
      entry.addEventListener("click", () => controller.toggle());
      const relabel = () => {
        entry.setAttribute("aria-label", T("sidebar.aria"));
        entry.setAttribute("title", T("sidebar.title"));
        const label = entry.querySelector("[data-label]");
        if (label) label.textContent = T("sidebar.aria");
      };
      refreshLabels.add(relabel);
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
    const labelOf = (health) => H(health)[0];
    const hintOf = (health) => H(health)[1];
    const workspaceOf = (row) => row?.header?.cwd?.replace(/^\/home\/[^/]+/, "~") || (row?.project || "").replace(/^--+|--+$/g, "").replace(/-/g, "/") || T("workspaceUngrouped");
    function explain(data) {
      if (!data || typeof data !== "object") return String(data ?? "");
      if (data.error) return T("explain.error") + data.error;
      if (data.plan) {
        if (data.plan.refuse) return T("explain.refuse") + data.plan.refuse;
        const acts = (data.plan.actions || []).map((a) => "- " + (a.detail || a.code)).join("\n");
        if (data.wrote) return T("explain.wrote") + "\n" + (acts || T("explain.rewrite"));
        return data.plan.mustWrite ? T("explain.willDo") + "\n" + (acts || T("explain.rewrite")) : T("explain.noFix");
      }
      if (data.sessions) return T("explain.sessions");
      if (data.messages) return (data.title ? T("explain.title") + data.title + ". " : "") + T("explain.count", { n: data.count });
      if (data.health) return labelOf(data.health) + ".\n" + hintOf(data.health);
      return pretty(data);
    }
    function mountPanel(controller, ctx) {
      let container;
      const state = { rows: [], selected: "", detail: "", raw: "", busy: false, scanned: false, chat: null, titles: {} };
      const selectedRow = () => state.rows.find((r) => sessionIdOf(r) === state.selected);
        const listHtml = () => {
          const groups = new Map();
          for (const row of state.rows) { const key = workspaceOf(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
          return [...groups].flatMap(([name, rows]) => ['<div class="ss-group">' + esc(name) + " · " + rows.length + "</div>", ...rows.map((row) => { const id = sessionIdOf(row); const h = healthOf(row); return '<div class="ss-row" data-id="' + id + '"' + (id === state.selected ? " data-on" : "") + '><span class="ss-id"><span class="ss-title">' + esc(state.titles[id] || id.replace(/^session-/, "")) + '</span><span class="ss-sid">' + esc(id) + '</span></span><span class="ss-badge' + (isBad(h) ? " bad" : "") + '">' + esc(labelOf(h)) + "</span></div>"; })]).join("") || '<div class="ss-note">' + T("emptyScan") + "</div>";
        };
        const chatHtml = () => {
          const chat = state.chat;
          if (!state.selected) return "";
          if (!chat) return '<div class="ss-note">' + T("loadingChat") + "</div>";
          if (chat.error) return '<div class="ss-note">' + T("chatFail") + esc(chat.error) + "</div>";
          if (!chat.messages?.length) return '<div class="ss-note">' + T("chatEmpty") + "</div>";
          return '<div class="ss-chat">' + (chat.omitted ? '<div class="ss-note">' + T("omitted", { n: chat.omitted }) + "</div>" : "") + chat.messages.map((m) => '<div class="ss-msg ' + m.role + '"><div class="ss-who">' + (m.role === "user" ? T("whoUser") : T("whoAssistant")) + '</div><div class="ss-bubble">' + esc(m.text) + "</div></div>").join("") + "</div>";
        };
      const render = () => {
        if (!container) return;
        const selected = selectedRow();
        const health = selected ? healthOf(selected) : "";
        const main = selected
          ? '<div class="ss-note"><b>' + esc(state.chat?.title || labelOf(health)) + "</b> — " + esc(hintOf(health)) + (state.chat?.cwd ? "<br>" + T("cwd") + esc(state.chat.cwd) : "") + "</div>"
            + '<div class="ss-idbox"><span>' + esc(state.selected) + '</span><button type="button" class="ss-btn primary" data-act="copy">' + T("copyIdBtn") + "</button></div>"
            + '<div class="ss-actions"><button type="button" class="ss-btn" data-act="inspect">' + T("actInspect") + '</button><button type="button" class="ss-btn" data-act="repair">' + T("actRepair") + '</button><button type="button" class="ss-btn danger" data-act="repair-apply">' + T("actApply") + '</button><button type="button" class="ss-btn" data-act="export">' + T("actExport") + "</button></div>"
            + '<div class="ss-note">' + (state.busy ? T("busy") : esc(state.detail || T("detailDefault"))) + "</div>"
            + chatHtml()
            + '<details><summary>' + T("tech") + "</summary><pre>" + esc(state.raw || T("techEmpty")) + "</pre></details>"
          : '<div class="ss-note">' + T("pickHint") + "<br><br>" + T("repairHint") + "</div>";
        container.innerHTML = '<div class="ss-shell"><div class="ss-head"><div><h1>' + T("panel.title") + '</h1><p class="ss-sub">' + T("panel.sub") + '</p></div><div class="ss-actions"><button type="button" class="ss-btn" data-act="scan">' + T("scan") + '</button><button type="button" class="ss-btn" data-act="close">' + T("close") + "</button></div></div><div class=\"ss-body\"><div class=\"ss-list\">" + listHtml() + '</div><div class="ss-main">' + main + "</div></div></div>";
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
          state.detail = T("reqFail", { msg: state.raw });
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
      const scan = () => run(T("busyScan"), async () => {
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
          if (!state.selected) return toast(T("toast.pickFirst"));
          run(T("busyInspect"), () => api(API + "/inspect?id=" + encodeURIComponent(state.selected)));
        }
        if (act === "copy") {
          const id = state.selected || currentFromCtx(ctx);
          if (!id) return toast(T("toast.noCopyId"));
          navigator.clipboard?.writeText(id).then(() => toast(T("toast.copied") + id), () => toast(id));
        }
        if (act === "repair" || act === "repair-apply") {
          if (!state.selected) return toast(T("toast.pickFirst"));
          const applyWrite = act === "repair-apply";
          if (applyWrite && !window.confirm(T("confirm.apply"))) return;
          run(applyWrite ? T("busyRepairApply") : T("busyRepairPreview"), () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: state.selected, apply: applyWrite }) }));
        }
        if (act === "export") {
          if (!state.selected) return toast(T("toast.pickFirst"));
          run(T("busyExport"), async () => {
            const data = await api(API + "/export?id=" + encodeURIComponent(state.selected));
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([data.text || ""], { type: "application/x-ndjson" }));
            a.download = (data.id || state.selected) + ".jsonl";
            a.click();
            URL.revokeObjectURL(a.href);
            return T("exported") + a.download;
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
      const onLocaleTick = () => { if (container?.isConnected) render(); };
      REFRESHERS.add(onLocaleTick);
      const onActivate = (event) => { if (event.detail !== "session-surgeon") controller.close(); };
      const onOpen = (event) => {
        const id = event.detail?.id;
        if (!id) return;
        controller.open();
        loadChat(id);
        if (event.detail?.act === "repair") run(T("busyRepairPreview"), () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, apply: false }) }));
      };
      document.addEventListener(EVENT, onActivate);
      document.addEventListener("dsh-surgeon-open", onOpen);
      applyActive();
      return () => { REFRESHERS.delete(onLocaleTick); unsub(); document.removeEventListener(EVENT, onActivate); document.removeEventListener("dsh-surgeon-open", onOpen); document.documentElement.removeAttribute(ACTIVE); container?.remove(); };
    }
    function mountMenu(controller, ctx) {
      let lastRow;
      const onPointer = (event) => { const row = event.target?.closest?.("[role='treeitem']"); if (row) lastRow = row; };
      document.addEventListener("pointerdown", onPointer, true);
      const inject = (menu) => {
        if (menu.querySelector("[data-dsh-surgeon-item]")) return;
        const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map((el) => el.textContent || "");
        if (!labels.some((t) => /归档会话|Archive session|分叉会话|Fork session|Sessie archiveren|Sessie vertakken|archiveren|vertakken/i.test(t))) return;
        const sample = menu.querySelector("[role='menuitem']");
        const add = (label, fn) => {
          const btn = document.createElement("button");
          btn.type = "button"; btn.role = "menuitem"; btn.dataset.dshSurgeonItem = "";
          if (sample) btn.className = sample.className;
          btn.textContent = label;
          btn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); fn(); });
          (sample?.parentElement || menu).appendChild(btn);
        };
        add(T("menu.copyId"), async () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast(T("toast.noId"));
          try { await navigator.clipboard.writeText(id); toast(T("toast.copied") + id); } catch { toast(id); }
        });
        add(T("menu.view"), () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast(T("toast.noId"));
          document.dispatchEvent(new CustomEvent("dsh-surgeon-open", { detail: { id, act: "inspect" } }));
        });
      };
      const obs = new MutationObserver(() => { for (const menu of document.querySelectorAll("[role='menu']")) inject(menu); });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => { document.removeEventListener("pointerdown", onPointer, true); obs.disconnect(); };
    }
    function apply(ctx) {
      try {
        const refreshLabels = new Set();
        ensureCss();
        const controller = createController();
        const disposers = [mountSidebar(controller, refreshLabels), mountPanel(controller, ctx), mountMenu(controller, ctx)];
        let localeUnsub;
        if (ctx?.locale?.getLocale && ctx.locale.subscribe) {
          localeId = pickLocale(ctx.locale.getLocale().active);
          localeUnsub = ctx.locale.subscribe(() => {
            localeId = pickLocale(ctx.locale.getLocale().active);
            for (const relabel of refreshLabels) { try { relabel(); } catch { /* ignore */ } }
            for (const refresh of REFRESHERS) { try { refresh(); } catch { /* ignore */ } }
          });
          disposers.push(() => { if (localeUnsub) localeUnsub(); });
        }
        ctx?.effect?.(() => () => { for (const d of disposers) d(); }, "session-surgeon: ui");
      } catch (error) {
        console.warn("[dsh-session-surgeon] mount failed:", error);
      }
    }
    return { name: "session-surgeon", inject: ["sessions", "locale"], apply, settingsCopy };
  },
});
