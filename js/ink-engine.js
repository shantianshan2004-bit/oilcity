/* ============================================================
   油城往事 · 流墨引擎（Flowing Ink · Flow-Field Ribbons）
   ------------------------------------------------------------
   墨不是"团"，是"迹"：一笔湿墨落在吸水纸上，被纸下的水流拖着
   走 —— 于是有了连续的弧、拖长的带、收细的尾和分叉的丝。
   页面上没有圆形、没有云朵、没有漂浮的墨团，只有一直在改变自己
   形状的墨迹。

   六条规则
     1. 流场     标量势的旋度（无散度）叠一个缓慢自转的涡心。
                 全网各处方向不同、速度不同，墨迹因此走弯曲的路径，
                 而不是同向平移
     2. 自我形变 每条墨迹是一串节点。每个节点按自己的速度被流场
                 推走，再用张力拉回邻居的中点 —— 墨带于是被拉伸、
                 扭曲、折叠、局部堆积。这是"形态在变"，不是"位置在变"
     3. 质量守恒 局部拉得越长墨越细、挤在一起就积成浓黑块，
                 笔锋与枯笔的分野全在这一条
     4. 持续更新 笔尖沿流场缓缓前探、尾巴退回纸里，形态一直在换，
                 但没有循环、没有关键帧
     5. 三层洇散 core 0.85x / mid 0.30x / soft 0.14x 三个离屏层，
                 同一笔在每层以不同宽度、不同浓度出墨，上采样时
                 天然形成三级高斯模糊 —— 每个元素天生有自己的模糊半径
     6. 记忆与干燥 墨累积在持久层上，按各自的半衰期褪去。
                 走得慢的地方墨积得厚，走得快的地方只留一道淡痕，
                 这就是长曝光照片里那种"时间沉积"的浓淡

   绘制开销：每帧只画十几次多边形填充 + 三次全屏合成，
   无滤镜、无逐像素运算、无贴图重生成。
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 纸与墨：纯黑 / 深灰 / 浅灰，米白由纸承担 ---------- */
  const INK = { r: 23, g: 23, b: 21 };
  const inkA = function (a) {
    return "rgba(" + INK.r + "," + INK.g + "," + INK.b + "," + a + ")";
  };

  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
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
     墨迹的粗细起伏、边缘毛刺、纸张吸墨的不均，全部来自它。
     ============================================================ */
  function hash3(x, y, z) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const fadeTab = function (t) { return t * t * (3 - 2 * t); };

  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fadeTab(x - xi), yf = fadeTab(y - yi), zf = fadeTab(z - zi);
    const c000 = hash3(xi, yi, zi),         c100 = hash3(xi + 1, yi, zi);
    const c010 = hash3(xi, yi + 1, zi),     c110 = hash3(xi + 1, yi + 1, zi);
    const c001 = hash3(xi, yi, zi + 1),     c101 = hash3(xi + 1, yi, zi + 1);
    const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf);
    const x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
    return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
  }

  function fbm3(x, y, z) {
    return 0.646 * noise3(x, y, z) +
           0.354 * noise3(x * 2.13 + 31.4, y * 2.13 + 17.7, z * 2.13 + 5.9);
  }

  /* ============================================================
     2. 流场
     ------------------------------------------------------------
     φ 是标量势，速度取旋度 (∂φ/∂y, −∂φ/∂x)：
     数学上无散度 —— 墨被推着走，但不会在流场里堆积成团。
     再叠一个绕中心的切向涡旋，让某些段打旋、某些段直出。
     ============================================================ */
  const GH = 6;
  const INV2GH = 1 / (2 * GH);
  const _v = [0, 0];

  function pot(x, y, t, F) {
    return (
      Math.sin(x * F.f1 + t * F.s1) * Math.cos(y * F.f2 - t * F.s2) +
      0.55 * Math.sin((x - y) * F.f3 + t * F.s3)
    );
  }

  function velAt(x, y, t, F, out) {
    const a = pot(x, y + GH, t, F);
    const b = pot(x, y - GH, t, F);
    const c = pot(x + GH, y, t, F);
    const d = pot(x - GH, y, t, F);
    let vx = (a - b) * INV2GH;
    let vy = -(c - d) * INV2GH;

    /* 涡心：绕一点旋转 —— 墨迹因此有"打旋"的段，不是全网同向 */
    const dx = x - F.vx;
    const dy = y - F.vy;
    const d2 = dx * dx + dy * dy + 900;
    const w = F.vs / (1 + d2 / F.vr2);
    const inv = 1 / Math.sqrt(d2);
    vx += -dy * inv * w * F.spin;
    vy += dx * inv * w * F.spin;

    const m = Math.sqrt(vx * vx + vy * vy) || 1;
    out[0] = vx / m;
    out[1] = vy / m;
    return out;
  }

  /* ============================================================
     3. 三类墨迹
     ------------------------------------------------------------
     band   主带   宽、重、长，画面的骨架与视觉重心
     thread 游丝   极细，跑得远，多半贴着主带走 —— 层叠与分叉
     broad  淡带   很宽很淡，稀释后的大笔横扫，负责空间层次
     ============================================================ */
  const KINDS = {
    band: {
      p: 0.34,
      n: [40, 60],          /* 节点数 */
      seg: [7, 11],         /* 节点间距（px） */
      hw: [7, 17],          /* 笔锋半宽（px） */
      speed: [3.5, 7],      /* 每秒被流场推进的距离 */
      tens: [0.05, 0.13],   /* 张力：越大越"绷直" */
      life: [34, 62],       /* 寿命（秒） */
      taper: 0.5,           /* 尾巴收细到多少 */
      mass: 1.15,           /* 出墨量 */
      lay: [0.74, 0.22, 0.04],
    },
    thread: {
      p: 0.50,
      n: [26, 44],
      seg: [6, 10],
      hw: [2.0, 5.2],
      speed: [7, 16],
      tens: [0.09, 0.22],
      life: [24, 46],
      taper: 0.14,
      mass: 0.8,
      lay: [0.84, 0.14, 0.02],
    },
    broad: {
      p: 0.16,
      n: [28, 42],
      seg: [10, 16],
      hw: [20, 34],
      speed: [3, 6],
      tens: [0.04, 0.10],
      life: [40, 70],
      taper: 0.3,
      mass: 0.32,
      lay: [0.26, 0.40, 0.34],
    },
  };

  const KIND_NAMES = ["band", "thread", "broad"];
  const KIND_FIELDS = ["p", "n", "seg", "hw", "speed", "tens", "life", "taper", "mass", "lay"];

  /* 上一次重构踩过的坑：参数对象里漏字段 → NaN → 整类墨静默不画。
     所以字段完整性在运行时自检一次，缺了就在控制台喊出来。 */
  for (let i = 0; i < KIND_NAMES.length; i++) {
    const K = KINDS[KIND_NAMES[i]];
    for (let j = 0; j < KIND_FIELDS.length; j++) {
      if (K[KIND_FIELDS[j]] === undefined) {
        if (window.console) console.warn("ink: KINDS." + KIND_NAMES[i] + " 缺字段 " + KIND_FIELDS[j]);
      }
    }
  }

  /* 三层洇散：分辨率越低，上采样时的模糊半径越大。
     s  离屏层缩放    tau 干燥半衰期（秒）   wm 出墨宽度倍数 */
  const LAYERS = [
    { s: 0.85, tau: 6.0, wm: 1.0, out: 1.0 },    /* core 墨身 */
    { s: 0.30, tau: 8.5, wm: 1.5, out: 0.95 },   /* mid  洇开 */
    { s: 0.14, tau: 12.0, wm: 1.95, out: 0.5 },  /* soft 外围光晕 */
  ];

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
    ".brand", ".nav a", ".nav-toggle",
  ].join(",");

  class FlowingInk {
    constructor(host) {
      this.host = host;

      const canvas = document.createElement("canvas");
      canvas.className = "ink-canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);

      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true });

      /* 种子：正常访问每次不同；带 ?inkseed=N 可复现同一构图（排查用） */
      const fixSeed = (String(window.location.search || "").match(/inkseed=(\d+)/) || [])[1];
      const seed = fixSeed ? (parseInt(fixSeed, 10) >>> 0) : (Math.random() * 0xffffffff) >>> 0;
      this.seed = seed;
      this.rnd = mulberry32(seed);

      this.ribs = [];
      this.t = 0;
      this.frame = 0;
      this.acc = 0;
      this.last = 0;
      this.lastHalo = 0;
      this.raf = 0;
      this.refillAcc = 0;
      this.w = 0;
      this.h = 0;
      this.dpr = 1;

      /* 流场：每页一套，方向和涡心各不相同 */
      this.flow = {
        f1: 0.0022 + this.rnd() * 0.0016,
        f2: 0.0026 + this.rnd() * 0.0018,
        f3: 0.0038 + this.rnd() * 0.0026,
        /* 时间项要够快：流场自己也在变，墨迹才不会绕着涡心
           一圈圈卷成同心圆（那是最典型的"规则几何"破绽） */
        s1: 0.045 + this.rnd() * 0.045,
        s2: 0.038 + this.rnd() * 0.040,
        s3: 0.055 + this.rnd() * 0.050,
        fx: 0.15 + this.rnd() * 0.7,     /* 涡心位置（比例，随视口换算） */
        fy: 0.15 + this.rnd() * 0.7,
        vr: 0.55 + this.rnd() * 0.55,   /* 涡的影响半径（相对短边） */
        /* 涡只做"轻轻带一下方向"，不做主控 —— 太强就成了漩涡图 */
        vs: 0.30 + this.rnd() * 0.42,
        spin: (this.rnd() < 0.5 ? -1 : 1) * (0.6 + this.rnd() * 0.6),
        vx: 0,
        vy: 0,
        vr2: 1,
      };

      /* 覆盖度栅格：文字描边判定用 */
      this.cell = 44;
      this.cols = 1;
      this.rows = 1;
      this.grid = new Float32Array(1);

      /* 绘制用的临时数组（按最大节点数预分配，避免每帧分配） */
      this._cx = new Float32Array(80);
      this._cy = new Float32Array(80);
      this._nx = new Float32Array(80);
      this._ny = new Float32Array(80);
      this._ww = new Float32Array(80);

      this.anchors = [];
      this.texts = [];
      this.debug = /inkdebug/.test(window.location.search || "");

      const area = Math.max(1, (window.innerWidth || 1200) * (window.innerHeight || 800));
      const mobile = Math.min(window.innerWidth || 1200, window.innerHeight || 800) < 640;
      this.mobile = mobile;
      /* 画面尺度：小屏上墨迹等比缩小，留白才守得住 */
      this.opt = {
        scaleK: clamp(Math.sqrt(area / (1440 * 900)), 0.6, 1),
        /* 目标数量：写意要留白，宁可少而重 */
        target: mobile
          ? { band: 2, thread: 3, broad: 0 }
          : { band: 2, thread: 4, broad: 1 },
      };

      this.buildGrain();
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
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   /* 之后一律用 CSS 像素坐标 */

      this.buildLayers();

      const short = Math.min(w, h);
      const F = this.flow;
      F.vx = F.fx * w;
      F.vy = F.fy * h;
      F.vr2 = (short * F.vr) * (short * F.vr);

      this.cell = w < 640 ? 36 : 44;
      this.cols = Math.max(1, Math.ceil(w / this.cell));
      this.rows = Math.max(1, Math.ceil(h / this.cell));
      this.grid = new Float32Array(this.cols * this.rows);

      if (!initial) this.render();
    }

    /* 三个离屏墨层：分辨率不同 → 上采样时的模糊半径不同 */
    buildLayers() {
      this.layers = [];
      this.ctxs = [];
      for (let i = 0; i < LAYERS.length; i++) {
        const L = LAYERS[i];
        const cv = document.createElement("canvas");
        cv.width = Math.max(2, Math.round(this.w * L.s));
        cv.height = Math.max(2, Math.round(this.h * L.s));
        const c = cv.getContext("2d", { alpha: true });
        /* 变换用实际像素比，保证 CSS 坐标与真实像素严格对应 */
        c.setTransform(cv.width / this.w, 0, 0, cv.height / this.h, 0, 0);
        this.layers.push(cv);
        this.ctxs.push(c);
      }
      this.grainPat = null;
    }

    /* ---------- 纸张吸墨不均的噪声片（用于墨身的颗粒断裂） ---------- */
    buildGrain() {
      const S = 192;
      const cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const g = cv.getContext("2d");
      const img = g.createImageData(S, S);
      const d = img.data;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const v = fbm3(x * 0.055, y * 0.055, 11.3);
          const v2 = noise3(x * 0.29, y * 0.29, 7.7);
          let a = clamp((v * 0.62 + v2 * 0.38 - 0.46) * 2.8, 0, 1);
          a = a * a;
          const i = (y * S + x) * 4;
          d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
          d[i + 3] = (a * 255) | 0;
        }
      }
      g.putImageData(img, 0, 0);
      this.grain = cv;
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
        out.push({ el: el, left: r.left, top: r.top + sy, w: r.width, h: r.height });
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
        /* 光晕宽度跟着字号走：大字笔画粗、墨压上来时更需要宽的纸色圈 */
        const hw = fs >= 60 ? 7 : fs >= 30 ? 5 : fs >= 19 ? 3.4 : 2.1;
        if (el.__haloW !== hw) {
          el.__haloW = hw;
          el.style.setProperty("--halo-w", hw + "px");
        }
        out.push({ el: el, left: r.left, top: r.top + sy, w: r.width, h: r.height, on: false });
      }
      this.texts = out;
    }

    pickAnchor() {
      if (!this.anchors.length) this.collectAnchors();
      const list = this.anchors;
      if (!list.length) return null;
      const sy = window.scrollY || window.pageYOffset || 0;
      for (let tryN = 0; tryN < 6; tryN++) {
        const cand = list[(this.rnd() * list.length) | 0];
        const vt = cand.top - sy;
        if (vt > -160 && vt < this.h + 160) return cand;
      }
      return list[(this.rnd() * list.length) | 0];
    }

    /* 锚点附近取落墨点：多数落在文字块外侧，偶尔压进文字里 */
    anchorPoint(a) {
      const R = this.rnd;
      const sy = window.scrollY || window.pageYOffset || 0;
      const top = a.top - sy;
      const p = R();
      let x;
      if (p < 0.42) x = a.left - 24 - R() * 110;
      else if (p < 0.74) x = a.left + a.w + 24 + R() * 120;
      else x = a.left + a.w * (0.1 + R() * 0.8);
      const y = top + a.h * (0.05 + R() * 1.0) + (R() - 0.5) * 50;
      return { x: clamp(x, -40, this.w + 40), y: clamp(y, -40, this.h + 40) };
    }

    /* ---------- 起笔点 ----------
       三种起法：从画面边缘探进来（墨从纸外延伸入画）、
       贴着已有的墨迹长出去（分叉与层叠）、
       或者从界面元素旁边起笔（融入 UI）。 */
    spawnPoint() {
      const R = this.rnd;

      /* 贴着已有墨迹：沿它的法线偏出去一点，方向顺着它 —— 这是"连续关系" */
      if (this.ribs.length && R() < 0.42) {
        const src = this.ribs[(R() * this.ribs.length) | 0];
        const n = src.pts.length;
        if (n > 6) {
          const i = 2 + ((R() * (n - 5)) | 0);
          const p = src.pts[i];
          const a = src.pts[i - 1];
          const b = src.pts[i + 1];
          let tx = b.x - a.x;
          let ty = b.y - a.y;
          const tl = Math.sqrt(tx * tx + ty * ty) || 1;
          tx /= tl;
          ty /= tl;
          const side = R() < 0.5 ? -1 : 1;
          /* 起点贴着主带的边起笔 —— 差得远就成了"另一条线"，
             贴着边才是从这一笔里分出去的一道 */
          const off = src.hw * (1.02 + R() * 1.1);
          const x = p.x - ty * side * off;
          const y = p.y + tx * side * off;
          if (x > -30 && x < this.w + 30 && y > -30 && y < this.h + 30) return { x: x, y: y };
        }
      }

      /* 从边缘入画：必须顺着流场往画面里走。墨的上游在纸外，
         如果流场此刻正把墨往外带，这条墨就只会扒在边上打转、
         洇成一块没有方向的污渍 —— 所以宁可不从这里进 */
      if (R() < 0.28) {
        for (let k = 0; k < 5; k++) {
          const e = (R() * 4) | 0;
          let x, y, ix, iy;
          if (e === 0) { x = -20 - R() * 70; y = R() * this.h; ix = 1; iy = 0; }
          else if (e === 1) { x = this.w + 20 + R() * 70; y = R() * this.h; ix = -1; iy = 0; }
          else if (e === 2) { x = R() * this.w; y = -20 - R() * 60; ix = 0; iy = 1; }
          else { x = R() * this.w; y = this.h + 20 + R() * 60; ix = 0; iy = -1; }
          velAt(x, y, this.t, this.flow, _v);
          if (_v[0] * ix + _v[1] * iy > 0.18) return { x: x, y: y };
        }
      }

      const a = this.pickAnchor();
      if (a) return this.anchorPoint(a);
      return { x: R() * this.w, y: R() * this.h };
    }

    /* 只统计"活着且在画面里"的：淡出期（lifeT > 0.86）的视觉上已
       近乎消失；整条跑出视口的也不该占名额 —— 否则补墨逻辑会误以为
       构图还满着，画面就空了 */
    countKind(kind) {
      let n = 0;
      for (let i = 0; i < this.ribs.length; i++) {
        const r = this.ribs[i];
        if (r.kind !== kind || r.age >= r.life * 0.86) continue;
        if (this.offscreen(r)) continue;
        n++;
      }
      return n;
    }

    /* ============================================================
       起一笔墨
       ------------------------------------------------------------
       不是放一个点，是"写下"一段已有弧度的墨迹：从落笔点沿流场
       往上游回溯，把 n 个节点串成一条已经弯曲的带子。所以页面
       一打开就有完整的弧线，而不是先有一个点再长大。
       ============================================================ */
    spawnRibbon(kind, x, y) {
      const K = KINDS[kind];
      const R = this.rnd;
      const sk = this.opt.scaleK;

      const r = {
        kind: kind,
        K: K,
        hw: lerp(K.hw[0], K.hw[1], R()) * sk,
        speed: lerp(K.speed[0], K.speed[1], R()) * (0.82 + sk * 0.3),
        seg: lerp(K.seg[0], K.seg[1], R()) * sk,
        tens: lerp(K.tens[0], K.tens[1], R()),
        life: lerp(K.life[0], K.life[1], R()) * (0.85 + R() * 0.3),
        lay: K.lay,
        seed: R() * 977,
        age: 0,
        massK: 1,
        headAcc: 0,
        headEvery: 0.5 + R() * 1.1,
        /* 每笔对流向有一点点自己的偏置（±26°）：同一个流场里，
           不同的墨走不同的路，构图才散得开、不会全挤在一处 */
        bias: (R() - 0.5) * 0.9,
        cb: 1,
        sb: 0,
        pts: [],
      };
      r.cb = Math.cos(r.bias);
      r.sb = Math.sin(r.bias);

      /* 初始曲线：以落点为中心，往上游回溯一段、往下游前伸一段。
         这样一落纸就是一道完整的弧 —— 而不是先露出一个笔尖
         （笔尖独自在角落滞留，会洇出一块没有方向的污渍）。
         上游段长一些：尾巴要飘出去，头要留得住墨。 */
      const n = Math.round(lerp(K.n[0], K.n[1], R()));
      const half = Math.max(5, Math.round(n * 0.55));
      const up = [];
      const dn = [];

      let cx = x;
      let cy = y;
      for (let i = 0; i < n - half; i++) {
        up.push(this.mkPt(cx, cy, i, r));
        const d = this.dirAt(cx, cy, r);
        cx -= d[0] * r.seg;
        cy -= d[1] * r.seg;
      }

      cx = x;
      cy = y;
      for (let i = 0; i < half; i++) {
        const d = this.dirAt(cx, cy, r);
        cx += d[0] * r.seg;
        cy += d[1] * r.seg;
        dn.push(this.mkPt(cx, cy, half + i, r));
      }

      /* 下标 0 = 最下游的笔尖，末尾 = 最上游的尾巴 */
      dn.reverse();
      r.pts = dn.concat(up);

      this.ribs.push(r);
      return r;
    }

    /* 一个墨节点：速度、张力、墨量各有一点自己的性子 */
    mkPt(x, y, i, r) {
      return {
        x: x,
        y: y,
        /* 速度系数沿墨带平滑变化 → 整条带被剪切、拉伸，而不是刚性平移 */
        sp: 0.62 + 0.76 * fbm3(i * 0.06, r.seed, 3.1),
        tn: r.tens * (0.65 + 0.7 * noise3(i * 0.14, r.seed, 5.5)),
        am: 0.55 + 0.9 * noise3(i * 0.09, r.seed + 17.3, 9.2),
      };
    }

    /* 该笔在这一点上的流向（含它自己的偏置） */
    dirAt(x, y, r) {
      velAt(x, y, this.t, this.flow, _v);
      const vx = _v[0] * r.cb - _v[1] * r.sb;
      const vy = _v[0] * r.sb + _v[1] * r.cb;
      _v[0] = vx;
      _v[1] = vy;
      return _v;
    }

    /* 补齐目标数量。两道保险：总数有硬上限；落点若整条跑到画外，
       换一个画内的随机点重来 —— 否则 countKind 永远数不到它，
       补墨会无限往里堆，帧率直接崩掉 */
    refill() {
      const t = this.opt.target;
      const cap = this.mobile ? 9 : 15;
      for (let i = 0; i < KIND_NAMES.length; i++) {
        const k = KIND_NAMES[i];
        const want = t[k] | 0;
        let guard = 0;
        while (this.countKind(k) < want && guard++ < 3 && this.ribs.length < cap) {
          const pt = this.spawnPoint();
          const r = this.spawnRibbon(k, pt.x, pt.y);
          if (this.offscreen(r)) {
            r.pts = [];
            this.ribs.pop();
            this.spawnRibbon(k, this.rnd() * this.w, this.rnd() * this.h);
          }
        }
      }
    }

    /* ============================================================
       一步：形态演化
       ============================================================ */
    updateRibbon(r, dt) {
      const P = r.pts;
      const n = P.length;
      const spd = r.speed;

      /* 1. 流场推进：每个节点速度不同 → 墨带被剪切、拉伸、扭曲 */
      for (let i = 0; i < n; i++) {
        const p = P[i];
        const d = this.dirAt(p.x, p.y, r);
        const s = spd * p.sp;
        p.x += d[0] * s * dt;
        p.y += d[1] * s * dt;
      }

      /* 2. 张力：节点被拉向相邻两点的中点。墨是有黏性的液体，
         不会散成沙，也不会僵成直线 —— 这一条决定弧线的顺滑 */
      for (let i = 1; i < n - 1; i++) {
        const a = P[i - 1];
        const b = P[i + 1];
        const p = P[i];
        const k = p.tn;
        p.x += ((a.x + b.x) * 0.5 - p.x) * k;
        p.y += ((a.y + b.y) * 0.5 - p.y) * k;
      }

      /* 3. 持续更新：笔尖沿流场前探一格、尾巴退回纸里。
         于是形态一直在换新的，但没有循环、没有关键帧 */
      r.headAcc += dt;
      if (r.headAcc >= r.headEvery) {
        r.headAcc = 0;
        const h = P[0];
        const d = this.dirAt(h.x, h.y, r);
        const nx = h.x + d[0] * r.seg * 0.9;
        const ny = h.y + d[1] * r.seg * 0.9;
        P.unshift({
          x: nx,
          y: ny,
          sp: 0.62 + 0.76 * this.rnd(),
          tn: r.tens * (0.65 + 0.7 * this.rnd()),
          am: 0.55 + 0.9 * this.rnd(),
        });
        P.pop();
      }
    }

    /* ============================================================
       一笔的绘制：把中心线按逐点宽度扩成墨带
       ------------------------------------------------------------
       宽度 = 起笔宽度 × 收笔锥度 × 噪声起伏 × 拉伸系数
       拉伸系数来自"质量守恒"：这一段被拉得越长，墨摊得越薄。
       同一笔在三层里各画一遍，宽度倍数不同 —— core 是墨身、
       mid 是洇开、soft 是外围的光晕。
       ============================================================ */
    drawRibbon(r, dt) {
      const P = r.pts;
      const n = P.length;
      if (n < 3) return;
      if (n > 80) return;

      const K = r.K;
      const base = r.massK * K.mass * 0.030 * (dt * 30);
      if (base <= 0.0008) return;

      const cx = this._cx, cy = this._cy, nx = this._nx, ny = this._ny, ww = this._ww;
      const t = this.t;

      for (let i = 0; i < n; i++) {
        const p = P[i];
        const a = P[i === 0 ? 0 : i - 1];
        const b = P[i === n - 1 ? n - 1 : i + 1];
        let tx = b.x - a.x;
        let ty = b.y - a.y;
        const tl = Math.sqrt(tx * tx + ty * ty) || 1;
        tx /= tl;
        ty /= tl;

        /* 局部段长 → 拉伸系数 */
        const q = P[i === n - 1 ? i : i + 1];
        const ddx = q.x - p.x;
        const ddy = q.y - p.y;
        const sl = Math.sqrt(ddx * ddx + ddy * ddy) || r.seg;
        /* 局部拉得越长墨越细（质量守恒）。上限压在 1.22：
           挤在一起时只能"厚"一点，不能糊成一个圆团 —— 页面上
           不允许出现圆形墨块，这是硬约束 */
        const stretch = clamp(r.seg / sl, 0.34, 1.22);

        const tt = i / (n - 1);
        /* 起笔收锋 + 收笔散锋：两端都要收到细，不能是平切的断口 */
        const headRoom = Math.min(1, i / 2.6);
        const taper = lerp(1, K.taper, Math.pow(tt, 0.7)) * (0.25 + 0.75 * headRoom);

        /* 两级噪声：低频决定粗细的节奏，高频是纸纤维造成的毛边 */
        const n1 = noise3(p.x * 0.011 + r.seed, p.y * 0.011, t * 0.14);
        const n2 = noise3(p.x * 0.072, p.y * 0.072 + r.seed, t * 0.42);
        const wob = 0.5 + 0.66 * n1 + 0.52 * (n2 - 0.5);

        const w = Math.max(0.3, p.am * r.hw * taper * wob * (0.55 + 0.55 * stretch));

        cx[i] = p.x;
        cy[i] = p.y;
        nx[i] = -ty;
        ny[i] = tx;
        ww[i] = w;
      }

      for (let li = 0; li < LAYERS.length; li++) {
        const wt = r.lay[li];
        if (wt <= 0.02) continue;
        const a = base * wt;
        if (a < 0.0012) continue;
        const wm = LAYERS[li].wm;
        const g = this.ctxs[li];

        /* (nx,ny) 已经是切线的法线，沿线两侧各偏移一个半宽 */
        let o = ww[0] * wm;
        g.beginPath();
        g.moveTo(cx[0] + nx[0] * o, cy[0] + ny[0] * o);
        for (let i = 1; i < n; i++) {
          o = ww[i] * wm;
          g.lineTo(cx[i] + nx[i] * o, cy[i] + ny[i] * o);
        }
        for (let i = n - 1; i >= 0; i--) {
          o = ww[i] * wm;
          g.lineTo(cx[i] - nx[i] * o, cy[i] - ny[i] * o);
        }
        g.closePath();
        g.fillStyle = inkA(Math.min(0.93, a));
        g.fill();
      }
    }

    /* ---------- 干燥：按各自的半衰期褪去 ---------- */
    decay(dt) {
      for (let i = 0; i < LAYERS.length; i++) {
        const g = this.ctxs[i];
        const a = 1 - Math.exp(-dt / LAYERS[i].tau);
        if (a <= 0) continue;
        g.save();
        g.globalCompositeOperation = "destination-out";
        g.globalAlpha = a;
        g.fillStyle = "#000";
        g.fillRect(0, 0, this.w, this.h);
        g.restore();
      }
    }

    /* ---------- 颗粒断裂：纸吸墨不匀，墨身局部透气 ---------- */
    erode() {
      const g = this.ctxs[0];
      if (!g) return;
      if (!this.grainPat) {
        try {
          this.grainPat = g.createPattern(this.grain, "repeat");
        } catch (_) {
          this.grainPat = null;
        }
      }
      if (!this.grainPat) return;
      const S = this.grain.width;
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = 0.055;
      g.fillStyle = this.grainPat;
      g.translate(-this.rnd() * S, -this.rnd() * S);
      g.fillRect(0, 0, this.w + S, this.h + S);
      g.restore();
    }

    offscreen(r) {
      const P = r.pts;
      const m = 140;
      for (let i = 0; i < P.length; i += 4) {
        const p = P[i];
        if (p.x > -m && p.x < this.w + m && p.y > -m && p.y < this.h + m) return false;
      }
      return true;
    }

    /* ---------- 合成：三层墨按序压到纸上 ---------- */
    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      for (let i = LAYERS.length - 1; i >= 0; i--) {
        ctx.globalAlpha = LAYERS[i].out;
        ctx.drawImage(this.layers[i], 0, 0, this.w, this.h);
      }
      ctx.globalAlpha = 1;
    }

    step(dt) {
      this.t += dt;
      this.frame++;

      /* 涡心缓慢游走：墨绕着它走，但环永远合不上 —— 环形一闭，
         画面立刻变成"几何图形"而不是墨迹 */
      const F = this.flow;
      F.vx = (F.fx + 0.06 * (noise3(this.t * 0.035, 3.7, 0.9) - 0.5) * 2) * this.w;
      F.vy = (F.fy + 0.06 * (noise3(this.t * 0.031, 9.3, 4.1) - 0.5) * 2) * this.h;

      for (let i = this.ribs.length - 1; i >= 0; i--) {
        const r = this.ribs[i];
        r.age += dt;
        const lt = r.age / r.life;
        /* 末期出墨量衰减：墨迹是"淡去"，不是忽然消失 */
        if (lt > 0.7) r.massK = Math.max(0, 1 - (lt - 0.7) / 0.3);
        this.updateRibbon(r, dt);
        this.drawRibbon(r, dt);
        if (lt >= 1 || this.offscreen(r)) this.ribs.splice(i, 1);
      }

      if (this.frame % 9 === 0) this.erode();
      this.decay(dt);
      if (!this.noRender) this.render();

      this.refillAcc += dt;
      if (this.refillAcc >= 1.4) {
        this.refillAcc = 0;
        this.refill();
      }
    }

    /* ---------- 文字识别墨迹 → 自动描边 ---------- */
    haloTick(now) {
      if (now - this.lastHalo < 200) return;
      this.lastHalo = now;

      /* 覆盖度栅格是"当下"的快照：墨淡去了，描边也该跟着撤 */
      this.grid.fill(0);
      for (let i = 0; i < this.ribs.length; i++) {
        const r = this.ribs[i];
        const P = r.pts;
        const rad = Math.max(5, r.hw * 1.7);
        for (let j = 0; j < P.length; j += 2) {
          this.gridAdd(P[j].x, P[j].y, rad, 0.42 * r.massK);
        }
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

        let nb = 0, nt = 0, nw = 0, pts = 0;
        for (let i = 0; i < this.ribs.length; i++) {
          const r = this.ribs[i];
          if (r.kind === "band") nb++;
          else if (r.kind === "thread") nt++;
          else nw++;
          pts += r.pts.length;
        }
        this.canvas.setAttribute(
          "data-ink",
          "t=" + this.t.toFixed(1) +
          " ribs=" + this.ribs.length +
          " b/t/w=" + nb + "/" + nt + "/" + nw +
          " pts=" + pts +
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

    /* ---------- 开局：纸上已有几笔在走的墨 ---------- */
    prime() {
      this.collectAnchors();
      this.collectTexts();
      this.refill();

      /* 各笔的年龄错开：有的刚起笔，有的已经走了大半程 */
      for (let i = 0; i < this.ribs.length; i++) {
        const r = this.ribs[i];
        r.age = this.rnd() * r.life * 0.4;
      }

      /* 空跑 2 秒：让墨积到可读的浓度（期间不做全屏合成，省开销） */
      this.noRender = true;
      for (let i = 0; i < 60; i++) this.step(1 / 30);
      this.noRender = false;
      this.render();
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
      const f = new FlowingInk(hosts[i]);
      f.prime();
      fields.push(f);
      if (!reduce) f.start();
    }

    bindRevealObserver();

    /* 调试：?inkwarp=N 把模拟快进 N 秒（无头渲染没有真实时钟） */
    const warp = (window.location.search.match(/inkwarp=([\d.]+)/) || [])[1];
    if (warp) {
      const n = Math.round(Math.min(120, parseFloat(warp)) * 30);
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        f.noRender = true;
        for (let s = 0; s < n; s++) f.step(1 / 30);
        f.noRender = false;
        f.render();
        f.haloTick(1e7);
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

  /* 新的界面区块进入视口时，从它旁边引一道墨出来 */
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
            f.spawnRibbon(f.rnd() < 0.62 ? "band" : "thread", x, y);
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
