/* ============================================================
   油城往事 · 活墨引擎（Living Ink · Organic Diffusion）
   ------------------------------------------------------------
   墨是"渗"出来的：一团墨落在吸水的纸上，沿纸纤维慢慢洇开，
   边缘长出毛细的须，中心积成深色的池，颜料随时间干去、
   淡去，然后另一团墨在别处悄悄落纸。
   每次打开页面种子不同，落点、大小、浓淡、寿命都不一样。

   四条物理规则
     1. 有机轮廓   每团墨的边界由三维值噪声（角度×角度×时间）
                  扰动出来 —— 不规则、不对称、随时间缓慢蠕动，
                  不是圆形，也不是缩放平移
     2. 多层浓度   每团墨是 12 层错位的轮廓叠印：外层大而淡、
                  内层小而浓，叠出"中心浓黑、边缘灰晕"的梯度；
                  各层轮廓不完全重合，边缘自然成纤维状渗染
     3. 毛细渗透   墨渍边缘长出细须（纤维状扩散），随时间
                  舒展、消隐；大墨渍干后颜料聚向边缘（咖啡环）
     4. 慢速漂移   墨心被无散度流场推着极缓地走，半径按
                  √t 毛细扩散生长、再随呼吸噪声起伏，
                  各墨渍的速度、周期、寿命彼此独立

   绘制开销
     墨渍形变极慢，贴图每 ~130ms 才重生成一次（分摊到各帧）；
     每帧只是 clearRect + 少量 drawImage —— 无滤镜、无逐像素运算。
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 纸与墨：纯黑 / 深灰 / 浅灰，米白由纸承担 ---------- */
  const INK = { r: 23, g: 23, b: 21 };
  const inkA = (a) => "rgba(" + INK.r + "," + INK.g + "," + INK.b + "," + a + ")";

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  /* ---------- 确定性随机（种子不同 → 每次呈现不同） ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ============================================================
     1. 三维值噪声
     ------------------------------------------------------------
     值噪声：格点上有确定的伪随机值，坐标之间做平滑插值。
     fbm 两层倍频叠加，足够有机，且比 simplex 便宜。
     一切"不规则"都来自它：轮廓蠕动、半径呼吸、浓度斑驳。
     ============================================================ */
  function hash3(x, y, z) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const fade = (t) => t * t * (3 - 2 * t);

  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    const c000 = hash3(xi, yi, zi),       c100 = hash3(xi + 1, yi, zi);
    const c010 = hash3(xi, yi + 1, zi),   c110 = hash3(xi + 1, yi + 1, zi);
    const c001 = hash3(xi, yi, zi + 1),   c101 = hash3(xi + 1, yi, zi + 1);
    const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf);
    const x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
    return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
  }

  function fbm3(x, y, z) {
    return 0.646 * noise3(x, y, z) + 0.354 * noise3(x * 2.13 + 31.4, y * 2.13 + 17.7, z * 2.13 + 5.9);
  }

  /* ============================================================
     2. 流场：标量势 φ 的旋度（无散度 → 墨只被推着走）
     ============================================================ */
  const GH = 1.7;
  const _v = [0, 0];

  function potential(x, y, t, k) {
    return (
      Math.sin(x * k.f1 + t * k.s1) * Math.cos(y * k.f2 - t * k.s2) +
      0.62 * Math.sin((x + y) * k.f3 - t * k.s3) +
      0.45 * Math.cos((x - y) * k.f4 + t * k.s4)
    );
  }

  function flowAt(x, y, t, k, out) {
    const a = potential(x, y + GH, t, k);
    const b = potential(x, y - GH, t, k);
    const c = potential(x + GH, y, t, k);
    const d = potential(x - GH, y, t, k);
    const dx = (a - b) / (2 * GH);
    const dy = -(c - d) / (2 * GH);
    const m = Math.sqrt(dx * dx + dy * dy) || 1;
    out[0] = dx / m;
    out[1] = dy / m;
    return out;
  }

  /* ============================================================
     3. 三类墨渍
     ------------------------------------------------------------
     wash 泼   大而淡，寿命长，几乎不动，干后颜料聚向边缘
     pool 池   中等，核心浓黑 —— 画面的重心所在
     speck 点  小而重，短命 —— 颗粒感与呼吸
     ============================================================ */
  const KINDS = {
    wash: {
      r0: [90, 160],        /* 基础半径（px） */
      life: [70, 130],      /* 寿命（秒） */
      baseA: 0.62,          /* 整体浓度 */
      edgeAmp: 0.42,        /* 轮廓扰动幅度（比例） */
      cFreq: 1.25,          /* 轮廓噪声频率 → 少瓣、更不对称 */
      cSpeed: [0.03, 0.07], /* 轮廓蠕动速度 */
      bSpeed: [0.015, 0.03],/* 呼吸速度 */
      diffuse: 30,          /* 毛细扩散（越大长得越慢） */
      maxGrow: 1.6,
      drift: 3.5,           /* 漂移速度 */
      fiber: 1.0,           /* 毛细须的量 */
      ringy: 0.75,          /* 咖啡环概率 */
      blotch: 3,            /* 内部深斑数量 */
      sat: 4,               /* 卫星墨点数量 */
    },
    pool: {
      r0: [46, 110],
      life: [45, 90],
      baseA: 0.9,
      edgeAmp: 0.32,
      cFreq: 1.8,
      cSpeed: [0.05, 0.12],
      bSpeed: [0.025, 0.05],
      diffuse: 14,
      maxGrow: 1.5,
      drift: 7,
      fiber: 0.6,
      ringy: 0.2,
      blotch: 5,
      sat: 2,
    },
    speck: {
      r0: [7, 24],
      life: [22, 48],
      baseA: 0.95,
      edgeAmp: 0.24,
      cFreq: 2.8,
      cSpeed: [0.08, 0.18],
      bSpeed: [0.04, 0.08],
      diffuse: 6,
      maxGrow: 1.35,
      drift: 11,
      fiber: 0.25,
      ringy: 0,
      blotch: 0,
      sat: 0,
    },
  };
  const KIND_NAMES = ["wash", "pool", "speck"];

  /* 参数完备性断言：一次编辑事故（字段丢失 → NaN → 静默不画）
     足以让整层墨消失，这里把字段名列全，缺一个就早点炸出来。 */
  const KIND_FIELDS = [
    "r0", "life", "baseA", "edgeAmp", "cFreq", "cSpeed", "bSpeed",
    "diffuse", "maxGrow", "drift", "fiber", "ringy", "blotch", "sat",
  ];
  for (let ki = 0; ki < KIND_NAMES.length; ki++) {
    const K = KINDS[KIND_NAMES[ki]];
    for (let fi = 0; fi < KIND_FIELDS.length; fi++) {
      if (K[KIND_FIELDS[fi]] === undefined) {
        throw new Error("ink-engine: KINDS." + KIND_NAMES[ki] + "." + KIND_FIELDS[fi] + " 缺失");
      }
    }
  }

  /* ============================================================
     4. 一团墨
     ============================================================ */
  function makeBlot(kind, x, y, rnd, scaleK) {
    const K = KINDS[kind];
    const r0 = lerp(K.r0[0], K.r0[1], rnd()) * scaleK;

    /* 出生时就带好全套"个性"：噪声种子、蠕动速度、呼吸相位、
       毛细须的角度分布、内部深斑的落点、卫星墨点的位置。
       这些只定一次，之后只随时间演化 —— 形状稳定地变，不闪变。 */
    const fibers = [];
    if (K.fiber > 0) {
      const n = Math.max(3, Math.round((r0 / 9) * K.fiber));
      for (let i = 0; i < n; i++) {
        fibers.push({
          ang: rnd() * TAU,
          len: 0.1 + rnd() * 0.26,
          w: 0.6 + rnd() * 1.4,
          a: 0.05 + rnd() * 0.1,
          ph: rnd() * 10,
        });
      }
    }
    const blotches = [];
    for (let i = 0; i < K.blotch; i++) {
      blotches.push({
        ox: (rnd() - 0.5) * 0.9,
        oy: (rnd() - 0.5) * 0.9,
        r: 0.16 + rnd() * 0.22,
        a: 0.22 + rnd() * 0.3,
        salt: rnd() * 20,
      });
    }
    const sats = [];
    for (let i = 0; i < K.sat; i++) {
      sats.push({
        ang: rnd() * TAU,
        dist: 1.15 + rnd() * 0.55,
        r: 1.5 + rnd() * 5,
        a: 0.18 + rnd() * 0.3,
      });
    }

    return {
      kind: kind,
      x: x, y: y,
      vx: 0, vy: 0,
      r0: r0,
      r: r0,
      age: 0,
      life: lerp(K.life[0], K.life[1], rnd()),
      lifeT: 0,
      seed: rnd() * 100,
      /* 轮廓与呼吸 */
      cSpeed: lerp(K.cSpeed[0], K.cSpeed[1], rnd()),
      bSpeed: lerp(K.bSpeed[0], K.bSpeed[1], rnd()),
      bPh: rnd() * 10,
      /* 拉伸（横向洇开）：方向与幅度都由噪声慢调 */
      stAng: rnd() * TAU,
      stSpeed: 0.01 + rnd() * 0.03,
      stAmp: 0.22 + rnd() * 0.42,
      ringy: rnd() < K.ringy,
      fibers: fibers,
      blotches: blotches,
      sats: sats,
      /* 渲染 */
      cv: null,
      cvPad: 0,
      nextR: 0,
      baseA: K.baseA * (0.82 + rnd() * 0.36),
      salt: rnd() * 50,
    };
  }

  /* 轮廓半径系数：角度 × 时间 → fbm 噪声扰动。
     salt 让每层叠印、每个墨渍的轮廓彼此错开。 */
  function contourAt(b, ang, t, salt) {
    const u = Math.cos(ang) * KINDS[b.kind].cFreq + b.seed * 1.7 + salt;
    const v = Math.sin(ang) * KINDS[b.kind].cFreq + b.seed * 0.9 + salt * 0.6;
    const w = t * b.cSpeed + b.seed + salt * 0.31;
    return 1 + KINDS[b.kind].edgeAmp * (fbm3(u, v, w) - 0.5) * 2;
  }

  /* 生命周期包络：淡入 → 驻留 → 缓缓淡去 */
  function envOf(b) {
    const fi = clamp(b.lifeT / 0.12, 0, 1);
    const fadeIn = fi * fi * (3 - 2 * fi);
    const fo = clamp((b.lifeT - 0.62) / 0.38, 0, 1);
    const fadeOut = 1 - fo * fo * (3 - 2 * fo);
    return fadeIn * fadeOut;
  }

  /* ============================================================
     5. 一层墨（一个页面一层）
     ============================================================ */
  const ANCHOR_SEL = [
    ".hero-title", ".hero-lines", ".hero-meta", ".hero-entries", ".hero-scroll",
    ".title-lg", ".reader-title", ".section-title", ".rule-ink",
    ".music-hero", ".cocreate-hero", ".ink-search",
    ".volume", ".entry", ".char-card", ".song-item", ".rel-net",
    ".player", ".colophon", "#musicUpload",
  ].join(",");

  /* 需要"识别到墨迹就自动描边"的文字。 */
  const TEXT_SEL = [
    ".hero-title-cn", ".hero-line", ".hero-sub",
    ".title-lg", ".reader-title", ".section-title",
    ".volume-name", ".volume-desc",
    ".entry .name", ".entry .desc",
    ".reading p", ".lede", ".hero-meta-num",
    ".colophon p",
  ].join(",");

  class LivingInk {
    constructor(host) {
      this.host = host;

      const canvas = document.createElement("canvas");
      canvas.className = "ink-canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);

      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true });

      const seed = (Math.random() * 0xffffffff) >>> 0;
      this.seed = seed;
      this.rnd = mulberry32(seed);

      this.blobs = [];
      this.t = 0;
      this.frame = 0;
      this.acc = 0;
      this.last = 0;
      this.lastHalo = 0;
      this.raf = 0;
      this.w = 0;
      this.h = 0;
      this.dpr = 1;

      /* 全场共用的流场参数（每个墨渍的响应速度各自不同） */
      this.k = {
        f1: 0.0014 + this.rnd() * 0.0018,
        f2: 0.0016 + this.rnd() * 0.0020,
        f3: 0.0009 + this.rnd() * 0.0013,
        f4: 0.0011 + this.rnd() * 0.0015,
        s1: 0.020 + this.rnd() * 0.028,
        s2: 0.016 + this.rnd() * 0.024,
        s3: 0.012 + this.rnd() * 0.020,
        s4: 0.014 + this.rnd() * 0.022,
      };

      /* 覆盖度栅格：文字描边判定用 */
      this.cell = 44;
      this.cols = 1;
      this.rows = 1;
      this.grid = new Float32Array(1);

      this.anchors = [];
      this.texts = [];
      this.debug = /inkdebug/.test(window.location.search || "");

      const area = Math.max(1, (window.innerWidth || 1200) * (window.innerHeight || 800));
      const mobile = Math.min(window.innerWidth || 1200, window.innerHeight || 800) < 640;
      this.mobile = mobile;
      /* 画面尺度：小屏上墨渍等比缩小，留白才守得住 */
      this.opt = {
        scaleK: clamp(Math.sqrt(area / (1440 * 900)), 0.55, 1),
        /* 各类墨渍的目标数量：写意要留白，宁可少而重 */
        target: mobile
          ? { wash: 1, pool: 2, speck: 3 }
          : { wash: 2, pool: 4, speck: 4 },
      };

      this.resize(true);
    }

    /* ---------- 尺寸 ---------- */
    resize(initial) {
      const w = Math.max(1, this.host.clientWidth || window.innerWidth);
      const h = Math.max(1, this.host.clientHeight || window.innerHeight);

      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      const maxArea = 2.6e6;
      if (w * h * dpr * dpr > maxArea) dpr = Math.sqrt(maxArea / (w * h));
      dpr = Math.max(1, dpr);

      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      /* 贴图分辨率：大墨渍不必跟满 dpr，省一半光栅化开销 */
      this.sdpr = Math.min(dpr, 1.5);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   /* 之后一律用 CSS 像素坐标 */

      this.cell = w < 640 ? 36 : 44;
      this.cols = Math.max(1, Math.ceil(w / this.cell));
      this.rows = Math.max(1, Math.ceil(h / this.cell));
      this.grid = new Float32Array(this.cols * this.rows);

      /* 墨渍跟着新视口收进来（每帧整体重绘，不需要搬迁旧画面） */
      for (let i = 0; i < this.blobs.length; i++) {
        const b = this.blobs[i];
        b.x = clamp(b.x, -b.r, this.w + b.r);
        b.y = clamp(b.y, -b.r, this.h + b.r);
      }
      if (!initial) this.render();
    }

    /* ---------- 覆盖度栅格 ---------- */
    gridAdd(x, y, r, amt) {
      const c = this.cell;
      const x0 = Math.max(0, Math.floor((x - r) / c));
      const x1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
      const y0 = Math.max(0, Math.floor((y - r) / c));
      const y1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
      for (let gy = y0; gy <= y1; gy++) {
        const row = gy * this.cols;
        for (let gx = x0; gx <= x1; gx++) {
          const i = row + gx;
          const v = this.grid[i] + amt;
          this.grid[i] = v > 1 ? 1 : v;
        }
      }
    }

    gridCover(l, t, r, b) {
      const c = this.cell;
      const x0 = Math.max(0, Math.floor(l / c));
      const x1 = Math.min(this.cols - 1, Math.floor((r - 1) / c));
      const y0 = Math.max(0, Math.floor(t / c));
      const y1 = Math.min(this.rows - 1, Math.floor((b - 1) / c));
      if (x1 < x0 || y1 < y0) return 0;
      let sum = 0;
      let n = 0;
      for (let gy = y0; gy <= y1; gy++) {
        const row = gy * this.cols;
        for (let gx = x0; gx <= x1; gx++) {
          sum += this.grid[row + gx];
          n++;
        }
      }
      return n ? sum / n : 0;
    }

    /* ---------- UI 锚点：墨从界面元素附近长出来 ---------- */
    collectAnchors() {
      const out = [];
      let nodes = [];
      try {
        nodes = document.querySelectorAll(ANCHOR_SEL);
      } catch (_) {
        nodes = [];
      }
      const sy = window.scrollY || window.pageYOffset || 0;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        out.push({
          el: el,
          left: r.left,
          top: r.top + sy,
          w: r.width,
          h: r.height,
        });
      }
      this.anchors = out;
    }

    collectTexts() {
      const out = [];
      let nodes = [];
      try {
        nodes = document.querySelectorAll(TEXT_SEL);
      } catch (_) {
        nodes = [];
      }
      const sy = window.scrollY || window.pageYOffset || 0;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.height < 8) continue;
        const fs = parseFloat(window.getComputedStyle(el).fontSize) || 16;
        const hw = fs >= 30 ? 5 : fs >= 19 ? 3.4 : 2.1;
        if (el.__haloW !== hw) {
          el.__haloW = hw;
          el.style.setProperty("--halo-w", hw + "px");
        }
        out.push({
          el: el,
          left: r.left,
          top: r.top + sy,
          w: r.width,
          h: r.height,
          on: false,
        });
      }
      this.texts = out;
    }

    /* 锚点附近取落墨点：多数落在文字块外侧，偶尔压进文字里 */
    anchorPoint(a) {
      const R = this.rnd;
      const sy = window.scrollY || window.pageYOffset || 0;
      const top = a.top - sy;
      const p = R();
      let x;
      if (p < 0.4) x = a.left - 20 - R() * 90;
      else if (p < 0.7) x = a.left + a.w + 20 + R() * 100;
      else x = a.left + a.w * (0.1 + R() * 0.8);
      const y = top + a.h * (0.1 + R() * 0.95) + (R() - 0.5) * 40;
      return { x: clamp(x, -30, this.w + 30), y: clamp(y, -30, this.h + 30) };
    }

    pickAnchor() {
      if (!this.anchors.length) this.collectAnchors();
      const list = this.anchors;
      if (!list.length) return null;
      const sy = window.scrollY || window.pageYOffset || 0;
      for (let tryN = 0; tryN < 6; tryN++) {
        const cand = list[(this.rnd() * list.length) | 0];
        const vt = cand.top - sy;
        if (vt > -120 && vt < this.h + 120) return cand;
      }
      return list[(this.rnd() * list.length) | 0];
    }

    /* ---------- 落墨 ---------- */
    spawnPoint() {
      const a = this.pickAnchor();
      if (a) return this.anchorPoint(a);
      return { x: this.rnd() * this.w, y: this.rnd() * this.h };
    }

    /* 只统计"活着"的墨渍：淡出期的（lifeT > 0.78）视觉上已近乎消失，
       不能占着目标名额 —— 否则补墨逻辑会误以为构图还满着，画面就空了 */
    countKind(kind) {
      let n = 0;
      for (let i = 0; i < this.blobs.length; i++) {
        const b = this.blobs[i];
        if (b.kind === kind && b.lifeT < 0.78) n++;
      }
      return n;
    }

    spawn(kind, x, y) {
      const b = makeBlot(kind, x, y, this.rnd, this.opt.scaleK);
      this.blobs.push(b);
      return b;
    }

    /* 补齐目标数量；墨渍死亡后按当前缺口随机补一类 */
    refill() {
      const t = this.opt.target;
      for (let i = 0; i < KIND_NAMES.length; i++) {
        const k = KIND_NAMES[i];
        while (this.countKind(k) < t[k]) {
          const pt = this.spawnPoint();
          this.spawn(k, pt.x, pt.y);
        }
      }
    }

    /* ============================================================
       墨渍贴图的重生成（低频：每 ~130ms 一次，分摊到各帧）
       ------------------------------------------------------------
       12 层错位轮廓叠印：外层大而淡（晕染），内层小而浓（核心）。
       每层轮廓用不同的 salt，彼此不完全重合 —— 边缘因此呈
       纤维状渗染，而不是一条干净的几何边。
       ============================================================ */
    regen(b) {
      const K = KINDS[b.kind];
      const R = b.r;
      const env = envOf(b);
      if (env <= 0.01) return;                     /* 看不见的不画 */
      /* 整个跑出视口的也不画（锚点在屏外时墨会跟出去） */
      if (b.x < -R * 2 || b.x > this.w + R * 2 || b.y < -R * 2 || b.y > this.h + R * 2) return;

      const fiberMax = K.fiber > 0 ? 0.34 : 0;
      const pad = Math.ceil(R * (1 + K.edgeAmp) * 1.32 + R * fiberMax + 10);
      /* 尺寸量化到 48px 一档：呼吸与生长不会每次都触发重分配 */
      const size = Math.ceil(pad * 2 / 48) * 48;

      if (!b.cv || b.cv.width !== Math.ceil(size * this.sdpr)) {
        b.cv = document.createElement("canvas");
        b.cv.width = b.cv.height = Math.max(2, Math.ceil(size * this.sdpr));
        b.cvPad = pad;
      }
      const g = b.cv.getContext("2d");
      g.setTransform(this.sdpr, 0, 0, this.sdpr, pad, pad);
      g.clearRect(-pad, -pad, size, size);

      const passes = this.mobile ? 9 : 11;

      /* 干燥：越到后期核心越干、（泼墨）颜料越往边上聚 */
      const dry = clamp((b.lifeT - 0.4) / 0.6, 0, 1);

      for (let p = 0; p < passes; p++) {
        const tt = p / (passes - 1);                 /* 0 外晕 → 1 核心 */
        const scale = lerp(1.32, 0.5, Math.pow(tt, 0.8));
        /* 外层极淡、内层足浓；对比拉开，中心要真的"沉"下去 */
        let a = lerp(0.016, 0.175, Math.pow(tt, 1.7)) * b.baseA * 2;
        if (b.kind === "wash") a *= 0.8;
        /* 干燥期核心变浅 */
        a *= 1 - 0.3 * dry * (1 - tt * 0.5);
        if (a <= 0.004) continue;

        const salt = b.salt + p * 3.7;
        const n = Math.max(16, Math.min(34, Math.round(R / 6)));
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const ang = (i / n) * TAU;
          const rr = R * scale * contourAt(b, ang, this.t, salt);
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fillStyle = inkA(Math.min(a, 0.85));
        g.fill();
      }

      /* 咖啡环：将干时颜料聚到边缘，形成一圈深色渍沿 */
      if (b.ringy && dry > 0.15) {
        const ra = 0.16 * (dry - 0.15) * b.baseA;
        const salt = b.salt + 91.3;
        const n = Math.max(16, Math.min(34, Math.round(R / 6)));
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const ang = (i / n) * TAU;
          const rr = R * 1.02 * contourAt(b, ang, this.t, salt);
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.lineWidth = Math.max(2, R * 0.1);
        g.strokeStyle = inkA(Math.min(ra, 0.5));
        g.stroke();
      }

      /* 毛细须：墨渍边缘向纸纤维里长出的细渗 */
      if (b.fibers.length) {
        g.lineCap = "round";
        for (let i = 0; i < b.fibers.length; i++) {
          const f = b.fibers[i];
          /* 每根须有自己的生长节律：噪声门控，时隐时现 */
          const gw = fbm3(f.ph, b.seed, this.t * b.cSpeed * 2.2);
          const on = clamp((gw - 0.42) * 4.5, 0, 1);
          if (on <= 0.05) continue;
          const rr = R * contourAt(b, f.ang, this.t, b.salt);
          const len = R * f.len * (0.6 + 0.8 * gw) * (1 - dry * 0.4);
          const x0 = Math.cos(f.ang) * rr * 0.86;
          const y0 = Math.sin(f.ang) * rr * 0.86;
          const x1 = Math.cos(f.ang) * (rr + len);
          const y1 = Math.sin(f.ang) * (rr + len);
          g.strokeStyle = inkA(f.a * on * b.baseA);
          g.lineWidth = f.w;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
        }
      }

      /* 内部深斑：浓淡不均的颜料堆积 */
      for (let i = 0; i < b.blotches.length; i++) {
        const bl = b.blotches[i];
        const br = R * bl.r * (0.8 + 0.4 * fbm3(bl.salt, b.seed, this.t * b.bSpeed * 3));
        const bx = bl.ox * R * 0.55;
        const by = bl.oy * R * 0.55;
        const n = 14;
        g.beginPath();
        for (let j = 0; j <= n; j++) {
          const ang = (j / n) * TAU;
          const rr = br * contourAt(b, ang, this.t, bl.salt);
          const px = bx + Math.cos(ang) * rr;
          const py = by + Math.sin(ang) * rr;
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fillStyle = inkA(Math.min(bl.a * b.baseA * (1 - dry * 0.35), 0.6));
        g.fill();
      }

      /* 卫星墨点：主渍周围溅开的小点 */
      for (let i = 0; i < b.sats.length; i++) {
        const s = b.sats[i];
        const d = R * s.dist;
        g.beginPath();
        g.arc(Math.cos(s.ang) * d, Math.sin(s.ang) * d, s.r, 0, TAU);
        g.fillStyle = inkA(s.a * b.baseA);
        g.fill();
      }
    }

    /* ---------- 单步 ---------- */
    step(dt) {
      this.t += dt;
      this.frame++;
      const blobs = this.blobs;

      for (let i = blobs.length - 1; i >= 0; i--) {
        const b = blobs[i];
        b.age += dt;
        b.lifeT = b.age / b.life;
        if (b.lifeT >= 1) {
          blobs.splice(i, 1);
          continue;
        }

        const K = KINDS[b.kind];

        /* 4. 慢速漂移：无散度流场推着走，重阻尼 —— 漫游而非飞行 */
        flowAt(b.x, b.y, this.t, this.k, _v);
        b.vx += _v[0] * K.drift * dt;
        b.vy += _v[1] * K.drift * dt;
        const drag = Math.pow(0.2, dt);
        b.vx *= drag;
        b.vy *= drag;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        /* 半径：√t 毛细扩散 + 呼吸噪声（各自独立周期） */
        const grow = Math.min(Math.sqrt(1 + b.age / K.diffuse), K.maxGrow);
        const br = 1 + 0.13 * (fbm3(b.bPh, b.seed, this.t * b.bSpeed) - 0.5) * 2;
        b.r = Math.max(3, b.r0 * grow * br);

        /* 分离：浓墨池偶尔在边缘裂出一粒小墨点，慢慢漂走 */
        if (b.kind === "pool" && this.countKind("speck") < this.opt.target.speck + 2 && this.rnd() < 0.0012) {
          const ang = this.rnd() * TAU;
          const s = this.spawn("speck", b.x + Math.cos(ang) * b.r * 0.9, b.y + Math.sin(ang) * b.r * 0.9);
          s.vx = Math.cos(ang) * 9;
          s.vy = Math.sin(ang) * 9;
        }
      }

      /* 补墨：保持构图不空，但节奏很慢 */
      if (this.frame % 60 === 0) this.refill();

      /* 贴图低频重生成（错峰：每帧至多重生成一两个墨渍） */
      let regens = 0;
      for (let i = 0; i < blobs.length && regens < 2; i++) {
        const b = blobs[i];
        if (this.t >= b.nextR) {
          this.regen(b);
          b.nextR = this.t + 0.11 + this.rnd() * 0.09;
          regens++;
        }
      }

      this.render();
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      for (let i = 0; i < this.blobs.length; i++) {
        const b = this.blobs[i];
        if (!b.cv) continue;
        const env = envOf(b);
        if (env <= 0.002) continue;

        /* 拉伸：沿一条缓慢转向的轴横向洇开（各墨渍独立） */
        const st = 1 + b.stAmp * (fbm3(b.seed, b.stAng * 9.1, this.t * b.stSpeed) - 0.5) * 2;
        const ang = b.stAng + this.t * b.stSpeed * 0.6;

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(ang);
        ctx.scale(Math.max(0.6, st), Math.max(0.6, 2 - st));
        ctx.rotate(-ang);
        ctx.globalAlpha = env;
        /* 九参形式：贴图按 48px 量化分配，实际墨区只有 pad*2，
           必须只取用到的源区域，整张画会错位 */
        ctx.drawImage(
          b.cv, 0, 0, b.cvPad * 2 * this.sdpr, b.cvPad * 2 * this.sdpr,
          -b.cvPad, -b.cvPad, b.cvPad * 2, b.cvPad * 2
        );
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- 文字识别墨迹 → 自动描边 ---------- */
    haloTick(now) {
      if (now - this.lastHalo < 200) return;
      this.lastHalo = now;

      /* 覆盖度栅格是"当下"的快照：墨淡去了，描边也该跟着撤 */
      this.grid.fill(0);
      for (let i = 0; i < this.blobs.length; i++) {
        const b = this.blobs[i];
        const env = envOf(b);
        if (env <= 0.02) continue;
        this.gridAdd(b.x, b.y, b.r * 1.12, env * b.baseA * 0.8);
      }

      /* 调试：?inkdebug 把引擎状态写到画布 data 属性，无头渲染可读 */
      if (this.debug) {
        let peak = 0;
        let cover = 0;
        let sampled = 0;
        try {
          const px = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
          for (let i = 3; i < px.length; i += 16) {
            sampled++;
            if (px[i] > peak) peak = px[i];
            if (px[i] > 40) cover++;
          }
        } catch (_) {}
        let nw = 0, np = 0, ns = 0;
        for (let i = 0; i < this.blobs.length; i++) {
          const k = this.blobs[i].kind;
          if (k === "wash") nw++;
          else if (k === "pool") np++;
          else ns++;
        }
        this.canvas.setAttribute(
          "data-ink",
          "t=" + this.t.toFixed(1) +
          " blobs=" + this.blobs.length +
          " w/p/s=" + nw + "/" + np + "/" + ns +
          " cover=" + (sampled ? (cover / sampled * 100).toFixed(2) + "%" : "-") +
          " peakA=" + (peak / 255).toFixed(3) +
          " frame=" + this.frame
        );
      }

      const sy = window.scrollY || window.pageYOffset || 0;
      const vh = window.innerHeight;
      for (let i = 0; i < this.texts.length; i++) {
        const it = this.texts[i];
        const top = it.top - sy;
        if (top > vh + 60 || top + it.h < -60) {
          if (it.on) {
            it.on = false;
            it.el.classList.remove("on-ink");
          }
          continue;
        }
        const cover = this.gridCover(it.left, top, it.left + it.w, top + it.h);
        const on = cover > 0.14;
        if (on !== it.on) {
          it.on = on;
          it.el.classList.toggle("on-ink", on);
        }
      }
    }

    /* ---------- 主循环 ---------- */
    loop(now) {
      this.raf = window.requestAnimationFrame((t) => this.loop(t));
      if (this.last === 0) this.last = now;
      let delta = (now - this.last) / 1000;
      this.last = now;
      if (delta > 0.45) delta = 0.45;

      const STEP = 1 / 30;
      this.acc += delta;
      let steps = 0;
      while (this.acc >= STEP && steps < 3) {
        this.acc -= STEP;
        this.step(STEP);
        steps++;
      }
      if (steps) this.haloTick(now);
    }

    start(now) {
      if (this.raf) return;
      this.last = 0;
      this.loop(now || 0);
    }

    stop() {
      if (this.raf) window.cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    /* ---------- 开局：纸上已有几团在洇的墨 ---------- */
    prime() {
      this.collectAnchors();
      this.collectTexts();
      this.refill();

      /* 各墨渍的年龄错开：有的刚落纸，有的已洇开一半 */
      for (let i = 0; i < this.blobs.length; i++) {
        const b = this.blobs[i];
        b.age = this.rnd() * b.life * 0.55;
        b.lifeT = b.age / b.life;
        const K = KINDS[b.kind];
        const grow = Math.min(Math.sqrt(1 + b.age / K.diffuse), K.maxGrow);
        b.r = b.r0 * grow;
      }

      /* 空跑 3 秒，让轮廓、漂移、贴图全部就位 */
      for (let i = 0; i < 90; i++) this.step(1 / 30);
    }
  }

  /* ============================================================
     6. 页面级装配
     ============================================================ */
  const fields = [];
  let mounted = false;

  function mountAll() {
    if (mounted) return fields;
    mounted = true;

    let hosts = Array.prototype.slice.call(document.querySelectorAll(".ink-field"));
    if (!hosts.length) {
      const made = document.createElement("div");
      made.className = "ink-field";
      made.setAttribute("aria-hidden", "true");
      document.body.insertBefore(made, document.body.firstChild);
      hosts = [made];
    }

    const reduce = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    for (let i = 0; i < hosts.length; i++) {
      const f = new LivingInk(hosts[i]);
      f.prime();
      fields.push(f);
      if (!reduce) f.start();
    }

    bindRevealObserver();

    /* 调试：?inkwarp=N 把模拟快进 N 秒（无头渲染没有真实时钟） */
    const warp = (window.location.search.match(/inkwarp=([\d.]+)/) || [])[1];
    if (warp) {
      const n = Math.round(Math.min(300, parseFloat(warp)) * 30);
      for (let i = 0; i < fields.length; i++) {
        for (let s = 0; s < n; s++) fields[i].step(1 / 30);
      }
    }

    let resizeTimer = 0;
    window.addEventListener(
      "resize",
      function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
          for (let i = 0; i < fields.length; i++) fields[i].resize(false);
        }, 220);
      },
      { passive: true }
    );

    /* 内容异步渲染（列表来自云端），锚点与文字要定期重扫 */
    window.setInterval(function () {
      for (let i = 0; i < fields.length; i++) {
        fields[i].collectAnchors();
        fields[i].collectTexts();
      }
    }, 2400);

    document.addEventListener("visibilitychange", function () {
      for (let i = 0; i < fields.length; i++) {
        if (document.hidden) fields[i].stop();
        else if (!reduce) fields[i].start();
      }
    });

    window.InkEngine._fields = fields;
    return fields;
  }

  /* 新的界面区块进入视口时补一团墨 —— 墨跟着界面出现 */
  function bindRevealObserver() {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      function (entries) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.isIntersecting) continue;
          const r = e.boundingClientRect;
          for (let j = 0; j < fields.length; j++) {
            const f = fields[j];
            const x = clamp(r.left + r.width * (0.1 + f.rnd() * 0.5), 30, f.w - 30);
            const y = clamp(r.top + r.height * (0.2 + f.rnd() * 0.5), 30, f.h - 30);
            f.spawn(f.rnd() < 0.6 ? "pool" : "wash", x, y);
            break;
          }
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -18% 0px", threshold: 0.05 }
    );
    let nodes = [];
    try {
      nodes = document.querySelectorAll(
        ".section-head, .hero-lines, .music-hero, .cocreate-hero, .colophon, #musicUpload"
      );
    } catch (_) {
      nodes = [];
    }
    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      if (r.top < window.innerHeight * 0.85) continue;
      io.observe(nodes[i]);
    }
  }

  /* ============================================================
     7. 滚动显影（保持不变）
     ============================================================ */
  function initReveal() {
    const items = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (!items.length) return;
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (el) {
        el.classList.add("is-in");
      });
      return;
    }
    const io = new IntersectionObserver(
      function (entries) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );
    items.forEach(function (el) {
      io.observe(el);
    });
  }

  /* 兼容各页原有调用保留；墨层是固定整层，无单独视差。 */
  function initParallax() {}

  window.InkEngine = {
    mountAll: mountAll,
    initReveal: initReveal,
    initParallax: initParallax,
    _fields: fields,
  };
})();
