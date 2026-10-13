/* ============================================================
   油城往事 · 活墨引擎（Living Ink）
   ------------------------------------------------------------
   墨不是"画"上去的图形，是"写"上去的：
   一笔落下，墨被流场推着走，边走边往纸上渗，
   颜料将尽时笔锋散成一股股细丝（飞白），最后整幅缓缓干去。
   每次打开页面种子不同，落笔的位置、方向、力气都不一样。

   三条物理规则
     1. 流场      标量势场的旋度 —— 无散度，墨只被推着走，不会凭空聚成团
     2. 动量      落笔是一记冲量，之后受流场与全局风向的持续加速，
                  再乘阻尼 —— 有惯性、会拐弯、会停
     3. 沉积      每帧沿位移方向把墨"拖"出去（不是原地盖一个圆），
                  宽度随颜料消耗变细 —— 起笔厚、收笔尖，自然成拉丝

   三类墨（这是画面层次的全部来源）
     泼 wash    大而淡，几乎不移动，摊成水痕，将干时颜料聚到边缘
                成深色轮廓（咖啡环）—— 提供块面
     笔 stroke  细而长，跑得远，边走边拉出细股丝 —— 提供方向与气势
     点 spray   极小，短命，随笔画飞溅出去 —— 提供颗粒与呼吸

   绘制开销
     每帧只有 drawImage + 一次变换，没有滤镜、没有逐像素运算。
     绘制量与墨滴数成正比，与画布面积无关。
     （上一版把 CSS transform 动画加在挂了 SVG 滤镜的 <g> 上，
       feTurbulence 被迫逐帧重算噪声场，于是频闪抽搐。此版无滤镜参与动画。）
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 纸与墨 ---------- */
  const INK  = { r: 23,  g: 23,  b: 21 };   /* --ink    浓墨 */
  const SEAL = { r: 135, g: 61, b: 50 };   /* --accent 朱砂 */

  const rgb = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

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
     1. 流场：标量势 φ 的旋度
     ------------------------------------------------------------
     φ 由几组方向、频率各异的正弦波叠加而成，处处平滑。
     取 rot(φ) 得 (∂φ/∂y, -∂φ/∂x) —— 旋转 90° 的梯度。
     旋度场天然无散度，等价于不可压缩流：墨不会凭空聚成团、
     也不会在某个角落被抽空，流走的形状像真的水。
     数值梯度只需 4 次求值，比任何噪声实现都便宜。
     ============================================================ */
  const GH = 1.7;                     /* 数值梯度步长 */
  const _v = [0, 0];                  /* 复用的返回值，避免每帧分配 */

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
    const dx = (a - b) / (2 * GH);      /* ∂φ/∂y */
    const dy = -(c - d) / (2 * GH);     /* -∂φ/∂x */
    const m = Math.sqrt(dx * dx + dy * dy) || 1;
    out[0] = dx / m;
    out[1] = dy / m;
    return out;
  }

  /* ============================================================
     2. 墨贴图
     ------------------------------------------------------------
     每帧给几十笔各建一个径向渐变太浪费，改成预渲染几档贴图，
     之后只 drawImage（带一次拉伸变换）—— 这是整帧唯一的开销。
     两种形态：core 是湿墨的核，ring 是干后颜料聚到边缘的咖啡环。
     ============================================================ */
  const SPRITE_SIZES = [8, 12, 20, 32, 52, 84, 136, 220];
  const sprites = { ink: [null, null], seal: [null, null] };
  let spritesBuilt = false;

  function buildSprites() {
    if (spritesBuilt) return;
    spritesBuilt = true;
    const colors = { ink: INK, seal: SEAL };
    for (const key in colors) {
      const col = colors[key];
      for (let ring = 0; ring < 2; ring++) {
        sprites[key][ring] = SPRITE_SIZES.map((size) => {
          const cv = document.createElement("canvas");
          cv.width = cv.height = size;
          const g = cv.getContext("2d");
          const r = size / 2;
          const grad = g.createRadialGradient(r, r, 0, r, r, r);
          if (ring) {
            /* 咖啡环：中心几乎透明，颜料堆在边缘 */
            grad.addColorStop(0.0, rgb(col, 0.03));
            grad.addColorStop(0.48, rgb(col, 0.20));
            grad.addColorStop(0.84, rgb(col, 0.62));
            grad.addColorStop(0.96, rgb(col, 0.16));
            grad.addColorStop(1.0, rgb(col, 0));
          } else {
            /* 核要实：笔道的"浓"靠中心这一段撑，
               太快衰减的话笔道就只剩发丝细的一线 */
            grad.addColorStop(0.0, rgb(col, 0.58));
            grad.addColorStop(0.34, rgb(col, 0.5));
            grad.addColorStop(0.6, rgb(col, 0.26));
            grad.addColorStop(0.84, rgb(col, 0.08));
            grad.addColorStop(1.0, rgb(col, 0));
          }
          g.fillStyle = grad;
          g.fillRect(0, 0, size, size);
          return cv;
        });
      }
    }
  }

  function spriteFor(color, ring, r) {
    const set = sprites[color][ring];
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i < SPRITE_SIZES.length; i++) {
      const err = Math.abs(SPRITE_SIZES[i] / 2 - r);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    return set[best];
  }

  /* ============================================================
     3. 三类墨的参数
     ------------------------------------------------------------
     w0      起笔半宽（px）
     life    寿命（秒）
     deposit 每帧出墨量；cap 是这一笔的颜料总量上限
     宽度收紧速度由 cap 与 deposit 的比值决定 —— 出墨快就短促，
     出墨慢就拖得长，这是"枯笔"与"湿笔"的区别所在
     acc/dragBase  受力与惯性：决定这一笔走多远
     diffuse 毛细扩散速度，决定它摊多开
     fil     拉丝股数（0 = 不拉丝）
     ============================================================ */
  const KINDS = {
    /* 泼：大块淡墨。几乎不移动，靠扩散摊开，干后留深色轮廓 */
    wash: {
      p: 0.2,
      w0: [40, 88],
      life: [24, 40],
      deposit: 0.02,
      cap: [6.0, 9.5],
      acc: 10,
      dragBase: 0.16,
      diffuse: 5.0,
      flowK: 0.5,
      driftK: 0.4,
      ringP: 0.6,
      fil: 0,
      spray: 0,
      shrink: 0.12,
      pow: 1.0,
    },
    /* 笔：细长，跑得远，一路拉丝 —— 画面的方向与气势全在这。
       出墨量必须配平"扫过速度"：笔在走，一个像素只被扫过几帧，
       每帧出墨量大，路径才能又长又浓（旧版墨滴停着不走，没这个问题）。 */
    stroke: {
      p: 0.44,
      w0: [11, 22],
      life: [10, 16],
      deposit: 0.1,
      cap: [7.5, 12.0],
      acc: 56,
      dragBase: 0.5,
      diffuse: 7.5,
      flowK: 1.0,
      driftK: 1.0,
      ringP: 0.1,
      fil: 3,
      spray: 2,
      shrink: 0.62,
      pow: 0.85,
    },
    /* 点：飞溅。极小、短命、立刻被纸吃掉 */
    spray: {
      p: 0.36,
      w0: [1.1, 3.6],
      life: [2.4, 6.0],
      deposit: 0.06,
      cap: [0.7, 1.5],
      acc: 16,
      dragBase: 0.06,
      diffuse: 2.2,
      flowK: 0.4,
      driftK: 0.3,
      ringP: 0.3,
      fil: 0,
      spray: 0,
      shrink: 0.5,
      pow: 0.9,
    },
  };
  const KIND_NAMES = ["wash", "stroke", "spray"];

  /* ============================================================
     4. 一笔墨
     ============================================================ */
  function makeDrop(kind, x, y, rnd, dirAng) {
    const K = KINDS[kind];
    const spread = kind === "stroke" ? 1.15 : Math.PI;   /* 笔触方向不四处乱窜 */
    const ang = (dirAng === undefined ? rnd() * Math.PI * 2 : dirAng + (rnd() - 0.5) * spread * 2);

    /* 落笔的力：一笔冲出去，随即被纸阻住 */
    let spd;
    if (kind === "wash") spd = 2 + rnd() * 10;
    else if (kind === "stroke") spd = 34 + rnd() * 62;
    else spd = 26 + rnd() * 90;

    const w0 = lerp(K.w0[0], K.w0[1], rnd());
    return {
      kind: kind,
      x: x,
      y: y,
      px: x,
      py: y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      w0: w0,
      w: w0,
      pw: w0,
      /* 泼墨的渍沿脉动相位 */
      phase: rnd() * 6.283,
      age: 0,
      life: lerp(K.life[0], K.life[1], rnd()),
      lifeT: 0,
      seal: rnd() < 0.06,
      ringy: rnd() < K.ringP,
      /* 受力与惯性：同一类墨里也有快慢之别 */
      acc: K.acc * (0.75 + rnd() * 0.65),
      dragBase: K.dragBase * (0.7 + rnd() * 0.6),
      flowK: K.flowK,
      driftK: K.driftK,
      deposit: K.deposit * (0.7 + rnd() * 0.6),
      cap: lerp(K.cap[0], K.cap[1], rnd()),
      spent: 0,
      /* 拉丝的细股：偏移量（相对笔宽）与各自的粗细、浓淡 */
      fib: [
        { off:  0.72, k: 0.30, a: 0.55 },
        { off: -0.86, k: 0.24, a: 0.46 },
        { off:  1.30, k: 0.16, a: 0.32 },
      ],
      /* 每笔带自己的流场参数 —— 几十笔走几十条不同的路，
         这是"每次呈现都不同"的第二层随机（第一层是种子）。 */
      k: {
        f1: 0.0014 + rnd() * 0.0018,
        f2: 0.0016 + rnd() * 0.0020,
        f3: 0.0009 + rnd() * 0.0013,
        f4: 0.0011 + rnd() * 0.0015,
        s1: 0.044 + rnd() * 0.058,
        s2: 0.036 + rnd() * 0.050,
        s3: 0.028 + rnd() * 0.046,
        s4: 0.032 + rnd() * 0.048,
      },
    };
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

  /* 需要"识别到墨迹就自动描边"的文字。
     只收正文与标题层级 —— 0.72rem 的小字描边会糊成一团。 */
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

      /* 每次加载换一次种子 —— 这是"每次都是不同的随机呈现"的根 */
      const seed = (Math.random() * 0xffffffff) >>> 0;
      this.seed = seed;
      this.rnd = mulberry32(seed);

      this.drops = [];
      this.t = 0;
      this.frame = 0;
      this.acc = 0;
      this.last = 0;
      this.wind = 0;         /* 滚动带来的风 */
      this.releaseAcc = 0;
      this.lastHalo = 0;
      this.raf = 0;
      this.w = 0;
      this.h = 0;
      this.dpr = 1;

      /* 全局风向：一页里的笔触大方向一致、又不完全平行，
         画面才有"一气写下"的连贯感，而不是四处乱溅。 */
      const da = this.rnd() * Math.PI * 2;
      this.driftAng = da;
      this.drift = { x: Math.cos(da), y: Math.sin(da) };

      /* 覆盖度栅格：比逐笔做几何求交便宜，且能记住"已经沉积的墨" */
      this.cell = 44;
      this.cols = 1;
      this.rows = 1;
      this.grid = new Float32Array(1);

      this.anchors = [];
      this.texts = [];
      this.visible = true;
      this.debug = /inkdebug/.test(window.location.search || "");

      const area = Math.max(1, (window.innerWidth || 1200) * (window.innerHeight || 800));
      const mobile = Math.min(window.innerWidth || 1200, window.innerHeight || 800) < 640;
      this.mobile = mobile;
      this.maxDrops = mobile ? 7 : clamp(Math.round(area / 80000), 12, 17);
      this.opt = {
        sealRate: 0.06,
        /* 画面尺度：小屏上笔要等比缩小，否则三笔就糊满整屏 */
        wScale: clamp(Math.sqrt(area / (1440 * 900)), 0.58, 1),
      };

      this.resize(true);
    }

    /* ---------- 尺寸 ---------- */
    resize(initial) {
      const w = Math.max(1, this.host.clientWidth || window.innerWidth);
      const h = Math.max(1, this.host.clientHeight || window.innerHeight);

      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      const maxArea = 2.6e6;                       /* 背板像素上限，护住低端机 */
      if (w * h * dpr * dpr > maxArea) dpr = Math.sqrt(maxArea / (w * h));
      dpr = Math.max(1, dpr);

      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (this.canvas.width === cw && this.canvas.height === ch) return;

      /* 先留一份旧墨，缩放着贴过去 —— 手机地址栏收起会触发 resize，
         不这么做的话每次滚动墨都会全部消失重来。 */
      let keep = null;
      if (!initial && this.canvas.width > 0 && this.w > 0) {
        keep = document.createElement("canvas");
        keep.width = this.canvas.width;
        keep.height = this.canvas.height;
        keep.getContext("2d").drawImage(this.canvas, 0, 0);
      }

      this.canvas.width = cw;
      this.canvas.height = ch;
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  /* 之后一律用 CSS 像素坐标 */

      if (keep) this.ctx.drawImage(keep, 0, 0, cw, ch, 0, 0, w, h);

      this.cell = w < 640 ? 36 : 44;
      this.cols = Math.max(1, Math.ceil(w / this.cell));
      this.rows = Math.max(1, Math.ceil(h / this.cell));
      this.grid = new Float32Array(this.cols * this.rows);
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

    gridAt(x, y) {
      const gx = clamp(Math.floor(x / this.cell), 0, this.cols - 1);
      const gy = clamp(Math.floor(y / this.cell), 0, this.rows - 1);
      return this.grid[gy * this.cols + gx];
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

    /* ---------- UI 锚点：墨从界面元素上长出来 ---------- */
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
        /* 描边粗细随字号走：大字要粗一点才盖得住墨。
           值没变就不写，免得每 2.4 秒触发一次样式重算。 */
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

    /* 锚点附近取一个落墨点：多数落在文字块外侧，偶尔压进文字里 */
    anchorPoint(a) {
      const R = this.rnd;
      const sy = window.scrollY || window.pageYOffset || 0;
      const top = a.top - sy;
      const p = R();
      let x;
      if (p < 0.4) x = a.left - 14 - R() * 70;
      else if (p < 0.7) x = a.left + a.w + 14 + R() * 80;
      else x = a.left + a.w * (0.1 + R() * 0.8);
      const y = top + a.h * (0.1 + R() * 0.95) + (R() - 0.5) * 34;
      return { x: clamp(x, -40, this.w + 40), y: clamp(y, -40, this.h + 40) };
    }

    pickAnchor() {
      if (!this.anchors.length) this.collectAnchors();
      const list = this.anchors;
      if (!list.length) return null;
      const sy = window.scrollY || window.pageYOffset || 0;
      for (let tryN = 0; tryN < 6; tryN++) {
        const cand = list[(this.rnd() * list.length) | 0];
        const vt = cand.top - sy;
        if (vt > -80 && vt < this.h + 80) return cand;
      }
      return list[(this.rnd() * list.length) | 0];
    }

    /* ---------- 落墨 ---------- */
    mainCount() {
      let n = 0;
      for (let i = 0; i < this.drops.length; i++) if (this.drops[i].kind !== "spray") n++;
      return n;
    }

    /* 按权重挑一类墨：笔最多，点次之，泼偶尔 */
    pickKind() {
      const r = this.rnd();
      if (r < KINDS.wash.p) return "wash";
      if (r < KINDS.wash.p + KINDS.stroke.p) return "stroke";
      return "spray";
    }
    spawn(kind, x, y, dirAng) {
      const d = makeDrop(kind, x, y, this.rnd, dirAng);
      /* 小屏等比缩笔 */
      if (this.opt.wScale < 1) {
        d.w0 *= this.opt.wScale;
        d.w = d.w0;
        d.pw = d.w0;
        d.cap *= 0.85;
      }
      if (kind === "stroke") {
        /* 出生点靠边时笔势往屏内偏 —— 别一落笔就写出纸外 */
        const edge = 1 - clamp(Math.min(x, this.w - x, y, this.h - y) / 240, 0, 1);
        if (edge > 0.02) {
          const cx = this.w * 0.5 - x;
          const cy = this.h * 0.5 - y;
          const m = Math.sqrt(cx * cx + cy * cy) || 1;
          const sp = Math.sqrt(d.vx * d.vx + d.vy * d.vy) || 1;
          d.vx += (cx / m) * sp * edge * 1.35;
          d.vy += (cy / m) * sp * edge * 1.35;
        }
      }
      this.drops.push(d);
      /* 一笔落下会溅出几个点 —— 泼墨的颗粒感全在这 */
      const n = KINDS[kind].spray ? (1 + (this.rnd() * KINDS[kind].spray) | 0) : 0;
      for (let i = 0; i < n; i++) this.sprayFrom(x, y, dirAng, 70);
      return d;
    }

    sprayFrom(x, y, dirAng, spd) {
      if (this.drops.length >= this.maxDrops + 18) return;
      const R = this.rnd;
      const a = (dirAng === undefined ? R() * Math.PI * 2 : dirAng + (R() - 0.5) * 2.4);
      const s = 14 + R() * spd;
      const d = makeDrop("spray", x + (R() - 0.5) * 14, y + (R() - 0.5) * 14, R, a);
      d.vx = Math.cos(a) * s;
      d.vy = Math.sin(a) * s;
      this.drops.push(d);
    }

    release(n) {
      for (let i = 0; i < n; i++) {
        if (this.mainCount() >= this.maxDrops) return;
        /* 下限保证：屏内笔触不足下限时，这一滴必是笔 ——
           泼墨拉丝是画面的骨架，随机可以变，不能断气 */
        const floor = this.mobile ? 2 : 3;
        let strokes = 0;
        for (let j = 0; j < this.drops.length; j++) {
          if (this.drops[j].kind === "stroke") strokes++;
        }
        let kind = this.pickKind();
        if (strokes < floor && kind !== "stroke") kind = "stroke";
        const a = this.pickAnchor();
        if (a) {
          const pt = this.anchorPoint(a);
          this.spawn(kind, pt.x, pt.y, this.driftAng);
        } else {
          this.spawn(kind, this.rnd() * this.w, this.rnd() * this.h, this.driftAng);
        }
      }
    }

    /* ============================================================
       一笔的沉积：沿位移方向把墨拖出去
       ------------------------------------------------------------
       这不是"在原地盖一个圆贴图"，而是把小贴图沿运动方向拉长，
       于是每一帧留下的是一段有方向的墨痕；连续帧叠起来就是一道
       带方向的笔道。笔宽随颜料消耗变细 —— 起笔厚、收笔尖。
       ============================================================ */
    smear(key, ring, x0, y0, w0, x1, y1, w1, alpha) {
      if (alpha <= 0.0012) return;
      const ctx = this.ctx;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      const w = Math.max(0.55, (w0 + w1) * 0.5);
      const spr = spriteFor(key, ring, w);
      const R = spr.width / 2;

      ctx.globalAlpha = alpha;
      if (len < 0.55) {
        ctx.drawImage(spr, x1 - w, y1 - w, w * 2, w * 2);
        return;
      }
      ctx.save();
      ctx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.scale((len * 0.5 + w) / R, w / R);     /* 沿运动方向拉伸 = 拉丝 */
      ctx.drawImage(spr, -R, -R, spr.width, spr.width);
      ctx.restore();
    }

    deposit(d) {
      const K = KINDS[d.kind];
      const spentT = clamp(d.spent / d.cap, 0, 1);
      const vx = d.vx;
      const vy = d.vy;
      const speed = Math.sqrt(vx * vx + vy * vy);

      /* 笔宽：先在纸上摊开一点（毛细扩散），再按各自的收笔程度变细
         —— 笔锋收尖成飞白，泼出去的墨池只摊不缩 */
      const grow = Math.sqrt(1 + d.age / K.diffuse);
      d.w = Math.max(0.6, d.w0 * grow * (1 - K.shrink * spentT));
      /* 泼墨的渍沿不匀：宽度带一点慢脉动，
         层层叠出来就不是规整的圆，而是真实水渍那种不规则的边 */
      if (d.kind === "wash") {
        d.w *= 1 + 0.16 * Math.sin(d.age * 0.55 + d.phase);
      }

      const room = d.cap - d.spent;
      const damp = 1 - this.gridAt(d.x, d.y) * 0.3;
      if (room <= 0.0015 || damp <= 0.04) {
        d.pw = d.w;
        return;
      }

      const p = Math.min(d.deposit * damp * (1 - spentT * 0.3), room);
      d.spent += p;
      const key = d.seal ? "seal" : "ink";

      /* 咖啡环：只有停住的墨才会把颜料推向边缘。
         走得快的笔触没有环 —— 这正是墨不该是一颗颗圆点的原因。 */
      const ringness = d.ringy
        ? clamp((d.lifeT - 0.36) / 0.4, 0, 1) * (speed < 16 ? 1 : 0.25)
        : 0;

      /* 主笔 */
      this.smear(key, 0, d.px, d.py, d.pw, d.x, d.y, d.w, p * (1 - ringness));
      if (ringness > 0.02) {
        this.smear(key, 1, d.px, d.py, d.pw, d.x, d.y, d.w, p * ringness);
      }

      /* 锋头聚墨：湿墨在笔尖积成深池 —— 笔道近头处比尾迹深得多，
         泼墨的"重"就是这一下给的。只在笔还在走时有；停住的墨
         靠普通沉积自己成池，不该再叠一记（否则淤成黑球）。 */
      if (d.kind === "stroke") {
        const bloom = clamp(speed / 34, 0.3, 1);
        this.smear(key, 0, d.px, d.py, d.pw * 0.92, d.x, d.y, d.w * 0.92, p * 1.9 * bloom);
      }

      /* 拉丝：沿笔道两侧拖出细股。越到收笔（颜料将尽）、走得越快，
         丝越分明 —— 这就是枯笔的飞白。 */
      if (K.fil) {
        const fa = clamp((speed - 14) / 64, 0, 1) * (0.3 + 0.7 * spentT);
        if (fa > 0.025) {
          const len = Math.sqrt((d.x - d.px) * (d.x - d.px) + (d.y - d.py) * (d.y - d.py));
          if (len > 0.4) {
            const nx = -(d.y - d.py) / len;
            const ny = (d.x - d.px) / len;
            const nFil = this.mobile ? Math.min(2, K.fil) : K.fil;
            for (let i = 0; i < nFil; i++) {
              const f = d.fib[i];
              const o = f.off * d.w;
              this.smear(
                key, 0,
                d.px + nx * o, d.py + ny * o, d.pw * f.k,
                d.x + nx * o, d.y + ny * o, d.w * f.k,
                p * f.a * fa
              );
            }
          }
        }
      }

      /* 覆盖度：沿位移采样几个点记进栅格，文字描边判定才准 */
      const segLen = Math.sqrt((d.x - d.px) * (d.x - d.px) + (d.y - d.py) * (d.y - d.py));
      const steps = clamp(Math.round(segLen / Math.max(6, d.w)) || 1, 1, 4);
      for (let i = 1; i <= steps; i++) {
        const tt = i / steps;
        this.gridAdd(lerp(d.px, d.x, tt), lerp(d.py, d.y, tt), d.w * 1.1, p * 1.05);
      }

      d.pw = d.w;
    }

    /* ---------- 单步 ---------- */
    step(dt) {
      const ctx = this.ctx;
      const drops = this.drops;
      const driftX = this.drift.x;
      const driftY = this.drift.y;

      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;
        d.lifeT = d.age / d.life;
        if (d.lifeT >= 1) {
          drops.splice(i, 1);
          continue;
        }

        /* 1 + 2. 流场推力 + 全局风向 → 加速度；再乘阻尼 → 有惯性、会停 */
        flowAt(d.x, d.y, this.t, d.k, _v);
        const ax = (_v[0] * d.flowK + driftX * d.driftK) * d.acc;
        const ay = (_v[1] * d.flowK + driftY * d.driftK) * d.acc;
        d.vx += ax * dt;
        d.vy += ay * dt;
        d.vy += this.wind * dt;            /* 滚动带来的风 */
        const drag = Math.pow(d.dragBase, dt);
        d.vx *= drag;
        d.vy *= drag;

        d.px = d.x;
        d.py = d.y;
        d.x += d.vx * dt;
        d.y += d.vy * dt;

        /* 离纸即收笔：飞出屏幕的墨不再占名额，
           名额让给下一笔 —— 屏内始终有墨在写 */
        if (d.x < -80 || d.x > this.w + 80 || d.y < -80 || d.y > this.h + 80) {
          drops.splice(i, 1);
          continue;
        }

        /* 走得快的笔触，路上偶尔甩出一两点墨 */
        if (d.kind === "stroke" && this.drops.length < this.maxDrops + 14) {
          const sp2 = d.vx * d.vx + d.vy * d.vy;
          if (sp2 > 2600 && this.rnd() < 0.045) {
            this.sprayFrom(d.x, d.y, Math.atan2(d.vy, d.vx), 50);
          }
        }

        /* 3. 沉积 */
        this.deposit(d);
      }

      ctx.globalAlpha = 1;
      this.t += dt;
      this.frame++;

      /* 干燥：整幅极缓褪色，旧墨随时间淡去，纸面永不淤死 */
      if (this.frame % 26 === 0) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,0.007)";
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.globalCompositeOperation = "source-over";
        const g = this.grid;
        for (let i = 0; i < g.length; i++) g[i] *= 0.992;
      }

      /* 持续落墨：墨一直"在写"，但不喧宾夺主 */
      this.releaseAcc += dt;
      if (this.releaseAcc >= 1.2 + this.rnd() * 1.9) {
        this.releaseAcc = 0;
        this.release(1 + (this.rnd() < 0.35 ? 1 : 0));
      }
    }

    /* ---------- 文字识别墨迹 → 自动描边 ---------- */
    haloTick(now) {
      if (now - this.lastHalo < 200) return;
      this.lastHalo = now;

      /* 调试：?inkdebug 时把引擎状态写到画布的 data 属性上，
         无头渲染 + dump-dom 就能读出引擎到底走了多少步 */
      if (this.debug) {
        let sum = 0;
        for (let i = 0; i < this.grid.length; i++) sum += this.grid[i];
        let peak = 0;
        let cover = 0;
        let sampled = 0;
        let info = "";
        try {
          const px = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
          for (let i = 3; i < px.length; i += 16) {
            sampled++;
            if (px[i] > peak) peak = px[i];
            if (px[i] > 40) cover++;
          }
        } catch (_) {}
        let nw = 0, ns = 0, np = 0;
        for (let i = 0; i < this.drops.length; i++) {
          const k = this.drops[i].kind;
          if (k === "wash") nw++;
          else if (k === "stroke") ns++;
          else np++;
        }
        info = " peakA=" + (peak / 255).toFixed(3) +
               " cover=" + (sampled ? (cover / sampled * 100).toFixed(2) + "%" : "-") +
               " w/s/p=" + nw + "/" + ns + "/" + np;
        this.canvas.setAttribute(
          "data-ink",
          "t=" + this.t.toFixed(1) +
          " drops=" + this.drops.length +
          " grid=" + (sum / this.grid.length).toFixed(4) +
          " frame=" + this.frame + info
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
      /* 必须用箭头函数转发：直接把 this.loop 交给 rAF 会丢掉 this */
      this.raf = window.requestAnimationFrame((t) => this.loop(t));
      if (this.last === 0) this.last = now;
      let delta = (now - this.last) / 1000;
      this.last = now;
      if (delta > 0.45) delta = 0.45;      /* 切回标签页时不要一次性补一大堆 */

      const STEP = 1 / 30;
      this.acc += delta;
      let steps = 0;
      while (this.acc >= STEP && steps < 3) {
        this.acc -= STEP;
        this.step(STEP);
        steps++;
      }
      if (steps) {
        this.wind *= Math.pow(0.22, delta);   /* 风会停 */
        this.haloTick(now);
      }
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

    /* ---------- 开局：先落几笔，别让纸空着 ---------- */
    prime() {
      this.collectAnchors();
      this.collectTexts();

      /* 泼：一到两块淡墨打底 */
      const washes = 1 + (this.rnd() < 0.55 ? 1 : 0);
      for (let i = 0; i < washes; i++) {
        const a = this.pickAnchor();
        const pt = a ? this.anchorPoint(a) : { x: this.rnd() * this.w, y: this.rnd() * this.h };
        this.spawn("wash", pt.x, pt.y, this.rnd() * Math.PI * 2);
      }

      /* 笔：开局就把主要笔势写下去，大方向一致。
         开局这几笔是画面的骨架，格外给足墨 —— 保证每次打开
         至少有一两道拿得出去的长笔，其余靠后续随机落墨。 */
      const strokes = this.mobile ? 2 : 4 + (this.rnd() < 0.5 ? 1 : 0);
      for (let i = 0; i < strokes; i++) {
        const a = this.pickAnchor();
        const pt = a ? this.anchorPoint(a) : { x: this.rnd() * this.w, y: this.rnd() * this.h };
        const s = this.spawn("stroke", pt.x, pt.y, this.driftAng);
        s.w0 *= 1.28;
        s.w = s.w0;
        s.pw = s.w0;
        s.cap *= 1.3;
      }

      /* 点：随手洒几点 */
      for (let i = 0; i < (this.mobile ? 4 : 7); i++) {
        this.sprayFrom(
          this.rnd() * this.w,
          this.rnd() * this.h,
          undefined,
          90
        );
      }

      /* 空跑 2 秒 —— 一上来就已经"洇开"了，不是从零开始 */
      for (let i = 0; i < 60; i++) this.step(1 / 30);
      this.releaseAcc = 0;
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

    if (!spritesBuilt) {
      try {
        buildSprites();
      } catch (_) {}
    }

    let hosts = Array.prototype.slice.call(document.querySelectorAll(".ink-field"));
    if (!hosts.length) {
      /* 页面没有墨层就自己造一个 —— 八个页面视觉才是统一的 */
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

    bindScrollWind();
    bindRevealObserver();

    /* 调试：?inkwarp=N 直接把模拟快进 N 秒。
       无头渲染没有真实时钟，这样就能看到墨发育之后的最终样子，
       也让调校浓度不用依赖帧率。 */
    const warp = (window.location.search.match(/inkwarp=([\d.]+)/) || [])[1];
    if (warp) {
      const n = Math.round(Math.min(180, parseFloat(warp)) * 30);
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

    /* 内容会异步渲染（列表来自云端），锚点与文字要定期重扫 */
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

  /* 滚动 = 风。快速滑动时墨会被带着走一下，停手后风平息。 */
  function bindScrollWind() {
    let lastY = window.scrollY || window.pageYOffset || 0;
    window.addEventListener(
      "scroll",
      function () {
        const y = window.scrollY || window.pageYOffset || 0;
        const d = y - lastY;
        lastY = y;
        const target = clamp(-d * 2.4, -140, 140);
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          f.wind = f.wind * 0.55 + target * 0.45;
        }
      },
      { passive: true }
    );
  }

  /* 新的界面区块进入视口时补一笔墨 —— 墨跟着界面出现 */
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
            if (f.mainCount() >= f.maxDrops) break;
            const x = r.left + r.width * (0.12 + f.rnd() * 0.4);
            const y = Math.min(f.h - 30, Math.max(30, r.top + r.height * (0.2 + f.rnd() * 0.5)));
            f.spawn(f.rnd() < 0.7 ? "stroke" : "wash", x, y, f.driftAng);
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
      /* 首屏内的不注册，避免一上来就一起放墨 */
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

  /* 墨层现在是固定的一整层，视差已由流场与滚动之风承担；
     这个函数保留只为兼容各页原有的调用，不再移动墨层。 */
  function initParallax() {}

  window.InkEngine = {
    mountAll: mountAll,
    initReveal: initReveal,
    initParallax: initParallax,
    _fields: fields,
  };
})();
