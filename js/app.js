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
  function musicPage() {
    const list = Store.songs();
    $("#songCount").textContent = en(list.length);
    $("#songList").innerHTML = list
      .map(
        (s, i) => `
      <a class="song-row" href="song.html?id=${encodeURIComponent(s.slug)}">
        <span class="song-index en">${en(i + 1)}</span>
        <span>
          <span class="song-title" style="display:block">${esc(s.title)}</span>
          <span class="song-note" style="display:block">${esc(s.summary || "")}</span>
        </span>
        <span class="micro en">${s.body ? "詞" : "—"}</span>
      </a>`
      )
      .join("");
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
