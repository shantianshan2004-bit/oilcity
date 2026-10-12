/* ============================================================
   油城往事 · 全站逻辑
   ============================================================ */

window.App = (function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const en = (n) => String(n).padStart(2, "0");

  function navToggle() {
    const btn = $("#navToggle");
    const nav = $("#mainNav");
    if (!btn || !nav) return;
    btn.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(open));
    });
    /* 高亮当前页 */
    const here = location.pathname.split("/").pop() || "index.html";
    $$("#mainNav a").forEach((a) => {
      if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
    });
  }

  /* ---------- 页脚存储状态：如实说明 ---------- */
  function mountChrome() {
    navToggle();
    const note = $("#storageNote");
    if (!note) return;
    if (Store.mode === "cloud") {
      note.innerHTML =
        '<span class="dot on"></span>已连接云端数据源 · 阅读公开，登录后可参与共创。';
    } else {
      note.innerHTML =
        '<span class="dot"></span>云端未连接 · 当前为原文只读模式，共创写入暂不可用。';
    }
  }

  /* ---------- 通用：条目行 ---------- */
  function entryRow(item, num, href) {
    const typeLabel = { chapter: "章", character: "人", song: "曲" }[item.type] || "";
    return `
      <li class="entry reveal">
        <a href="${href}">
          <p class="idx en">${en(num)} · ${typeLabel}</p>
          <h3 class="name">${esc(item.title)}</h3>
          ${item.summary ? `<p class="desc">${esc(item.summary)}</p>` : ""}
          <p class="meta">
            ${item.date_label ? `<span>${esc(item.date_label)}</span>` : ""}
            ${item.subtitle ? `<span>${esc(item.subtitle)}</span>` : ""}
          </p>
        </a>
      </li>`;
  }

  /* ============================================================
     首页
     ============================================================ */
  function home() {
    const chapters = Store.chapters();
    const chars = Store.characters();
    const songs = Store.songs();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = en(v); };
    set("#statChapters", chapters.length);
    set("#statCharacters", chars.length);
    set("#statSongs", songs.length);

    /* 最近落笔：云端有 updated_at 就用它排序，否则按写作时间 */
    const all = chapters.concat(chars, songs).slice();
    const rank = (r) => {
      const t = r.updated_at ? Date.parse(r.updated_at) : 0;
      const d = r.date_label ? Date.parse(String(r.date_label).replace(/\./g, "-")) : 0;
      return t || d || 0;
    };
    all.sort((a, b) => rank(b) - rank(a));

    const wrap = $("#recentList");
    if (wrap) {
      wrap.innerHTML = all
        .slice(0, 5)
        .map((r, i) =>
          entryRow(
            r,
            i + 1,
            r.type === "chapter"
              ? `read.html?c=${encodeURIComponent(r.slug)}`
              : r.type === "character"
              ? `character.html?id=${encodeURIComponent(r.slug)}`
              : `song.html?id=${encodeURIComponent(r.slug)}`
          )
        )
        .join("");
      InkEngine.initReveal();
    }
  }

  /* ============================================================
     章节目录
     ============================================================ */
  function chaptersPage() {
    const list = Store.chapters();
    const wrap = $("#chapterList");
    wrap.innerHTML = list
      .map((c, i) =>
        entryRow(c, i + 1, `read.html?c=${encodeURIComponent(c.slug)}`)
      )
      .join("");

    $("#chapterCount").textContent = en(list.length);

    /* 全文检索 */
    const input = $("#searchInput");
    const out = $("#searchOut");
    input.addEventListener("input", () => {
      const q = input.value.trim();
      out.innerHTML = "";
      if (!q) return;
      const hits = Store.search(q);
      if (!hits.length) {
        out.innerHTML = `<p class="empty-note">「${esc(q)}」——墨里没有这句话。</p>`;
        return;
      }
      out.innerHTML = hits
        .slice(0, 12)
        .map((r, i) => {
          const href =
            r.type === "chapter"
              ? `read.html?c=${encodeURIComponent(r.slug)}`
              : r.type === "character"
              ? `character.html?id=${encodeURIComponent(r.slug)}`
              : `song.html?id=${encodeURIComponent(r.slug)}`;
          /* 命中片段 */
          const idx = String(r.body || "").toLowerCase().indexOf(q.toLowerCase());
          const snippet =
            idx >= 0
              ? "…" + esc(String(r.body).slice(Math.max(0, idx - 22), idx + 42)) + "…"
              : esc(r.summary || "");
          return `<li class="entry">
            <a href="${href}">
              <p class="idx en">${en(i + 1)} · 命中</p>
              <h3 class="name">${esc(r.title)}</h3>
              <p class="desc">${snippet}</p>
            </a>
          </li>`;
        })
        .join("");
    });
  }

  /* ============================================================
     阅读页
     ============================================================ */
  function readPage() {
    const slug = new URLSearchParams(location.search).get("c");
    const list = Store.chapters();
    const idx = list.findIndex((c) => c.slug === slug);
    const ch = idx >= 0 ? list[idx] : list[0];

    if (!ch) {
      $("#readerTitle").textContent = "无此章节";
      return;
    }
    document.title = `${ch.title} · 油城往事`;

    /* 目录 */
    $("#tocList").innerHTML = list
      .map(
        (c, i) => `<li>
          <a href="read.html?c=${encodeURIComponent(c.slug)}"
             ${c.slug === ch.slug ? 'aria-current="page"' : ""}>
            <span class="n en">${en(i + 1)}</span><span>${esc(c.title)}</span>
          </a>
        </li>`
      )
      .join("");

    $("#readerTitle").textContent = ch.title;
    $("#readerLabel").textContent = ch.date_label || "原文";

    /* 正文：原文按段落拆，不改一字 */
    const paras = String(ch.body || "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    $("#readerBody").innerHTML = paras
      .map((p) => `<p>${esc(p)}</p>`)
      .join("");

    /* 字数与源 */
    const chars = String(ch.body || "").replace(/\s/g, "").length;
    $("#readerStat").textContent = `${chars} 字 · ${
      ch._cloud ? "云端内容" : "原文照录"
    }`;

    /* 上下章 */
    const prev = idx > 0 ? list[idx - 1] : null;
    const next = idx < list.length - 1 ? list[idx + 1] : null;
    $("#switchPrev").innerHTML = prev
      ? `<a href="read.html?c=${encodeURIComponent(prev.slug)}">
           <span class="dir en">Prev</span><span class="t">${esc(prev.title)}</span>
         </a>`
      : `<span class="soft micro">已是第一卷</span>`;
    $("#switchNext").innerHTML = next
      ? `<a href="read.html?c=${encodeURIComponent(next.slug)}">
           <span class="dir en">Next</span><span class="t">${esc(next.title)}</span>
         </a>`
      : `<span class="soft micro">已至末卷</span>`;

    /* 阅读进度 */
    const rail = $("#progressRail");
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      rail.style.width = h > 0 ? `${Math.min(100, (scrollY / h) * 100)}%` : "0";
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* 收藏（本地，纯个人偏好，不冒充协作数据） */
    const favKey = "oilcity.fav";
    const favs = JSON.parse(localStorage.getItem(favKey) || "[]");
    const favBtn = $("#favBtn");
    const paint = () => {
      const on = favs.includes(ch.slug);
      favBtn.textContent = on ? "已收藏" : "收藏";
      favBtn.setAttribute("aria-pressed", String(on));
    };
    favBtn.addEventListener("click", () => {
      const i = favs.indexOf(ch.slug);
      if (i >= 0) favs.splice(i, 1);
      else favs.push(ch.slug);
      localStorage.setItem(favKey, JSON.stringify(favs));
      paint();
    });
    paint();
  }

  /* ============================================================
     人物列表
     ============================================================ */
  function charactersPage() {
    const list = Store.characters();
    $("#charCount").textContent = en(list.length);
    $("#charGrid").innerHTML = list
      .map(
        (c, i) => `
      <a class="char-card reveal" href="character.html?id=${encodeURIComponent(c.slug)}">
        <p class="idx en">${en(i + 1)}</p>
        <h2 class="char-name">${esc(c.title)}</h2>
        ${c.subtitle ? `<p class="char-role">${esc(c.subtitle)}</p>` : ""}
        <p class="char-desc">${esc(c.summary || "")}</p>
        <p class="char-traits">
          ${((c.data && c.data.traits) || [])
            .map((t) => `<span class="tag">${esc(t)}</span>`)
            .join("")}
        </p>
      </a>`
      )
      .join("");
    InkEngine.initReveal();
  }

  /* ============================================================
     人物详情 + 关系网
     ============================================================ */
  function characterPage() {
    const id = new URLSearchParams(location.search).get("id");
    const list = Store.characters();
    const c = list.find((x) => x.slug === id) || list[0];
    if (!c) return;
    document.title = `${c.title} · 人物 · 油城往事`;

    $("#charTitle").textContent = c.title;
    $("#charRole").textContent = c.subtitle || "";
    $("#charBody").textContent = c.body || c.summary || "";
    $("#charTraits").innerHTML = ((c.data && c.data.traits) || [])
      .map((t) => `<span class="tag">${esc(t)}</span>`)
      .join("");
    $("#charBackground").textContent =
      (c.data && c.data.background) || "暂未记录。";

    /* 关联章节 */
    const chs = ((c.data && c.data.chapters) || [])
      .map((s) => Store.bySlug(s))
      .filter(Boolean);
    $("#charChapters").innerHTML = chs.length
      ? chs
          .map(
            (x) =>
              `<li><a href="read.html?c=${encodeURIComponent(x.slug)}">
                 <span class="n en">章</span><span>${esc(x.title)}</span></a></li>`
          )
          .join("")
      : `<li class="soft micro">暂无关联章节</li>`;

    /* 关联音乐 */
    const ms = ((c.data && c.data.music) || [])
      .map((s) => Store.bySlug(s))
      .filter(Boolean);
    $("#charMusic").innerHTML = ms.length
      ? ms
          .map(
            (x) =>
              `<li><a href="song.html?id=${encodeURIComponent(x.slug)}">
                 <span class="n en">曲</span><span>${esc(x.title)}</span></a></li>`
          )
          .join("")
      : `<li class="soft micro">暂无关联乐曲</li>`;

    /* 关系网 */
    drawRelations(c, list);
  }

  /* —— 关系网络：线条与节点，不使用卡片 —— */
  function drawRelations(focus, all) {
    const host = $("#relNet");
    if (!host) return;
    const rels = ((focus.data && focus.data.relations) || []).filter(
      (r) => Store.bySlug(r.slug)
    );

    const W = 480, H = 480, CX = W / 2, CY = H / 2;
    const R = rels.length ? 158 : 0;

    const nodes = [{ slug: focus.slug, label: focus.title, x: CX, y: CY, main: true }];
    rels.forEach((r, i) => {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / rels.length + 0.34;
      nodes.push({
        slug: r.slug,
        label: (Store.bySlug(r.slug) || {}).title || r.label,
        note: r.label,
        x: CX + Math.cos(a) * R,
        y: CY + Math.sin(a) * R,
      });
    });

    /* 线：带一点弧，不是直连的规整网格 */
    const edges = nodes
      .slice(1)
      .map((n, i) => {
        const mx = (CX + n.x) / 2 + (n.y - CY) * 0.16;
        const my = (CY + n.y) / 2 - (n.x - CX) * 0.16;
        return `<path class="edge" data-to="${esc(n.slug)}"
                 d="M ${CX} ${CY} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${n.x.toFixed(1)} ${n.y.toFixed(1)}"
                 vector-effect="non-scaling-stroke"/>`;
      })
      .join("");

    /* 节点：中心是浓墨团，外围是缩小的墨点 + 字 */
    const nodeSvg = nodes
      .map((n) => {
        if (n.main) {
          return `<g class="node" data-slug="${esc(n.slug)}">
            <ellipse cx="${n.x}" cy="${n.y}" rx="34" ry="27" />
            <text x="${n.x}" y="${n.y + 58}" text-anchor="middle">${esc(n.label)}</text>
          </g>`;
        }
        return `<g class="node" data-slug="${esc(n.slug)}">
          <ellipse cx="${n.x}" cy="${n.y}" rx="14" ry="11" opacity="0.86"/>
          <text x="${n.x}" y="${n.y + 34}" text-anchor="middle">${esc(n.label)}</text>
          <text x="${n.x}" y="${n.y + 52}" text-anchor="middle"
                style="font-size:10px;fill:var(--ink-mid);letter-spacing:0.06em">
            ${esc(String(n.note || "").slice(0, 12))}
          </text>
        </g>`;
      })
      .join("");

    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${esc(focus.title)} 的关系网络">
      ${edges}${nodeSvg}
    </svg>
    ${rels.length ? "" : '<p class="empty-note">尚无关系记录。可前往共创档案补充。</p>'}`;

    /* 悬停：同时点亮连线，其余压暗 */
    host.querySelectorAll(".node").forEach((g) => {
      g.addEventListener("mouseenter", () => {
        const slug = g.dataset.slug;
        host.querySelectorAll(".node").forEach((o) => {
          o.classList.toggle("is-dim", o.dataset.slug !== slug && o.dataset.slug !== focus.slug);
        });
        host.querySelectorAll(".edge").forEach((e) => {
          e.classList.toggle("is-active", e.dataset.to === slug);
        });
      });
      g.addEventListener("mouseleave", () => {
        host.querySelectorAll(".node").forEach((o) => o.classList.remove("is-dim"));
        host.querySelectorAll(".edge").forEach((e) => e.classList.remove("is-active"));
      });
      const slug = g.dataset.slug;
      if (slug && slug !== focus.slug) {
        g.addEventListener("click", () => {
          location.href = `character.html?id=${encodeURIComponent(slug)}`;
        });
      }
    });
  }

  /* ============================================================
     留声机
     ============================================================ */

  /* —— 每一首曲目的投稿入口：音频 / 歌词 / 封面 ——
     独立于“共创档案”，从留声机页直接可用。
     尚未连接云端或未登录时，入口保留但明确拒绝，不假装可用。 */
  function songUploadRow(s, i) {
    const bits = [];
    bits.push(s.audio_path ? `<span class="tag">已有音訊</span>` : `<span class="micro">尚無音訊</span>`);
    if (s.body) bits.push(`<span class="micro">有詞</span>`);
    return `<li class="song-upload" data-slug="${esc(s.slug)}">
      <span class="en micro">${en(i + 1)}</span>
      <span class="song-upload-name">${esc(s.title)}</span>
      <span class="row" style="gap:var(--space-3)">
        ${bits.join("")}
        <button class="btn-ink" data-up="song" data-slug="${esc(s.slug)}"
                data-kind="audio">上傳音訊</button>
        <button class="btn-ink" data-up="song" data-slug="${esc(s.slug)}"
                data-kind="cover">上傳封面</button>
        <button class="btn-ink" data-up="song" data-slug="${esc(s.slug)}"
                data-kind="lyric">補寫歌詞</button>
      </span>
    </li>`;
  }

  function musicPage() {
    const list = Store.songs();
    const count = $("#songCount");
    if (count) count.textContent = en(list.length);

    /* —— 播放清單 —— */
    const wrap = $("#songList");
    if (wrap) {
      wrap.innerHTML = list
        .map(
          (s, i) => `
        <li class="song-row-item">
          <a class="song-row" href="song.html?id=${encodeURIComponent(s.slug)}">
            <span class="song-index en">${en(i + 1)}</span>
            <span>
              <span class="song-title" style="display:block">${esc(s.title)}</span>
              <span class="song-note" style="display:block">${esc(s.summary || "")}</span>
            </span>
            <span class="micro en">${s.audio_path ? "有聲" : s.body ? "詞" : "—"}</span>
          </a>
        </li>`
        )
        .join("");
    }

    /* —— 上传区 —— */
    mountSongUpload(list);
  }

  /* —— 留声机上传：独立面板，直接接共享数据源 —— */
  function mountSongUpload(list) {
    const host = $("#songUpload");
    if (!host) return;

    /* 登录态变化时重绘上传区（SDK 事件驱动） */
    Store.state.onAuthChange = () => mountSongUpload(Store.songs());

    const online = Store.mode === "cloud";
    const signed = Store.isSignedIn();

    host.innerHTML = `
      <div class="status-bar">
        <span><span class="dot ${online ? "on" : ""}"></span>${
          online ? "云端数据源已连接" : "云端未连接 · 上传暂不可用"
        }</span>
        <span><span class="dot ${signed ? "on" : ""}"></span>${
          signed ? `已登录 · ${esc(Store.userLabel())}` : "未登录 · 需登录后上传"
        }</span>
        <span class="micro">音訊 ≤ 32MB（MP3 / WAV / OGG / M4A）· 封面 ≤ 8MB</span>
      </div>

      ${
        online
          ? ""
          : `<p class="notice" style="padding:var(--space-2) 0">
               目前頁面出自非白名單網域，雲端拒絕了請求，因此上傳不可用。
               改用 <span class="en">oil-city-archives.app.workbuddy.host</span> 訪問即可恢復。
             </p>`
      }

      ${
        signed
          ? `<ul class="song-upload-list">
               ${list.map((s, i) => songUploadRow(s, i)).join("")}
             </ul>`
          : `<div id="songAuth" style="max-width:30rem;margin:var(--space-3) 0">
               <div class="field">
                 <label class="field-label" for="suEmail">Email</label>
                 <input id="suEmail" type="text" placeholder="you@example.com" autocomplete="email">
               </div>
               <div class="row" style="margin-bottom:var(--space-3)">
                 <button class="btn-ink" id="suSend">寄送驗證碼</button>
               </div>
               <div class="field">
                 <label class="field-label" for="suCode">Code</label>
                 <input id="suCode" type="text" placeholder="信件裡的驗證碼" inputmode="numeric">
               </div>
               <button class="btn-ink" id="suOk">確認登入</button>
               <p class="notice" id="suMsg" style="margin-top:var(--space-2)"></p>
             </div>`
      }

      <input type="file" id="suFile" hidden>

      <ul class="song-upload-list" id="suPending" hidden></ul>
      <p class="notice" id="suNote" style="padding-top:var(--space-2)"></p>
    `;

    const note = $("#suNote");

    /* 未登录：就地登录 */
    if (!signed && online) {
      const msg = $("#suMsg");
      $("#suSend").addEventListener("click", async () => {
        msg.textContent = "正在寄送驗證碼…";
        try {
          await Store.sendCode($("#suEmail").value);
          msg.textContent = "驗證碼已寄出，請查收信件。";
        } catch (e) {
          msg.textContent = e.message || "寄送失敗。";
        }
      });
      $("#suOk").addEventListener("click", async () => {
        msg.textContent = "正在驗證…";
        try {
          await Store.verifyCode($("#suEmail").value, $("#suCode").value);
          mountSongUpload(Store.songs());
        } catch (e) {
          msg.textContent = e.message || "驗證失敗。";
        }
      });
    }

    /* 上传：直接绑定到条目并保存 */
    let pending = null; /* { slug, kind } */

    host.querySelectorAll("[data-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (Store.mode !== "cloud") {
          note.textContent = "雲端未連接，無法上傳。";
          return;
        }
        if (!Store.isSignedIn()) {
          note.textContent = "請先登入，再上傳。";
          return;
        }
        pending = { slug: btn.dataset.slug, kind: btn.dataset.kind };
        const fileEl = $("#suFile");
        if (pending.kind === "audio") {
          fileEl.accept = "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a";
        } else {
          fileEl.accept = "image/png,image/jpeg,image/webp,image/gif";
        }
        fileEl.value = "";
        fileEl.click();
      });
    });

    $("#suFile").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!pending || !file) return;
      const { slug, kind } = pending;

      if (kind === "lyric") {
        showLyricEditor(slug);
        pending = null;
        return;
      }

      const storeKind = kind === "audio" ? "audio" : "image";
      const bad = Store.validateFile(storeKind, file);
      if (bad) {
        note.textContent = bad;
        return;
      }

      const target = Store.bySlug(slug);
      if (!target) {
        note.textContent = "找不到該條目。";
        return;
      }

      note.textContent = "上傳中…";
      try {
        const path = await Store.upload(storeKind, file, (pct) => {
          if (pct != null) note.textContent = `上傳中 ${Math.round(pct)}%`;
        });
        await Store.save(
          {
            slug,
            type: target.type,
            title: target.title,
            subtitle: target.subtitle,
            date_label: target.date_label,
            summary: target.summary,
            body: target.body,
            data: target.data,
            tags: target.tags,
            cover_path: kind === "cover" ? path : target.cover_path,
            audio_path: kind === "audio" ? path : target.audio_path,
          },
          kind === "audio" ? "更新音訊" : "更新封面"
        );
        note.textContent = "已上傳並綁定，所有讀者即時可見。";
        pending = null;
        mountSongUpload(Store.songs());
      } catch (err) {
        note.textContent = err.message || "上傳失敗。";
      }
    });

    /* 补写歌词：行内编辑，写入 body */
    function showLyricEditor(slug) {
      const s = Store.bySlug(slug);
      if (!s) return;
      const box = $("#suPending");
      box.hidden = false;
      box.innerHTML = `<li class="song-upload">
        <span class="en micro">詞</span>
        <span class="song-upload-name">${esc(s.title)}</span>
        <span style="flex:1"></span>
        <button class="btn-ink" data-cancel="1">取消</button>
      </li>
      <li style="padding:var(--space-3) 0">
        <div class="field">
          <label class="field-label" for="suLyric">Lyric / 歌詞</label>
          <textarea id="suLyric" rows="14" style="min-height:16rem"></textarea>
        </div>
        <button class="btn-ink" id="suLyricSave">送交歌詞</button>
        <p class="notice" id="suLyricMsg"></p>
      </li>`;
      const ta = $("#suLyric");
      ta.value = s.body || "";
      ta.focus();

      box.querySelector("[data-cancel]").addEventListener("click", () => {
        box.hidden = true;
        box.innerHTML = "";
      });
      $("#suLyricSave").addEventListener("click", async () => {
        const msg = $("#suLyricMsg");
        msg.textContent = "正在提交…";
        try {
          await Store.save(
            {
              slug,
              type: s.type,
              title: s.title,
              subtitle: s.subtitle,
              date_label: s.date_label,
              summary: s.summary,
              body: ta.value,
              data: s.data,
              tags: s.tags,
              cover_path: s.cover_path,
              audio_path: s.audio_path,
            },
            "更新歌詞"
          );
          msg.textContent = "已提交，所有讀者即時可見。";
          setTimeout(() => mountSongUpload(Store.songs()), 900);
        } catch (err) {
          msg.textContent = err.message || "提交失敗。";
        }
      });
    }
  }

  /* —— 单曲页：可用的播放器 —— */
  function songPage() {
    const id = new URLSearchParams(location.search).get("id");
    const list = Store.songs();
    const idx = list.findIndex((s) => s.slug === id);
    const s = idx >= 0 ? list[idx] : list[0];
    if (!s) return;
    document.title = `${s.title} · 留声机 · 油城往事`;

    $("#songTitle").textContent = s.title;
    $("#songSummary").textContent = s.summary || "";
    $("#songIndex").textContent = `${en(idx + 1)} / ${en(list.length)}`;

    /* 歌词：按段落呈现 */
    const secs = (s.data && s.data.sections) || null;
    if (secs && Array.isArray(secs) && secs.length) {
      $("#songLyric").innerHTML = secs
        .map(
          (x) =>
            `<div class="lyric-section">
               <p class="lyric-head">${esc(x.name || "")}</p>
               <p class="song-lyric">${esc(x.text || "")}</p>
             </div>`
        )
        .join("");
    } else {
      $("#songLyric").innerHTML = String(s.body || "")
        .split(/\n{2,}/)
        .map((blk) => `<div class="lyric-section"><p class="song-lyric">${esc(blk)}</p></div>`)
        .join("");
    }

    /* 创作说明 */
    const desc = (s.data && s.data.description) || "";
    $("#songDesc").textContent = desc || "暂未记录创作说明。";
    const credits = (s.data && s.data.credits) || null;
    $("#songCredits").textContent = credits
      ? typeof credits === "string"
        ? credits
        : Object.entries(credits)
            .map(([k, v]) => `${k}：${v}`)
            .join(" · ")
      : "—";

    /* 关联 */
    const rel = (s.data && s.data.related) || {};
    const relChs = (rel.chapters || []).map((x) => Store.bySlug(x)).filter(Boolean);
    const relChs2 = (rel.characters || []).map((x) => Store.bySlug(x)).filter(Boolean);
    $("#songRel").innerHTML =
      relChs
        .map(
          (x) =>
            `<li><a href="read.html?c=${encodeURIComponent(x.slug)}">
               <span class="n en">章</span><span>${esc(x.title)}</span></a></li>`
        )
        .join("") +
        relChs2
          .map(
            (x) =>
              `<li><a href="character.html?id=${encodeURIComponent(x.slug)}">
                 <span class="n en">人</span><span>${esc(x.title)}</span></a></li>`
          )
          .join("") || `<li class="soft micro">暂无关联条目</li>`;

    /* 相邻曲目 */
    $("#songPrev").innerHTML =
      idx > 0
        ? `<a href="song.html?id=${encodeURIComponent(list[idx - 1].slug)}">
             <span class="dir en">Prev</span><span class="t">${esc(list[idx - 1].title)}</span></a>`
        : `<span class="soft micro">第一首</span>`;
    $("#songNext").innerHTML =
      idx < list.length - 1
        ? `<a href="song.html?id=${encodeURIComponent(list[idx + 1].slug)}">
             <span class="dir en">Next</span><span class="t">${esc(list[idx + 1].title)}</span></a>`
        : `<span class="soft micro">最后一首</span>`;

    Player.mount(s);
    mountSongDetailUpload(s);
  }

  /* —— 单曲页投稿：与留声机首页同一套逻辑，就地可用 —— */
  function mountSongDetailUpload(s) {
    const host = $("#songUpload");
    if (!host) return;
    const online = Store.mode === "cloud";
    const signed = Store.isSignedIn();

    host.innerHTML = `
      <div class="upload-row">
        <input type="file" id="sdFile" hidden>
        <button class="btn-ink" id="sdAudio" ${online ? "" : "disabled"}>上傳音訊</button>
        <button class="btn-ink" id="sdCover" ${online ? "" : "disabled"}>上傳封面</button>
        <span class="micro">${online ? "登入後即可上傳" : "雲端未連接 · 上傳不可用"}</span>
      </div>
      ${
        signed
          ? `<p class="micro">已登入 · ${esc(Store.userLabel())}</p>`
          : `<div id="sdAuth" style="max-width:30rem;margin-top:var(--space-2)">
               <div class="row" style="gap:var(--space-2);margin-bottom:var(--space-2)">
                 <input id="sdEmail" type="text" placeholder="you@example.com"
                        style="border:0;border-bottom:1px solid var(--ink-18);background:transparent;
                               font-family:var(--serif-cn);color:inherit;padding:0.4rem 0;min-width:14rem">
                 <button class="btn-ink" id="sdSend">寄送驗證碼</button>
               </div>
               <div class="row" style="gap:var(--space-2)">
                 <input id="sdCode" type="text" placeholder="驗證碼" inputmode="numeric"
                        style="border:0;border-bottom:1px solid var(--ink-18);background:transparent;
                               font-family:var(--serif-cn);color:inherit;padding:0.4rem 0;min-width:10rem">
                 <button class="btn-ink" id="sdOk">確認登入</button>
               </div>
               <p class="notice" id="sdMsg" style="margin-top:var(--space-2)"></p>
             </div>`
      }
      <p class="notice" id="sdNote" style="margin-top:var(--space-2)"></p>
    `;

    const note = $("#sdNote");

    if (!signed) {
      const msg = $("#sdMsg");
      const send = $("#sdSend");
      const ok = $("#sdOk");
      if (send)
        send.addEventListener("click", async () => {
          msg.textContent = "正在寄送…";
          try {
            await Store.sendCode($("#sdEmail").value);
            msg.textContent = "驗證碼已寄出。";
          } catch (e) {
            msg.textContent = e.message || "寄送失敗。";
          }
        });
      if (ok)
        ok.addEventListener("click", async () => {
          msg.textContent = "正在驗證…";
          try {
            await Store.verifyCode($("#sdEmail").value, $("#sdCode").value);
            mountSongDetailUpload(s);
          } catch (e) {
            msg.textContent = e.message || "驗證失敗。";
          }
        });
    }

    let kind = "audio";
    const fileEl = $("#sdFile");
    const pick = (k) => {
      if (Store.mode !== "cloud") return;
      if (!Store.isSignedIn()) {
        note.textContent = "請先登入。";
        return;
      }
      kind = k;
      fileEl.accept =
        k === "audio"
          ? "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a"
          : "image/png,image/jpeg,image/webp,image/gif";
      fileEl.value = "";
      fileEl.click();
    };
    const aBtn = $("#sdAudio");
    const cBtn = $("#sdCover");
    if (aBtn) aBtn.addEventListener("click", () => pick("audio"));
    if (cBtn) cBtn.addEventListener("click", () => pick("cover"));

    fileEl.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const storeKind = kind === "audio" ? "audio" : "image";
      const bad = Store.validateFile(storeKind, file);
      if (bad) {
        note.textContent = bad;
        return;
      }
      note.textContent = "上傳中…";
      try {
        const path = await Store.upload(storeKind, file, (pct) => {
          if (pct != null) note.textContent = `上傳中 ${Math.round(pct)}%`;
        });
        const cur = Store.bySlug(s.slug) || s;
        await Store.save(
          {
            slug: cur.slug,
            type: cur.type,
            title: cur.title,
            subtitle: cur.subtitle,
            date_label: cur.date_label,
            summary: cur.summary,
            body: cur.body,
            data: cur.data,
            tags: cur.tags,
            cover_path: kind === "cover" ? path : cur.cover_path,
            audio_path: kind === "audio" ? path : cur.audio_path,
          },
          kind === "audio" ? "更新音訊" : "更新封面"
        );
        note.textContent = "已上傳並綁定，重新載入即可播放。";
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        note.textContent = err.message || "上傳失敗。";
      }
    });
  }

  return {
    home,
    chaptersPage,
    readPage,
    charactersPage,
    characterPage,
    musicPage,
    songPage,
    mountChrome,
    esc,
    en,
    $,
    $$,
  };
})();
