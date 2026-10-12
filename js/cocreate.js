/* ============================================================
   油城往事 · 共创档案
   ------------------------------------------------------------
   阅读公开；写入需登录。所有保存都经共享数据源，
   并且每次保存前自动留一份版本快照。
   云端未连接时，编辑入口明确禁用并说明原因。
   ============================================================ */

window.CoCreate = (function () {
  "use strict";

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let editing = null; /* 当前编辑的条目 */

  /* 网络层错误翻译成可操作的中文，避免只显示英文 TypeError */
  function friendly(e) {
    const m = (e && e.message) || String(e || "");
    if (/failed to fetch|networkerror|network error|load failed/i.test(m))
      return "网络请求被中断（请求未到达服务器）。可能是网络瞬断——系统已自动重试仍失败，请稍候再试；若反复出现请更换网络。";
    if (/credential|401|unauthenticated/i.test(m))
      return "登录已失效，请重新登录后再操作。";
    return m || "操作失败，请重试。";
  }

  /* ---------- 状态条 ---------- */
  function paintStatus() {
    const el = document.getElementById("ccStatus");
    if (!el) return;
    const online = Store.mode === "cloud";
    const signed = Store.isSignedIn();
    el.innerHTML = `
      <span><span class="dot ${online ? "on" : ""}"></span>${
        online ? "云端数据源已连接" : "云端未连接 · 仅可阅读原文"
      }</span>
      <span><span class="dot ${signed ? "on" : ""}"></span>${
        signed ? `已登录 · ${esc(Store.userLabel())}` : "未登录 · 可读不可写"
      }</span>
      <span class="micro">修改会即时同步给所有读者</span>
    `;
    const gate = document.getElementById("ccGate");
    if (gate) gate.textContent = signed ? "退出登录" : "登录后可编辑";
    const gateBtn = document.getElementById("ccGateBtn");
    if (gateBtn) gateBtn.disabled = !online;
  }

  /* ---------- 登录面板 ---------- */
  function toggleAuth() {
    if (Store.mode !== "cloud") {
      alert("云端未连接，当前只能阅读原文，无法登录或编辑。");
      return;
    }
    if (Store.isSignedIn()) {
      Store.signOut().then(() => {
        paintStatus();
        renderList();
      });
      return;
    }
    const p = document.getElementById("authPanel");
    p.hidden = !p.hidden ? true : false;
  }

  function wireAuth() {
    const emailEl = document.getElementById("authEmail");
    const codeEl = document.getElementById("authCode");
    const sendBtn = document.getElementById("authSend");
    const okBtn = document.getElementById("authOk");
    const msg = document.getElementById("authMsg");

    sendBtn.addEventListener("click", async () => {
      msg.textContent = "正在寄送验证码…";
      try {
        await Store.sendCode(emailEl.value);
        msg.textContent = "验证码已寄出，请查收信箱。";
        codeEl.focus();
      } catch (e) {
        msg.textContent = friendly(e);
      }
    });

    okBtn.addEventListener("click", async () => {
      msg.textContent = "正在验证…";
      try {
        await Store.verifyCode(emailEl.value, codeEl.value);
        msg.textContent = "已登录。";
        document.getElementById("authPanel").hidden = true;
        paintStatus();
        renderList();
      } catch (e) {
        msg.textContent = friendly(e);
      }
    });
  }

  /* ---------- 列表 ---------- */
  function renderList() {
    const wrap = document.getElementById("ccList");
    if (!wrap) return;
    const all = Store.state.contents.slice();
    const signed = Store.isSignedIn();
    wrap.innerHTML = all
      .map((r) => {
        const typeLabel = { chapter: "章节", character: "人物", song: "乐曲" }[r.type] || r.type;
        return `<li class="version-row">
          <span class="v-time en">${typeLabel}</span>
          <span style="flex:1">
            <a class="underscore" href="#" data-edit="${esc(r.slug)}">${esc(r.title)}</a>
            ${r.subtitle ? `<span class="soft micro"> · ${esc(r.subtitle)}</span>` : ""}
          </span>
          <span class="micro">${r.updated_at ? esc(Store.fmtTime(r.updated_at)) : ""}</span>
          <button class="btn-ink" data-hist="${esc(r.slug)}">版本</button>
          ${
            signed
              ? `<button class="btn-ink" data-del="${esc(r.slug)}"
                   title="删除该条目">删除</button>`
              : ""
          }
        </li>`;
      })
      .join("");

    wrap.querySelectorAll("[data-edit]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openEditor(a.dataset.edit);
      })
    );
    wrap.querySelectorAll("[data-hist]").forEach((b) =>
      b.addEventListener("click", () => openHistory(b.dataset.hist))
    );
    wrap.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => askDelete(b.dataset.del))
    );
  }

  /* ---------- 删除 ----------
     删除不可逆：先弹一层内联确认（要求输入 slug 才放行），
     避免误点；云端条目与本地种子条目分别说明后果。 */
  function askDelete(slug) {
    if (Store.mode !== "cloud") {
      alert("云端未连接，无法删除。");
      return;
    }
    if (!Store.isSignedIn()) {
      alert("请先登录，再删除条目。");
      return;
    }
    const r = Store.bySlug(slug);
    if (!r) {
      alert("找不到该条目。");
      return;
    }

    const host = document.getElementById("ccDelete");
    if (!host) return;
    const fromCloud = !!r._cloud;

    host.hidden = false;
    host.innerHTML = `
      <div class="status-bar" style="border-color:var(--accent);margin-bottom:var(--space-3)">
        <span><span class="dot on" style="background:var(--accent)"></span>确认删除</span>
        <span class="micro">此操作不可撤销</span>
      </div>
      <p class="notice" style="text-align:left">
        即将删除「<strong>${esc(r.title)}</strong>」（<span class="en">${esc(slug)}</span>）。
        ${
          fromCloud
            ? "该条目及其全部历史版本将从云端永久移除，所有读者立刻不可见。"
            : "该条目目前只是内置原文，云端没有对应记录，删除不会产生任何效果。"
        }
      </p>
      <div class="field">
        <label class="field-label">输入 slug 以确认：<span class="en">${esc(slug)}</span></label>
        <input id="ccDelConfirm" type="text" autocomplete="off" placeholder="${esc(slug)}">
      </div>
      <div class="row" style="gap:var(--space-3)">
        <button class="btn-ink" id="ccDelGo">确认删除</button>
        <button class="btn-ink" id="ccDelCancel">取消</button>
      </div>
      <p class="notice" id="ccDelMsg" style="text-align:left;padding-top:var(--space-2)"></p>
    `;

    const msg = document.getElementById("ccDelMsg");
    const input = document.getElementById("ccDelConfirm");
    input.focus();

    document.getElementById("ccDelCancel").addEventListener("click", () => {
      host.hidden = true;
      host.innerHTML = "";
    });

    document.getElementById("ccDelGo").addEventListener("click", async () => {
      if (String(input.value).trim() !== slug) {
        msg.textContent = "输入的 slug 与条目不符，未执行删除。";
        return;
      }
      const btn = document.getElementById("ccDelGo");
      btn.disabled = true;
      msg.textContent = "正在删除…";
      try {
        await Store.remove(slug);
        host.hidden = true;
        host.innerHTML = "";
        renderList();
      } catch (e) {
        msg.textContent = friendly(e);
        btn.disabled = false;
      }
    });
  }

  /* ---------- 编辑器 ---------- */
  function openEditor(slug) {
    if (Store.mode !== "cloud") {
      alert("云端未连接，无法编辑。");
      return;
    }
    if (!Store.isSignedIn()) {
      alert("请先登录，再参与共创。");
      return;
    }
    const r = slug
      ? Store.bySlug(slug)
      : { slug: "", type: "chapter", title: "", body: "", summary: "", data: {} };
    editing = r;

    const p = document.getElementById("editorPanel");
    p.classList.add("is-open");
    document.body.style.overflow = "hidden";

    document.getElementById("edTitle").value = r.title || "";
    document.getElementById("edSub").value = r.subtitle || "";
    document.getElementById("edSummary").value = r.summary || "";
    document.getElementById("edBody").value = r.body || "";
    document.getElementById("edType").value = r.type || "chapter";
    document.getElementById("edSlug").value = r.slug || "";
    document.getElementById("edMsg").textContent = "";
    document.getElementById("edFiles").innerHTML = "";
    document.getElementById("edRel").innerHTML = "";
  }

  function closeEditor() {
    document.getElementById("editorPanel").classList.remove("is-open");
    document.body.style.overflow = "";
    editing = null;
  }

  async function doSave() {
    const msg = document.getElementById("edMsg");
    const title = document.getElementById("edTitle").value.trim();
    const type = document.getElementById("edType").value;
    let slug = document.getElementById("edSlug").value.trim();
    if (!slug) slug = Store.slugify(title);

    const entry = {
      slug,
      type,
      title,
      subtitle: document.getElementById("edSub").value.trim(),
      summary: document.getElementById("edSummary").value.trim(),
      body: document.getElementById("edBody").value,
      data: (editing && editing.data) || {},
      date_label: (editing && editing.date_label) || undefined,
    };

    if (!title) {
      msg.textContent = "标题不能为空。";
      return;
    }

    msg.textContent = "正在提交…";
    try {
      await Store.save(entry, editing && editing.slug ? "内容修改" : "新建条目");
      msg.textContent = "已保存并同步。";
      closeEditor();
      paintStatus();
      renderList();
    } catch (e) {
      msg.textContent = friendly(e);
    }
  }

  /* ---------- 上传 ---------- */
  async function doUpload(kind) {
    const input = document.getElementById(kind === "image" ? "upImage" : "upAudio");
    const msg = document.getElementById("edMsg");
    if (!editing || !editing.slug) {
      msg.textContent = "请先保存条目，再上传文件。";
      return;
    }
    const file = input.files && input.files[0];
    const bad = Store.validateFile(kind, file);
    if (bad) {
      msg.textContent = bad;
      return;
    }
    msg.textContent = "上传中…";
    try {
      const path = await Store.upload(kind, file, (pct) => {
        if (pct != null) msg.textContent = `上传中 ${Math.round(pct)}%`;
      });
      editing[kind === "image" ? "cover_path" : "audio_path"] = path;
      await Store.save(
        {
          slug: editing.slug,
          type: editing.type,
          title: editing.title,
          subtitle: editing.subtitle,
          summary: editing.summary,
          body: editing.body,
          data: editing.data,
          cover_path: editing.cover_path,
          audio_path: editing.audio_path,
        },
        kind === "image" ? "更新封面" : "更新音频"
      );
      msg.textContent = "已上传并绑定。";
    } catch (e) {
      msg.textContent = friendly(e);
    }
  }

  /* ---------- 版本历史 ---------- */
  async function openHistory(slug) {
    if (Store.mode !== "cloud") {
      alert("云端未连接，无法读取版本历史。");
      return;
    }
    const r = Store.bySlug(slug);
    const box = document.getElementById("edRel");
    document.getElementById("editorPanel").classList.add("is-open");
    document.body.style.overflow = "hidden";
    document.getElementById("edTitle").value = r ? r.title : "";
    document.getElementById("edSub").value = r ? r.subtitle || "" : "";
    document.getElementById("edSummary").value = r ? r.summary || "" : "";
    document.getElementById("edBody").value = r ? r.body || "" : "";
    document.getElementById("edType").value = r ? r.type : "chapter";
    document.getElementById("edSlug").value = slug;
    editing = r;
    document.getElementById("edMsg").textContent = "以下为历史版本，可还原。";

    const box2 = document.getElementById("edFiles");
    box2.innerHTML = '<p class="micro">载入中…</p>';
    const revs = await Store.revisionsOf(slug);
    box2.innerHTML = revs.length
      ? revs
          .map(
            (v) => `<div class="version-row">
              <span class="v-time en">${esc(Store.fmtTime(v.created_at))}</span>
              <span style="flex:1">${esc(v.note || "修改")}${
              v.editor_name ? ` · ${esc(v.editor_name)}` : ""
            }</span>
              <button class="btn-ink" data-restore="${v.id}">还原</button>
            </div>`
          )
          .join("")
      : '<p class="empty-note">尚无历史版本。</p>';

    box2.querySelectorAll("[data-restore]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await Store.restore(Number(b.dataset.restore));
          alert("已还原。");
          openHistory(slug);
        } catch (e) {
          alert(friendly(e));
        }
      })
    );
  }

  /* ---------- 新建 ---------- */
  function newEntry() {
    openEditor("");
  }

  /* ---------- 初始化 ---------- */
  function init() {
    paintStatus();
    renderList();
    wireAuth();

    /* 登录态由 SDK 事件驱动：续期、退出、失效都即时反映到界面 */
    Store.state.onAuthChange = () => {
      /* 登录态一变，之前展开的删除确认即失效，收起避免误操作 */
      const del = document.getElementById("ccDelete");
      if (del) {
        del.hidden = true;
        del.innerHTML = "";
      }
      paintStatus();
      renderList();
    };

    /* 页面从后台切回时校验一次会话，避免长时间停留后令牌过期 */
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        Store.readSession().then(() => {
          paintStatus();
          renderList();
        });
      }
    });

    document.getElementById("ccGateBtn").addEventListener("click", toggleAuth);
    document.getElementById("ccNew").addEventListener("click", newEntry);
    document.getElementById("edClose").addEventListener("click", closeEditor);
    document.getElementById("edSave").addEventListener("click", doSave);
    document.getElementById("upImage").addEventListener("change", () => doUpload("image"));
    document.getElementById("upAudio").addEventListener("change", () => doUpload("audio"));
  }

  return { init, paintStatus };
})();
