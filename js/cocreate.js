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
        msg.textContent = e.message || "寄送失败。";
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
        msg.textContent = e.message || "验证失败。";
      }
    });
  }

  /* ---------- 列表 ---------- */
  function renderList() {
    const wrap = document.getElementById("ccList");
    if (!wrap) return;
    const all = Store.state.contents.slice();
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
      msg.textContent = e.message || "保存失败。";
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
      msg.textContent = e.message || "上传失败。";
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
          alert(e.message || "还原失败。");
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
    document.getElementById("ccGateBtn").addEventListener("click", toggleAuth);
    document.getElementById("ccNew").addEventListener("click", newEntry);
    document.getElementById("edClose").addEventListener("click", closeEditor);
    document.getElementById("edSave").addEventListener("click", doSave);
    document.getElementById("upImage").addEventListener("change", () => doUpload("image"));
    document.getElementById("upAudio").addEventListener("change", () => doUpload("audio"));
  }

  return { init, paintStatus };
})();
