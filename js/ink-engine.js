/* ============================================================
   油城往事 · 墨迹引擎 v3 —— 湿边 · 丝 · 飞溅
   ============================================================
   上一版把所有墨都做成了"柔边贴图"，于是整幅画没有一个硬边，
   必然读成一团雾。真实的墨在纸上有三种截然不同的存在方式：

     一 · 丝（丝线本身是硬的）
        笔锋划过纸面留下的是连续的、边界清晰的线。它有力、
        高对比、有粗细节奏，边缘只有极薄的一圈洇。这是画面
        的骨架 —— 参考图里那些黑色的长弧就是它。

     二 · 湿边（晕的边界比内部更黑）
        一大片淡墨摊在纸上，水往边界迁移，颜料被带到最外沿
        沉积，于是干了以后边界留下一圈深色的"水痕线"，
        内部反而淡。这是水墨最容易被认出来的特征，
        也是"像不像真墨"的分水岭。

     三 · 沉积（颗粒）
        颜料颗粒沉在纸的纤维凹处，形成细密的散点。
        淡晕内尤其明显。

   所以这里不是"一种墨叠很多层模糊"，而是三种材料各画各的：
   丝用多边形实心填充（硬），晕用路径+裁剪+图案（软中有硬边），
   颗粒用一张可无缝平铺的散点纹理。

   动的不是位置，是形态：
     · 丝的头沿流场缓慢前探，尾同时从另一头退走 —— 笔在走
     · 晕的轮廓半径由噪声场缓慢改写，边界在爬
     · 缠绕的短线被一根"缰绳"拴在浓墨核附近反复改写自己
   ============================================================ */

(function () {
  "use strict";

  const INK = { r: 18, g: 18, b: 16 };
  const ink = function (a) {
    return "rgba(" + INK.r + "," + INK.g + "," + INK.b + "," + a + ")";
  };

  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  const TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 三维值噪声 ---------- */
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
    const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
    const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
    const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
    const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf);
    const x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
    return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
  }

  /* ---------- 流场 ----------
     φ 的旋度，数学上无散度：墨被推着走，却不会在流场里堆成团。
     再叠一个很轻的涡心，让部分段落打旋而不是全网同向平移。 */
  const GH = 7;
  const INV2GH = 1 / (2 * GH);
  const _v = [0, 0];

  function pot(x, y, t, F) {
    /* 两个尺度：低频给大弧，高频给局部的拐、折、抖。
       只有一个尺度时，所有墨迹会被同一套平滑势场带成同心弧 ——
       那正是"圆规画的线"。 */
    return (
      Math.sin(x * F.f1 + t * F.s1) * Math.cos(y * F.f2 - t * F.s2) +
      0.55 * Math.sin((x - y) * F.f3 + t * F.s3) +
      0.22 * Math.sin(x * F.f1 * 3.7 - t * F.s1 * 1.9) * Math.cos(y * F.f2 * 4.3 + t * F.s2 * 1.6)
    );
  }

  function velAt(x, y, t, F, out) {
    const a = pot(x, y + GH, t, F);
    const b = pot(x, y - GH, t, F);
    const c = pot(x + GH, y, t, F);
    const d = pot(x - GH, y, t, F);
    let vx = (a - b) * INV2GH;
    let vy = -(c - d) * INV2GH;

    const dx = x - F.vx;
    const dy = y - F.vy;
    const d2 = dx * dx + dy * dy + 1600;
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
     三种笔性
     ------------------------------------------------------------
     spine  主带  长、横贯画面、宽窄剧烈，画面的骨架
     mid    次带  与主带交叉、分叉，把几根线织成一片关系
     hair   游丝  细到几乎是一根纤维，跑得快，贴着主带分叉出去
     ============================================================ */
  const KINDS = {
    /* 宽幅主带：参考图里真正的主体 —— 一条横贯画面的墨带，宽的地方
       七八十像素，窄的地方收成一根线。没有这种量级的宽度，笔就只能
       是"描边"，永远出不来墨压在纸上的重量。 */
    spine: {
      p: 0.34,
      n: [74, 96],
      seg: [24, 32],
      hw: [24, 52],
      speed: [1.5, 3.0],
      tens: [0.010, 0.034],
      life: [150, 250],
      gap: 0.900,          /* 飞白阈值：越大越少断 */
      alpha: 0.95,
      head: [1.6, 3.2],
    },
    /* 次级带：跟主带交叉、分叉，把画面从"几根线"变成"一片关系" */
    mid: {
      p: 0.34,
      n: [48, 68],
      seg: [18, 26],
      hw: [8, 19],
      speed: [2.0, 3.8],
      tens: [0.014, 0.045],
      life: [110, 190],
      gap: 0.872,
      alpha: 0.90,
      head: [1.2, 2.6],
    },
    /* 游丝：细到几乎是一根纤维，跑得快，贴在宽带边上 */
    hair: {
      p: 0.32,
      n: [28, 50],
      seg: [11, 19],
      hw: [1.4, 3.4],
      speed: [3.0, 5.6],
      tens: [0.020, 0.060],
      life: [70, 140],
      gap: 0.845,
      alpha: 0.80,
      head: [1.0, 2.2],
    },
  };

  const KIND_NAMES = ["spine", "mid", "hair"];
  const KIND_FIELDS = ["p", "n", "seg", "hw", "speed", "tens", "life", "gap", "alpha", "head"];

  for (let i = 0; i < KIND_NAMES.length; i++) {
    const K = KINDS[KIND_NAMES[i]];
    for (let j = 0; j < KIND_FIELDS.length; j++) {
      if (K[KIND_FIELDS[j]] === undefined) {
        if (window.console) console.warn("ink: KINDS." + KIND_NAMES[i] + " 缺字段 " + KIND_FIELDS[j]);
      }
    }
  }

  /* 需要"识别到墨迹就自动描边"的文字 */
  const TEXT_SEL = [
    ".hero-title-cn", ".hero-line", ".hero-sub",
    ".title-lg", ".reader-title", ".section-title",
    ".volume-name", ".volume-desc",
    ".entry .name", ".entry .desc",
    ".reading p", ".lede", ".hero-meta-num",
    ".colophon p",
    ".brand", ".nav a", ".nav-toggle",
  ].join(",");

  const MAXN = 128;

  function mkCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(w));
    c.height = Math.max(2, Math.round(h));
    return c;
  }

  class InkField {
    constructor(host) {
      this.host = host;

      const canvas = document.createElement("canvas");
      canvas.className = "ink-canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);

      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true });

      const fixSeed = (String(window.location.search || "").match(/inkseed=(\d+)/) || [])[1];
      this.seed = fixSeed ? (parseInt(fixSeed, 10) >>> 0) : (Math.random() * 0xffffffff) >>> 0;
      this.rnd = mulberry32(this.seed);

      this.t = 0;
      this.frame = 0;
      this.acc = 0;
      this.last = 0;
      this.lastHalo = 0;
      this.lastWash = -1;
      this.raf = 0;
      this.w = 0;
      this.h = 0;
      this.dpr = 1;

      this.threads = [];
      this.drops = [];
      this.washes = [];

      this.flow = {
        f1: 0.0019 + this.rnd() * 0.0015,
        f2: 0.0023 + this.rnd() * 0.0017,
        f3: 0.0034 + this.rnd() * 0.0024,
        s1: 0.030 + this.rnd() * 0.030,
        s2: 0.026 + this.rnd() * 0.028,
        s3: 0.038 + this.rnd() * 0.034,
        fx: 0.2 + this.rnd() * 0.6,
        fy: 0.2 + this.rnd() * 0.6,
        vr: 0.6 + this.rnd() * 0.6,
        /* 涡只做"轻轻带一下方向"。太强的话每一条墨都会绕着它转，
           最后变成一组同心环 —— 那是几何图形，不是墨迹 */
        vs: 0.10 + this.rnd() * 0.20,
        spin: (this.rnd() < 0.5 ? -1 : 1) * (0.5 + this.rnd() * 0.5),
        vx: 0,
        vy: 0,
        vr2: 1,
      };

      this.cell = 44;
      this.cols = 1;
      this.rows = 1;
      this.grid = new Float32Array(1);

      this._cx = new Float32Array(MAXN);
      this._cy = new Float32Array(MAXN);
      this._nx = new Float32Array(MAXN);
      this._ny = new Float32Array(MAXN);
      this._ww = new Float32Array(MAXN);
      /* 笔道两侧的宽度必须各自独立：共用一个数值时，某一点收窄就把
         整笔掐成一个结，笔身会变成一串珠子。真墨是一侧被纤维咬掉
         一块，另一侧还是满的。 */
      this._wa = new Float32Array(MAXN);
      this._wb = new Float32Array(MAXN);
      this._jt = new Float32Array(MAXN);
      this._ox = new Float32Array(MAXN * 8 + 8);
      this._oy = new Float32Array(MAXN * 8 + 8);
      /* 笔身三道：[浓度, 半宽系数, 横向偏移]。由外向内，一层比一层窄、
         一层比一层浓；偏移让浓芯偏向一侧，笔才有"偏锋" */
      this._pass = [
        [0.84, 0.97, 0.00],
        [0.90, 0.80, 0.06],
        [0.96, 0.46, 0.10],
      ];

      this.texts = [];
      this.debug = /inkdebug/.test(window.location.search || "");
      this.nowash = /nowash/.test(window.location.search || "");
      this.nowet = /nowet/.test(window.location.search || "");
      this.nodry = /nodry/.test(window.location.search || "");
      this.nodry = /nodry/.test(window.location.search || "");
      this.nothr = /nothr/.test(window.location.search || "");
      /* 无头截图用：?inkframes=N 跑满 N 帧就停下，画面才"稳定"得下来 */
      const fc = (String(window.location.search || "").match(/inkframes=(\d+)/) || [])[1];
      this.frameCap = fc ? parseInt(fc, 10) : 0;

      const vw = window.innerWidth || 1200;
      const vh = window.innerHeight || 800;
      this.mobile = Math.min(vw, vh) < 640;
      this.page = (document.body && document.body.getAttribute("data-page")) || "";

      this.buildGran();
      this.buildWashSprites();
      this.buildDry();
      this.resize(true);
    }

    /* ---------- 颗粒纹理：可无缝平铺的沉积散点 ----------
       两块砖：
         gran    深色散点（叠在淡晕上 = 颜料沉积）
         inkGran 实心墨 + 透明孔洞（当作笔迹的填充图案 =
                 笔画天生带纸纤维的透气感，不用每帧全屏擦除） */
    buildGran() {
      const S = 256;
      const R = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
      const dots = [];
      for (let i = 0; i < 1500; i++) {
        dots.push({
          x: R() * S,
          y: R() * S,
          r: 0.18 + Math.pow(R(), 3) * 1.30,
          a: 0.07 + R() * 0.30,
        });
      }
      /* 絮聚：颜料不是均匀撒开的，它成团结块 —— 一团里挤着十几颗。
         没有这一层，淡墨就是一片平噪点，像砂纸而不像水痕 */
      const fine = dots.length;
      for (let f = 0; f < 70; f++) {
        const fx = R() * S;
        const fy = R() * S;
        const rad = 2.4 + Math.pow(R(), 2) * 12;
        const cnt = 4 + ((R() * 10) | 0);
        for (let k = 0; k < cnt; k++) {
          const ang = R() * TAU;
          const dd = rad * Math.sqrt(R());
          dots.push({
            x: (fx + Math.cos(ang) * dd + S) % S,
            y: (fy + Math.sin(ang) * dd + S) % S,
            r: 0.22 + Math.pow(R(), 2.2) * 1.5,
            a: 0.06 + R() * 0.24,
          });
        }
      }

      const cv = mkCanvas(S, S);
      const g = cv.getContext("2d");
      const cv2 = mkCanvas(S, S);
      const g2 = cv2.getContext("2d");

      /* 墨砖：一层用来填充笔身的"砖面"。砖面本身不能是实黑 ——
         实黑填出来的笔是一卷胶带。它必须是**浸透的纸**：底色只有
         六成浓度，上面压着一层更浓的颗粒，再被凿出一层孔洞。
         三层叠在一张 256 的贴图上，一层填充就带上了颗粒与浓淡。 */
      g2.fillStyle = ink(0.92);
      g2.fillRect(0, 0, S, S);
      for (let i = 0; i < 520; i++) {
        const x = R() * S;
        const y = R() * S;
        const r = 1.1 + Math.pow(R(), 2) * 4.6;
        g2.fillStyle = ink(0.55 + R() * 0.45);
        g2.beginPath();
        g2.arc(x, y, r, 0, TAU);
        g2.fill();
      }

      /* 孔洞：这才是墨在纤维里透气的地方。孔不是圆点 —— 圆的、等大
         的、均匀分布的孔会读成"洞洞板"。纸纤维是横着的，孔就沿横向
         拉长两倍多，大小也差一个量级，边缘才有了撕裂感。 */
      g2.globalCompositeOperation = "destination-out";
      /* 长条痕：干刷的纸色缝。横着拉长 4~40px、高不到 2px，
         一条一条顺着笔势撕开 —— 这一层是"刷"与"涂"的分界，
         而且它长在贴图里，不需要每帧再擦一次。 */
      for (let i = 0; i < 520; i++) {
        const x = R() * S;
        const y = R() * S;
        const w = 4 + Math.pow(R(), 2.2) * 40;
        const h = 0.4 + R() * 1.5;
        g2.globalAlpha = 0.20 + R() * 0.45;
        g2.fillRect(x, y, w, h);
      }
      for (let i = 0; i < 1900; i++) {
        const x = R() * S;
        const y = R() * S;
        const r = 0.30 + Math.pow(R(), 2.3) * 2.2;
        g2.globalAlpha = 0.16 + R() * 0.40;
        g2.beginPath();
        g2.ellipse(x, y, r * 2.4, r, (R() - 0.5) * 0.5, 0, TAU);
        g2.fill();
      }

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const ox0 = d.x < d.r + 2 ? -1 : 0;
        const ox1 = d.x > S - d.r - 2 ? 1 : 0;
        const oy0 = d.y < d.r - 2 ? -1 : 0;
        const oy1 = d.y > S - d.r - 2 ? 1 : 0;
        for (let ox = ox0; ox <= ox1; ox++) {
          for (let oy = oy0; oy <= oy1; oy++) {
            const px = d.x + ox * S;
            const py = d.y + oy * S;
            g.fillStyle = ink(d.a);
            g.beginPath();
            g.arc(px, py, d.r, 0, TAU);
            g.fill();

            /* 墨砖只借细颗粒打孔（纤维级透气）。絮聚团若也打孔，
               笔画会被凿成筛子 —— 那团絮是给淡晕用的 */
            if (i < fine) {
              g2.globalAlpha = Math.min(1, 0.30 + d.a * 0.95);
              g2.beginPath();
              g2.arc(px, py, d.r * 0.85, 0, TAU);
              g2.fill();
            }
          }
        }
      }
      g2.globalAlpha = 1;
      g2.globalCompositeOperation = "source-over";
      this.gran = cv;
      this.inkGran = cv2;
    }

    /* ---------- 干刷：一张"纸色透出"的条痕图案 ----------
       湿墨是连续的，干刷是断的。参考图里那些墨带的内部根本不是一块
       实心黑，而是被刷毛拖出的一排排纸色条痕 —— 只有靠擦除才做得出来：
       叠加永远只会更深，永远做不出"透出纸"。
       图案沿笔势方向拉长，用时整幅 destination-out 一次。 */
    buildDry() {
      const S = 256;
      this.dryCvs = [];
      for (let v = 0; v < 4; v++) {
        const R = mulberry32((this.seed ^ 0x5bf03635 ^ (v * 7919)) >>> 0);
        const cv = mkCanvas(S, S);
        const g = cv.getContext("2d");
        for (let i = 0; i < 150; i++) {
          const y = R() * S;
          const h = 0.4 + Math.pow(R(), 2) * 2.6;
          g.fillStyle = ink(0.10 + R() * 0.40);
          g.fillRect(0, y, S, h);
        }
        /* 沿笔势断开：没有断口，条痕就只是一层均匀的横纹 */
        g.globalCompositeOperation = "destination-out";
        for (let i = 0; i < 620; i++) {
          const x = R() * S;
          const y = R() * S;
          const w = 2 + Math.pow(R(), 2) * 34;
          const h = 0.8 + R() * 3.4;
          g.globalAlpha = 0.45 + R() * 0.55;
          g.fillRect(x, y, w, h);
        }
        g.globalAlpha = 1;
        this.dryCvs.push(cv);
      }
      this.dryCv = this.dryCvs[0];
      this.dryPats = null;
    }

    /* ---------- 一片水渍的贴图 ----------
       淡墨不能靠"径向渐变 + 多层模糊"画出来：那是对着光源的
       平滑衰减，一眼就是打光。真的水渍是**平的** —— 一整片颜色
       几乎一样深，只有颜料沉积不匀造成的斑驳；边界不是渐变消失，
       而是颗粒一颗颗散开、咬出毛边，最外沿再留一根发丝水痕。
       所以整片预先画成一张贴图，用时按需缩放，比每帧现算便宜得多。 */
    buildWashSprites() {
      this.spr = [];
      for (let v = 0; v < 3; v++) {
        this.spr.push(this.makeWashSprite(v * 31.7 + 5.3, 1));
      }
      /* 浓墨核那一片不咬边：它压在丝底下，轮廓要整，否则像霉斑 */
      this.sprSolid = this.makeWashSprite(77.3, 0);
    }

    makeWashSprite(seed, erode) {
      const S = 224;
      const cv = mkCanvas(S, S);
      const g = cv.getContext("2d");
      let img;
      try {
        img = g.createImageData(S, S);
      } catch (_) {
        return cv;
      }
      const d = img.data;
      const s2 = seed * 1.7 + 2.1;

      for (let y = 0; y < S; y++) {
        const uy = ((y + 0.5) / S) * 2 - 1;
        for (let x = 0; x < S; x++) {
          const ux = ((x + 0.5) / S) * 2 - 1;
          /* 方形贴图裁成内切圆：四角直接空掉，省掉判距离 */
          const r = Math.sqrt(ux * ux + uy * uy);

          let a = 0;
          if (r < 1) {
            /* 边界半径被低频噪声改写：水停下来的地方本来就不圆 */
            const en = noise3(ux * 1.7 + seed, uy * 1.7, seed * 0.31);
            const rw = 0.74 + 0.30 * en;
            const rr = r / rw;

            if (rr < 1) {
              /* 内部几乎平坦，只在最外一段收 —— 平坦是"一层颜料"，
                 渐变是"一颗灯泡" */
              a = 1 - Math.pow(clamp((rr - 0.80) / 0.20, 0, 1), 2.2);

              /* 斑驳：两个尺度的深浅不匀。幅度必须小 ——
                 大幅斑块读成"脏"，微幅才是颜料自己沉得不匀 */
              const m1 = noise3(ux * 2.9 + s2, uy * 2.9, 1.7);
              const m2 = noise3(ux * 6.7, uy * 6.7 + s2, 4.3);
              a *= 0.74 + 0.38 * m1 + 0.14 * (m2 - 0.5);
              if (a > 1) a = 1;

              /* 边缘散成颗粒：越靠近边界越稀。带宽必须很窄 ——
                 咬进去太深，读起来就是纸被撕烂，不是水干掉 */
              if (erode && rr > 0.88) {
                const t = (rr - 0.88) / 0.12;
                const hf = noise3(ux * 52 + s2 * 3, uy * 52, 8.1);
                const hf2 = noise3(ux * 121, uy * 121 + s2, 11.3);
                const m = (hf * 0.55 + hf2 * 0.45 - t * 0.72) / 0.26;
                a *= clamp(0.10 + 0.90 * m, 0.04, 1);
              }
            }
          }

          const i = (y * S + x) * 4;
          d[i] = INK.r;
          d[i + 1] = INK.g;
          d[i + 2] = INK.b;
          d[i + 3] = (a > 0 ? (a > 1 ? 1 : a) : 0) * 255;
        }
      }
      g.putImageData(img, 0, 0);
      return cv;
    }

    /* ---------- 尺寸与离屏层 ---------- */
    resize(initial) {
      const w = Math.max(2, this.host.clientWidth || window.innerWidth || 2);
      const h = Math.max(2, this.host.clientHeight || window.innerHeight || 2);

      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      const maxArea = 2.6e6;
      if (w * h * dpr * dpr > maxArea) dpr = Math.sqrt(maxArea / (w * h));
      dpr = Math.max(1, dpr);

      this.w = w;
      this.h = h;
      this.dpr = dpr;

      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* 晕层：0.40 倍。它本来就是一片极淡的场，放大四倍也看不出；
         湿边那根 1px 的线另外画在主画布上，不受这里影响。
         这一层每帧都要整幅重铺一次，分辨率就是它的成本。 */
      const ws = 0.40;
      this.washCv = mkCanvas(w * ws * dpr, h * ws * dpr);
      this.washCtx = this.washCv.getContext("2d");
      this.washCtx.setTransform(this.washCv.width / w, 0, 0, this.washCv.height / h, 0, 0);

      /* 洇层：0.28 倍，上采样即高斯模糊 —— 只为"丝"的薄晕服务 */
      const ss = 0.20;
      this.softCv = mkCanvas(w * ss * dpr, h * ss * dpr);
      this.softCtx = this.softCv.getContext("2d");
      this.softCtx.setTransform(this.softCv.width / w, 0, 0, this.softCv.height / h, 0, 0);

      /* 墨层：丝与干刷都画在这一层，再整层压到主画布上。
         干刷要用 destination-out 擦 —— 直接擦主画布会连淡晕一起擦掉，
         墨带四周就出现一圈发白的空地，整幅立刻显脏。 */
      const is = 0.52;
      this.inkCv = mkCanvas(w * is * dpr, h * is * dpr);
      this.inkCtx = this.inkCv.getContext("2d");
      this.inkCtx.setTransform(this.inkCv.width / w, 0, 0, this.inkCv.height / h, 0, 0);

      this.granPat = null;
      this.inkGranPat = null;
      try {
        this.granPat = this.washCtx.createPattern(this.gran, "repeat");
        this.inkGranPat = this.inkCtx.createPattern(this.inkGran, "repeat");
      } catch (_) {}
      this.dryPat = null;

      const F = this.flow;
      const short = Math.min(w, h);
      F.vx = F.fx * w;
      F.vy = F.fy * h;
      F.vr2 = (short * F.vr) * (short * F.vr);

      this.cell = w < 640 ? 36 : 44;
      this.cols = Math.max(1, Math.ceil(w / this.cell));
      this.rows = Math.max(1, Math.ceil(h / this.cell));
      this.grid = new Float32Array(this.cols * this.rows);

      if (!initial) this.rebuild();
    }

    rebuild() {
      this.threads.length = 0;
      this.drops.length = 0;
      this.compose();
      this.ensureThreads();
      this.renderWash();
      this.warp(2.2);
    }

    /* ============================================================
       构图
       ------------------------------------------------------------
       不做平均分布。先定一个偏心的"浓墨核"，再让大面积的淡晕
       从它旁边铺开、让丝从画面边缘穿过它。
       ============================================================ */
    compose() {
      const R = this.rnd;
      const w = this.w;
      const h = this.h;
      const short = Math.min(w, h);

      /* 视觉重心：避开面积最大的那块文字 —— 墨压在大标题正中间，
         既难看又伤可读性；贴着它、绕着它才是"融进界面" */
      this.core = this.pickCore(short);
      if (this.mobile) {
        this.core.y = Math.min(this.core.y, h * 0.5);
        this.core.r = short * (0.16 + 0.06 * R());
      }
      /* 浓墨核是一条"拖痕"，不是一颗球：给它一个长轴，
         所有缠丝都顺着这根轴叠，核的淡晕也沿轴拉长 */
      const ca = R() * TAU;
      this.core.ax = Math.cos(ca);
      this.core.ay = Math.sin(ca);
      this.core.half = short * (0.11 + 0.06 * R());

      /* 纸纤维的方向族。参考图里所有墨迹几乎是一个方向上的几组条纹：
         它们互相叠压、错开、长短不一，但**大势同向** —— 这正是
         "墨迹之间形成连续视觉关系"的来源。每笔在此基础上偏 ±6°，
         再让各自的流场把局部拉弯，于是一组平行而不呆板的条纹。 */
      this.famAng = -0.22 + R() * 0.40;

      /* 晕：两片很大的淡墨。关键是半径要**大于**圆心到最远角的距离 ——
         于是可见的那一片永远落在它的内部，边界在画框之外。
         只要边界进到画面里，它立刻变成一个"贴在纸上的色块"。 */
      const nw = 2;
      this.washes = [];
      const corner = Math.sqrt(w * w + h * h) * 0.5;
      for (let i = 0; i < nw; i++) {
        const ang = R() * TAU;
        const dist = short * (0.22 + 0.40 * R());
        const cxx = w * 0.5 + Math.cos(ang) * dist * 1.30;
        const cyy = h * 0.5 + Math.sin(ang) * dist;
        /* 到四个角里最远的那个 + 一点余量 */
        let far = 0;
        for (let q = 0; q < 4; q++) {
          const px = q === 0 || q === 2 ? 0 : w;
          const py = q < 2 ? 0 : h;
          const dd = Math.sqrt((px - cxx) * (px - cxx) + (py - cyy) * (py - cyy));
          if (dd > far) far = dd;
        }
        /* 一片铺满全幅的"场"，一片边界切过画面的"弧"：
           场给深度，弧给一道水停在纸上的痕 */
        const rr = i === 0 ? far * (1.06 + 0.22 * R()) : far * (0.52 + 0.24 * R());
        this.washes.push({
          cx0: cxx,
          cy0: cyy,
          cx: 0,
          cy: 0,
          r0: rr,
          r: rr,
          rag: 0.86 + 0.5 * R(),
          rot: R() * TAU,
          seed: R() * 900,
          /* 第一片是"场"（铺满全幅，没有边界）；第二片几乎不着色，
             它存在的唯一理由是让那道水痕线切过画面 —— 一片能看见边界
             的淡色，永远会被读成"贴上去的色块"。 */
          dens: (i === 0 ? 0.55 + 0.55 * R() : 0.15 + 0.13 * R()) * (this.mobile ? 0.5 : 1),
          edge: 0.70 + 0.5 * R(),
          wf: 0.018 + 0.026 * R(),
          wl: short * (0.02 + 0.05 * R()),
          ph: R() * 20,
          pr: 0.35 + 0.4 * R(),
          pa: R() * TAU,
        });
      }

      /* 浓墨核不再单独画一片"底"。
         试过很多次：任何一片二维的圆形/椭圆色块压在丝底下，无论多淡、
         轮廓多不规则，最后都会被读成一个"墨团"或一层打光 —— 那正是
         这版要彻底扔掉的东西。核的重量只能由丝自己叠出来：
         十几笔画同一处，浓的地方自然浓，边缘是收敛的丝尖。 */
      this.primeDrops();
    }

    /* 在若干候选点里挑一个"离大块文字最远"的当视觉重心。
       文字来自 DOM，所以墨永远不会正好压在标题正中间。 */
    pickCore(short) {
      const w = this.w;
      const h = this.h;
      const R = this.rnd;
      const sy = window.scrollY || window.pageYOffset || 0;
      const texts = [];
      for (let i = 0; i < this.texts.length; i++) {
        const t = this.texts[i];
        const area = t.w * t.h;
        if (area < 4000) continue;
        texts.push({ l: t.left, r: t.left + t.w, t: t.top - sy, b: t.top - sy + t.h, a: area });
      }
      const total = w * h;

      let best = null;
      let bestScore = -1e9;
      for (let i = 0; i < 14; i++) {
        /* 七成候选贴着画框边缘：墨从纸外延伸进来，中间才留得住空白；
           全都撒在中间的话，长文页面上总有一笔横在字上 */
        let cx0, cy0;
        if (R() < 0.7) {
          const side = (R() * 4) | 0;
          const b = 0.02 + 0.14 * R();
          if (side === 0) { cx0 = w * b; cy0 = h * (0.1 + 0.8 * R()); }
          else if (side === 1) { cx0 = w * (1 - b); cy0 = h * (0.1 + 0.8 * R()); }
          else if (side === 2) { cx0 = w * (0.1 + 0.8 * R()); cy0 = h * b; }
          else { cx0 = w * (0.1 + 0.8 * R()); cy0 = h * (1 - b); }
        } else {
          cx0 = w * (0.2 + 0.6 * R());
          cy0 = h * (0.2 + 0.6 * R());
        }
        const c = { x: cx0, y: cy0, r: short * (0.12 + 0.07 * R()) };
        let score = R() * 0.55;
        for (let j = 0; j < texts.length; j++) {
          const t = texts[j];
          const dx = Math.max(t.l - c.x, 0, c.x - t.r);
          const dy = Math.max(t.t - c.y, 0, c.y - t.b);
          const d = Math.sqrt(dx * dx + dy * dy);
          score += Math.min(1, d / (short * 0.45)) * (t.a / total) * 9;
        }
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best || { x: w * 0.7, y: h * 0.3, r: short * 0.16 };
    }

    /* 开局撒一层已成形的飞溅（画面一亮就该有） */
    primeDrops() {
      const R = this.rnd;
      const n = this.mobile ? 26 : 46;
      for (let i = 0; i < n; i++) {
        const a = R() * TAU;
        const d = this.core.r * (0.5 + 2.6 * Math.pow(R(), 0.7));
        this.pushDrop(
          this.core.x + Math.cos(a) * d,
          this.core.y + Math.sin(a) * d * 0.8,
          0.5 + Math.pow(R(), 2) * 2.6,
          0.3 + R() * 0.55,
          R() * 40
        );
      }
    }

    /* ---------- 覆盖度栅格（文字描边判定用） ---------- */
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
        const hw = fs >= 60 ? 7 : fs >= 30 ? 5 : fs >= 19 ? 3.4 : 2.1;
        if (el.__haloW !== hw) {
          el.__haloW = hw;
          el.style.setProperty("--halo-w", hw + "px");
        }
        out.push({ el: el, left: r.left, top: r.top + sy, w: r.width, h: r.height, on: false });
      }
      this.texts = out;
    }

    /* ============================================================
       起一笔
       ============================================================ */
    spawn(kind) {
      const K = KINDS[kind];
      const R = this.rnd;
      const w = this.w;
      const h = this.h;

      let sx, sy, leash = null;

      if (kind === "hair" && R() < 0.55 && this.threads.length) {
        /* 从已有的一笔上分叉出去：层叠与连续关系 */
        const src = this.threads[(R() * this.threads.length) | 0];
        const P = src.pts;
        if (P.length > 8) {
          const i = 3 + ((R() * (P.length - 6)) | 0);
          const p = P[i];
          const a = P[i - 1];
          const b = P[i + 1];
          let tx = b.x - a.x;
          let ty = b.y - a.y;
          const tl = Math.sqrt(tx * tx + ty * ty) || 1;
          tx /= tl;
          ty /= tl;
          const side = R() < 0.5 ? -1 : 1;
          const off = src.hw * (1.1 + R() * 1.6);
          sx = p.x - ty * side * off;
          sy = p.y + tx * side * off;
        }
      }

      /* 条带族：主带不从画面四周乱起，而是围绕视觉重心组织成一组
         近乎平行的长带 —— 每条都从重心的"上游"退到画框之外起笔，
         穿过重心附近，再向下游延伸出去。于是它们彼此叠压、宽窄错落，
         在重心附近自然叠浓，画面边缘只剩几根渐细的尾巴。
         这正是参考图里那种"一片横向条纹"的来源：靠的是构图，
         不是靠十几条随机流线碰巧凑到一起。 */
      if ((kind === "spine" || kind === "mid") && this.core) {
        const fa = this.famAng || 0;
        const fx = Math.cos(fa);
        const fy = Math.sin(fa);
        const px = -fy;
        const py = fx;
        /* 装订线：条带按帧高均分，每条都从画框外起笔、横贯整幅。
           让起点跟着"视觉重心"走，结果是所有笔都从重心那一侧探头，
           只露出几个尖 —— 墨带必须真的穿过画面。
           换向的那几条（从右往左）负责交错，画面才不像一把排刷。 */
        const lanes = kind === "spine" ? 6 : 4;
        /* 轮流占线 + 抖动：纯随机会让几条撞在同一个高度，画面只剩一条；
           严格轮流又是一把等间距的排刷 */
        const lane = ((this._laneSeq = (this._laneSeq || 0) + 1) % lanes) +
          (R() - 0.5) * 0.9;
        const u = ((lane + 0.5) / lanes - 0.5) * h * 0.72 + (R() - 0.5) * h * 0.08;
        const dir = R() < 0.74 ? 1 : -1;
        const off = w * (0.16 + R() * 0.22);
        sx = (dir > 0 ? -off : w + off) + (R() - 0.5) * 40;
        sy = h * 0.5 + u * dir - py * 0;
      }

      if (sx === undefined) {
        /* 从画面边缘入画。七成走左右两边 —— 横贯画面的条带才有
           "墨从纸外拖进来"的方向感；上下两边进来的笔太短，
           在水平纤维族里只会变成一小截竖直的短棒。 */
        const pick = R();
        const side = pick < 0.36 ? 0 : pick < 0.72 ? 1 : pick < 0.86 ? 2 : 3;
        const inset = 6 + R() * 90;
        if (side === 0) { sx = inset; sy = h * (0.02 + 0.96 * R()); }
        else if (side === 1) { sx = w - inset; sy = h * (0.02 + 0.96 * R()); }
        else if (side === 2) { sx = w * (0.02 + 0.96 * R()); sy = inset; }
        else { sx = w * (0.02 + 0.96 * R()); sy = h - inset; }
        /* 左右进画时再沿方向退半步，让笔尖落在画框外，
           于是墨是从画外流进来的，而不是凭空出现在边上 */
        if (side === 0 || side === 1) {
          const back = 20 + R() * 90;
          sx += (side === 0 ? -1 : 1) * back * (0.35 + 0.65 * R());
        }
      }

      /* 笔画尺寸跟着画面走：同一条 40px 的墨在 1440 宽的桌面上是宽带，
         在 390 宽的手机上就是半屏黑，会把文字全压掉 */
      /* 手机屏幕上一条 40px 的墨带就是半屏黑：随画面缩的不只是尺寸，
         还要再压一档，否则墨会把字全吃掉 */
      const quiet2 = this.page === "read";
      const sk = clamp(Math.min(w, h) / 900, 0.30, 1) *
        (quiet2 ? 0.62 : 1) * (this.mobile ? 0.66 : 1);

      /* 方向落在纤维族上，每笔只许偏 ±6°：条纹族才有"关系" */
      const axAng = (this.famAng || 0) + (kind === "mid" ? (R() - 0.5) * 0.9 : (R() - 0.5) * 0.12);

      const r = {
        kind: kind,
        K: K,
        hw: lerp(K.hw[0], K.hw[1], R()) * sk,
        speed: lerp(K.speed[0], K.speed[1], R()) * (0.7 + 0.3 * sk),
        seg: lerp(K.seg[0], K.seg[1], R()) * (0.55 + 0.45 * sk),
        tens: lerp(K.tens[0], K.tens[1], R()),
        life: lerp(K.life[0], K.life[1], R()),
        headEvery: lerp(K.head[0], K.head[1], R()),
        gap: K.gap,
        alpha: K.alpha * (this.mobile ? 0.72 : 1),
        seed: R() * 977,
        px0: R() * 256,
        py0: R() * 256,
        iw: (R() * 4096) | 0,
        age: 0,
        headAcc: 0,
        /* 流场给局部拐折，自身偏置给个体差异 */
        bias: (R() - 0.5) * 1.1,
        bleed: 0.45 + R() * 0.75,
        /* 洇偏在哪一侧：墨水在纸上总是往一边爬，两侧一样宽就成了投影 */
        side: R() < 0.5 ? -1 : 1,
        /* 内层各自偏一点：浓芯不在正中，笔才有"偏锋" */
        c1: (R() - 0.5) * 0.26,
        c2: (R() - 0.5) * 0.22,
        c3: (R() - 0.5) * 0.18,
        leash: leash,
        /* 轴向锁定：所有笔被大致拉向纤维族的方向。
           这正是"条纹族"与"各写各的"之间的开关 —— 锁太死是一把尺，
           不锁就散成一团乱麻。0.5~0.8 之间才有笔意。 */
        lock: 0.86 + R() * 0.10,
        axx: Math.cos(axAng),
        axy: Math.sin(axAng),
        spinS: (R() < 0.5 ? -1 : 1) * (0.25 + R() * 0.55),
        F: this.makeField(),
        fx0: 0,
        fy0: 0,
        pts: [],
      };
      r.cb = Math.cos(r.bias);
      r.sb = Math.sin(r.bias);
      r.fx0 = (this.flow.fx + (R() - 0.5) * 0.9) * w;
      r.fy0 = (this.flow.fy + (R() - 0.5) * 0.9) * h;
      r.F.vx = r.fx0;
      r.F.vy = r.fy0;
      const sht = Math.min(w, h);
      r.F.vr2 = (sht * r.F.vr) * (sht * r.F.vr);

      const n = Math.round(lerp(K.n[0], K.n[1], R()));
      const half = Math.max(4, Math.round(n * 0.84));
      const back = [];
      const fwd = [];

      let cx = sx;
      let cy = sy;
      for (let i = 0; i < n - half; i++) {
        const d = this.axisAt(cx, cy, r);
        cx -= d[0] * r.seg;
        cy -= d[1] * r.seg;
        back.push(this.mkPt(cx, cy, i, r));
      }
      back.reverse();

      cx = sx;
      cy = sy;
      fwd.push(this.mkPt(cx, cy, 0, r));
      for (let i = 1; i < half; i++) {
        const d = this.axisAt(cx, cy, r);
        cx += d[0] * r.seg;
        cy += d[1] * r.seg;
        fwd.push(this.mkPt(cx, cy, i, r));
      }

      r.pts = back.concat(fwd);
      /* 起笔时的走向：后面用来防止笔在流场里拐过 180° 绕成一个圈 */
      const q0 = r.pts[0];
      const q1 = r.pts[r.pts.length - 1];
      r.ang0 = Math.atan2(q1.y - q0.y, q1.x - q0.x);
      this.threads.push(r);
      return r;
    }

    mkPt(x, y, i, r) {
      return {
        x: x,
        y: y,
        /* 速度系数沿笔身平滑变化 → 整条被剪切、拉伸，而非刚性平移 */
        sp: 0.6 + 0.8 * fbmSafe(i * 0.07, r.seed, 3.1),
        tn: r.tens * (0.6 + 0.8 * noise3(i * 0.13, r.seed, 5.5)),
        am: 0.6 + 0.85 * noise3(i * 0.09, r.seed + 17.3, 9.2),
      };
    }

    /* 沿纤维方向、被低频噪声轻轻扭过的方向。
       起笔的点链必须用它来长 —— 用流场长出来的链是弯的，之后笔只
       整体平移，弯就一直留在画面上，最后成了几个大弧。 */
    axisAt(x, y, r, t) {
      const tt = t === undefined ? this.t : t;
      const w = (noise3(x * 0.0017 + r.seed, y * 0.0017, tt * 0.055) - 0.5) *
        (r.kind === "hair" ? 0.95 : 0.5);
      const c = Math.cos(w);
      const sn = Math.sin(w);
      _v[0] = r.axx * c - r.axy * sn;
      _v[1] = r.axx * sn + r.axy * c;
      return _v;
    }

    dirAt(x, y, r) {
      velAt(x, y, this.t, r.F, _v);
      const vx = _v[0] * r.cb - _v[1] * r.sb;
      const vy = _v[0] * r.sb + _v[1] * r.cb;
      _v[0] = vx;
      _v[1] = vy;
      return _v;
    }

    /* 每一笔一套自己的流场：频率、时间项、涡心都略微不同。
       共用一套流场时，所有墨迹会被揉成一组互相平行的同心弧 ——
       那是最像"程序生成"的破绽。分岔之后，笔与笔才会以不同角度
       相交、分叉、错开。 */
    makeField() {
      const F = this.flow;
      const R = this.rnd;
      const k = function () { return 0.55 + R() * 0.95; };
      const short = Math.min(this.w, this.h);
      return {
        f1: F.f1 * k(),
        f2: F.f2 * k(),
        f3: F.f3 * k(),
        s1: F.s1 * k(),
        s2: F.s2 * k(),
        s3: F.s3 * k(),
        vr: 0.5 + R() * 0.9,
        vs: F.vs * (0.4 + R() * 0.9),
        spin: (R() < 0.5 ? -1 : 1) * (0.45 + R() * 0.55),
        vx: 0,
        vy: 0,
        vr2: short * short * 0.25,
      };
    }

    ensureThreads() {
      /* 手机上不要那些宽带：屏幕只有 390 宽，一条 40px 的墨带就是
         半屏黑，必然压在正文上，任何光晕都救不回来。细长的游丝才是
         这块小屏能承受的墨。正文页同理 —— 那一页整屏都是字。 */
      const quiet = this.mobile || this.page === "read";
      const dark = this.page === "music";
      const want = this.mobile
        ? { spine: 1, mid: 2, hair: 2 }
        : dark
          ? { spine: 1, mid: 2, hair: 3 }
          : quiet
            ? { spine: 1, mid: 1, hair: 3 }
            : { spine: 6, mid: 3, hair: 3 };
      for (let i = 0; i < KIND_NAMES.length; i++) {
        const k = KIND_NAMES[i];
        let n = 0;
        for (let j = 0; j < this.threads.length; j++) if (this.threads[j].kind === k) n++;
        let guard = 0;
        while (n < want[k] && guard++ < 6) {
          this.spawn(k);
          n++;
        }
      }
    }

    /* ============================================================
       一步：形态演化
       ============================================================ */
    updateThread(r, dt) {
      const P = r.pts;
      const n = P.length;
      const spd = r.speed;

      for (let i = 0; i < n; i++) {
        const p = P[i];
        const d = this.dirAt(p.x, p.y, r);
        /* 轴向锁定：缠丝被拉向浓墨核的长轴方向。
           只靠起笔时的 bias 不够 —— 走几十像素以后流场就把它们带散了，
           十几条散开的短笔收拢起来就是一束尖片，不是一摊墨 */
        if (r.lock > 0) {
          /* 走向 = 纤维方向被低频噪声轻轻扭一下。
             不能直接混流场：流场是旋涡，一条一千多像素长的笔在
             里面走，几十帧后就被卷成一个圈 —— 画面上会出现几个
             闭合的大环，那是"程序生成"最明显的破绽。
             噪声只改角度、幅度有界，于是笔永远是缓弧，不会回头。 */
          const wob = (noise3(p.x * 0.0017 + r.seed, p.y * 0.0017, this.t * 0.055) - 0.5) *
            (r.kind === "hair" ? 0.95 : 0.85);
          const cw = Math.cos(wob);
          const sw = Math.sin(wob);
          const ax = r.axx * cw - r.axy * sw;
          const ay = r.axx * sw + r.axy * cw;
          const ix = d[0] * (1 - r.lock) + ax * r.lock;
          const iy = d[1] * (1 - r.lock) + ay * r.lock;
          const im = Math.sqrt(ix * ix + iy * iy) || 1;
          d[0] = ix / im;
          d[1] = iy / im;
        }
        const s = spd * p.sp * dt;
        p.x += d[0] * s;
        p.y += d[1] * s;

        /* 垂直于走向的一点手抖：纸的纤维会把水往两边带，
           笔道因此不是一条数学曲线，而是有细微的偏摆 */
        const j = noise3(p.x * 0.024 + r.seed, p.y * 0.024, this.t * 0.30) - 0.5;
        p.x += -d[1] * j * 0.85 * dt * 6;
        p.y += d[0] * j * 0.85 * dt * 6;

      /* 缰绳：拴在浓墨核附近的笔不许走远，于是原地反复改写自己。
         缰绳其实是"一段"而不是"一点"：沿核的长轴走不算跑远，
         只有横向跑出去才被拉回来。否则所有短笔从同一个点朝四周
         放射，收拢以后就是一朵黑花 —— 那是个图形，不是墨。 */
        const L = r.leash;
        if (L) {
          let dx = p.x - L.x;
          let dy = p.y - L.y;
          if (L.ax !== undefined) {
            const t2 = dx * L.ax + dy * L.ay;
            /* 沿轴超出的部分也要拉回来。只约束横向的话，笔的两头会顺着
               轴一直跑出去，最后变成几根直挺挺的竹竿插在一片墨上 */
            const over = t2 > L.half ? t2 - L.half : t2 < -L.half ? t2 + L.half : 0;
            if (over) {
              const kk = 0.075 * Math.min(2.2, Math.abs(over) / (L.half * 0.5 + 1));
              p.x -= L.ax * over * kk;
              p.y -= L.ay * over * kk;
            }
            dx -= L.ax * t2;
            dy -= L.ay * t2;
          }
          const q2 = (dx * dx + dy * dy) / (L.r * L.r);
          /* 轴锁定的笔收得更紧：它们要靠得足够近才能叠成一摊，
             散开到 ±0.3r 就变成几片分开的花瓣了 */
          const thr = r.lock > 0 ? 0.015 : 0.10;
          if (q2 > thr) {
            const k = (r.lock > 0 ? 0.10 : 0.055) * (q2 - thr);
            p.x -= dx * k;
            p.y -= dy * k;
          }
          /* 切向绕转：让这些小笔在核里盘起来。
             只有径向回拉的话，它们会像烟花一样朝外发散成一只刺猬。
             但轴向锁定的笔不许绕 —— 绕就是把一条拖痕收成一团线球。 */
          const sw = 0.011 * r.spinS * (1 - r.lock) * Math.min(1.4, 0.3 + q2);
          p.x += -dy * sw;
          p.y += dx * sw;
        }

        /* 兜底：一个非有限坐标会让整条多边形的路径变成 NaN，
           Skia 在填充时会直接把渲染进程干掉。宁可就地重置。 */
        if (!(p.x > -1e5 && p.x < 1e5) || !(p.y > -1e5 && p.y < 1e5)) {
          p.x = this.core ? this.core.x : this.w * 0.5;
          p.y = this.core ? this.core.y : this.h * 0.5;
        }
      }

      /* 张力：拉向相邻中点。墨有黏性，不散成沙也不僵成直线 */
      for (let i = 1; i < n - 1; i++) {
        const a = P[i - 1];
        const b = P[i + 1];
        const p = P[i];
        const k = p.tn;
        p.x += ((a.x + b.x) * 0.5 - p.x) * k;
        p.y += ((a.y + b.y) * 0.5 - p.y) * k;
      }

      /* 笔在走：头前探一个节点，尾巴同时退一个 —— 形态一直在换，
         但没有循环、没有关键帧 */
      r.headAcc += dt;
      if (r.headAcc >= r.headEvery) {
        r.headAcc = 0;
        const h = P[n - 1];
        const d = this.axisAt(h.x, h.y, r);
        /* 不许调头。笔在流场里走久了会拐过 180°，头接上尾巴，
           画面上就多了一个闭合的圈 —— 那是最像"程序生成"的证据。
           整笔的偏航一旦超过约 70°，就把它按回到纤维方向上。 */
        if (r.ang0 !== undefined) {
          const a1 = Math.atan2(d[1], d[0]);
          let da = a1 - r.ang0;
          while (da > Math.PI) da -= TAU;
          while (da < -Math.PI) da += TAU;
          const over = Math.abs(da) - 0.9;
          if (over > 0) {
            const k = Math.min(0.86, over * 0.85);
            const tx2 = Math.cos(r.ang0);
            const ty2 = Math.sin(r.ang0);
            const nx2 = d[0] * (1 - k) + tx2 * k;
            const ny2 = d[1] * (1 - k) + ty2 * k;
            const nm = Math.sqrt(nx2 * nx2 + ny2 * ny2) || 1;
            d[0] = nx2 / nm;
            d[1] = ny2 / nm;
          }
        }
        const nx = h.x + d[0] * r.seg;
        const ny = h.y + d[1] * r.seg;
        P.push(this.mkPt(nx, ny, n, r));

        /* 笔尖甩出的小点 */
        if (this.rnd() < 0.16) {
          const k = 1 + ((this.rnd() * 3) | 0);
          for (let q = 0; q < k; q++) {
            const a = this.rnd() * TAU;
            const dd = 4 + this.rnd() * r.hw * 9;
            this.pushDrop(
              nx + Math.cos(a) * dd,
              ny + Math.sin(a) * dd,
              0.5 + Math.pow(this.rnd(), 2) * 2.2,
              0.35 + this.rnd() * 0.5,
              this.rnd() * 8
            );
          }
        }

        if (P.length > MAXN) P.shift();
      }
    }

    /* ============================================================
       画一笔：硬边多边形 + 纵向拉丝
       ------------------------------------------------------------
       宽度 = 笔锋宽度 × 两端收锋 × 噪声起伏 × 拉伸（质量守恒）
                × 干燥断裂
       笔身不是一整块黑：它由若干道"沿笔势并行的子带"叠出来，
       而整条轮廓用二次曲线平滑 —— 折线画出来的笔道有棱有角，
       一眼是几何，不是笔。
       ============================================================ */
    paintThread(r, g, aMul, wMul, bands, side, dryPass) {
      const P = r.pts;
      const n = Math.min(P.length, MAXN);
      if (n < 5) return;
      if (bands === undefined) bands = 2;
      if (side === undefined) side = 0;

      const cx = this._cx, cy = this._cy, nx = this._nx, ny = this._ny;
      const ww = this._ww, jt = this._jt;
      const wa = this._wa, wb = this._wb;
      const t = this.t;
      let maxW = 0;

      for (let i = 0; i < n; i++) {
        const p = P[i];
        const a = P[i === 0 ? 0 : i - 1];
        const b = P[i === n - 1 ? n - 1 : i + 1];
        let tx = b.x - a.x;
        let ty = b.y - a.y;
        const tl = Math.sqrt(tx * tx + ty * ty) || 1;
        tx /= tl;
        ty /= tl;

        const q = P[i === n - 1 ? i : i + 1];
        const ddx = q.x - p.x;
        const ddy = q.y - p.y;
        const sl = Math.sqrt(ddx * ddx + ddy * ddy) || r.seg;
        const stretch = clamp(r.seg / sl, 0.62, 1.30);

        const tt = i / (n - 1);
        /* 两端收锋：真笔画不会平切。收锋要**缓** —— 只给两三个点做
           一个尖，出来的是一个菱形叶片；拉长到五六个点才是"提笔" */
        const edge = clamp(Math.min(i, n - 1 - i) / 5.5, 0.05, 1);
        const prof = Math.pow(Math.sin(Math.PI * clamp(tt, 0.02, 0.98)), 0.52) * (0.06 + 0.94 * edge);

        /* 频率必须远低于取样间距（顶点间距 16~26px），否则每个顶点
           各取到一个无关的随机数，笔的边缘就成了一排锯齿 */
        const n1 = noise3(p.x * 0.0062 + r.seed, p.y * 0.0062, t * 0.07);
        const n2 = noise3(p.x * 0.0210, p.y * 0.0210 + r.seed, t * 0.16);
        /* 宽度起伏要狠：真笔会胀、会颈缩、会突然细成一根线。
           微弱起伏 = 一条描边；强烈起伏才是写出来的字 */
        const wob = (0.30 + 1.02 * n1 + 0.26 * (n2 - 0.5)) *
          /* 顶点级的起伏只给 ±8%：宽度上每 18px 来一次大起大落，
             笔道会变成一条蠕动的虫。毛糙交给轮廓的逐点抖动去办 ——
             那才是"边被纸纤维扯开"的尺度 */
          (0.92 + 0.16 * hash3(i, r.iw, 5));

        /* 撕口：少数几个顶点被压到极窄，边缘于是被啃出缺口。
           没有缺口，再宽的墨带也只是"一条边缘完整的宽带"，
           而真墨的边缘永远是断续的、被纤维扯开的。 */
        const tA = hash3(i, r.iw, 23);
        const tB = hash3(i, r.iw + 71, 29);
        const tearA = tA > 0.90 ? 0.20 : tA > 0.80 ? 0.58 : 1;
        const tearB = tB > 0.90 ? 0.20 : tB > 0.80 ? 0.58 : 1;

        /* 飞白：沿笔势的干燥度把宽度压到 0，断口自然是尖的 */
        let dry = 1;
        const dv = noise3(p.x * 0.023 + r.seed * 2.1, p.y * 0.023, t * 0.045 + r.seed * 0.1);
        if (dv > r.gap) dry = clamp(1 - (dv - r.gap) / 0.055, 0, 1);
        if (tt < 0.05 || tt > 0.96) dry = 1;

        let wv = r.hw * prof * wob * (0.66 + 0.42 * stretch) * dry * wMul;
        if (!(wv > 0)) wv = 0;          /* NaN / 负值一律当作零宽 */
        if (wv > maxW) maxW = wv;

        cx[i] = p.x;
        cy[i] = p.y;
        nx[i] = -ty;
        ny[i] = tx;
        ww[i] = wv;
        wa[i] = wv * tearA;
        wb[i] = wv * tearB;
        /* 拉丝的横向游走：让几道子带在行进中靠拢、错开、再并回去，
           而不是永远平行 —— 平行子带看起来就是排线 */
        jt[i] = (noise3(p.x * 0.0125 + r.seed, p.y * 0.0125, t * 0.06) - 0.5) * 2;
      }
      if (maxW < 0.06) return;

      /* 干刷模式：只把这条笔的整幅轮廓填一遍（调用方已经设好
         destination-out 与纸痕图案），自己不碰任何填充样式与透明度 */
      if (dryPass) {
        this.polyRun3(g, 0, n - 1, 0, 0.97, 0.05);
        return;
      }

      /* 笔身按"由外向内"叠三道：满宽的一层是纸上一"浸"，半宽的一层是
         墨的"积"，最里一层才是"浓"。三道就够 —— 再多，每一道的边缘都
         会成一条等高线，笔就成了分层橡皮泥；再少，一次满浓度平涂出来
         是一卷黑胶带，那就不是墨了。
         浓度靠叠、纹理靠墨砖的孔洞，两道一起才透气。 */
      const pat = this.inkGranPat;
      const base = aMul * r.alpha;
      g.fillStyle = pat || ink(1);

      if (bands > 0) {
        const PASS = this._pass;
        for (let b = 0; b < 3; b++) {
          /* 最里一层用实色：浓墨的心必须是实心的。三道都带孔洞的话，
             中心会被凿成一片深灰的碎屑，那是"灰的颗粒"，不是墨的黑。 */
          if (b === 2) g.fillStyle = ink(1);
          else g.fillStyle = pat || ink(1);
          g.globalAlpha = base * PASS[b][0];
          this.polyRun3(g, 0, n - 1, side * PASS[b][2], PASS[b][1],
            b === 2 ? 0.10 : 0.05, b === 0 ? 3 : 1);
          if (b === 2) g.fillStyle = pat || ink(1);
        }
        /* 拉丝：两三道更深的细条压在笔芯里，沿笔势走。没有它，
           宽带的中心是一块均匀的黑，读起来是色块而不是墨 */
        for (let b = 0; b < bands; b++) {
          const u = bands === 1 ? 0 : (b / (bands - 1)) * 2 - 1;
          const bw = noise3(b * 7.3 + r.seed, r.seed * 0.31 + b, 0.5);
          g.globalAlpha = base * (0.05 + 0.13 * bw) * (1 - 0.34 * Math.abs(u));
          this.polyRun3(g, 0, n - 1, u * 0.66, 0.05 + 0.03 * bw, 0.16);
        }
      } else {
        g.globalAlpha = base * 0.30;
        this.polyRun3(g, 0, n - 1, side * 0.5, 1.0, 0.10);
      }
      g.globalAlpha = 1;
    }

    polyRun(g, i0, i1, wm) {
      const cx = this._cx, cy = this._cy, nx = this._nx, ny = this._ny, ww = this._ww;
      let o;
      g.beginPath();
      o = ww[i0] * wm;
      g.moveTo(cx[i0] + nx[i0] * o, cy[i0] + ny[i0] * o);
      for (let i = i0 + 1; i <= i1; i++) {
        o = ww[i] * wm;
        g.lineTo(cx[i] + nx[i] * o, cy[i] + ny[i] * o);
      }
      for (let i = i1; i >= i0; i--) {
        o = ww[i] * wm;
        g.lineTo(cx[i] - nx[i] * o, cy[i] - ny[i] * o);
      }
      g.closePath();
      g.fill();
    }

    /* 子带：中心偏离 uc（以半宽为单位）、半宽 uh，并沿笔势左右游走 jm。
       轮廓走二次曲线，笔道的两侧才是顺的，而不是一段段直线接起来 */
    polyRun3(g, i0, i1, uc, uh, jm, sub) {
      const cx = this._cx, cy = this._cy, nx = this._nx, ny = this._ny;
      const ww = this._ww, jt = this._jt;
      const wa = this._wa, wb = this._wb;
      const ox = this._ox, oy = this._oy;
      let m = 0;
      let i, w, c, a, o, bx, by, px0, py0, tt, fj, amp;

      /* 轮廓细分：每两个取样点之间插三个点，各自沿法线抖一下。
         不细分的话，所谓"毛边"只是每 20px 一个大折角 —— 那是被啃过的
         纸，不是毛边。真正的毛边是 3~6px 尺度的细碎起伏。 */
      const SUB = sub === undefined ? 1 : sub;

      for (i = i0; i <= i1; i++) {
        w = wa[i];
        c = ww[i];
        a = (uc + jm * jt[i]) * c;
        o = a + uh * w;
        bx = cx[i] + nx[i] * o;
        by = cy[i] + ny[i] * o;
        if (m === 0) { ox[m] = bx; oy[m] = by; m++; continue; }
        px0 = ox[m - 1];
        py0 = oy[m - 1];
        for (let k = 1; k < SUB; k++) {
          tt = k / SUB;
          fj = hash3(i * 11 + k, i0, 7) - 0.5;
          amp = fj * (0.9 + c * 0.14);
          ox[m] = px0 + (bx - px0) * tt + nx[i] * amp;
          oy[m] = py0 + (by - py0) * tt + ny[i] * amp;
          m++;
        }
        ox[m] = bx;
        oy[m] = by;
        m++;
      }
      for (i = i1; i >= i0; i--) {
        w = wb[i];
        c = ww[i];
        a = (uc + jm * jt[i]) * c;
        o = a - uh * w;
        bx = cx[i] + nx[i] * o;
        by = cy[i] + ny[i] * o;
        px0 = ox[m - 1];
        py0 = oy[m - 1];
        for (let k = 1; k < SUB; k++) {
          tt = k / SUB;
          fj = hash3(i * 13 + k, i1, 17) - 0.5;
          amp = fj * (0.9 + c * 0.14);
          ox[m] = px0 + (bx - px0) * tt + nx[i] * amp;
          oy[m] = py0 + (by - py0) * tt + ny[i] * amp;
          m++;
        }
        ox[m] = bx;
        oy[m] = by;
        m++;
      }
      this.smoothFill(g, m);
    }

    /* 过中点的二次曲线：C1 连续，笔道的两侧因此是"流"过去的 */
    smoothFill(g, m) {
      const ox = this._ox, oy = this._oy;
      if (m < 3) return;
      /* 兜底：路径里只要混进一个非有限数，Skia 填充时会直接杀掉渲染进程
         （Abnormal renderer termination）。这里整条丢弃，宁可少画一笔。 */
      for (let i = 0; i < m; i++) {
        const x = ox[i], y = oy[i];
        if (!(x > -3e5 && x < 3e5) || !(y > -3e5 && y < 3e5)) return;
      }
      g.beginPath();
      g.moveTo(ox[0], oy[0]);
      for (let i = 1; i < m - 1; i++) {
        g.quadraticCurveTo(ox[i], oy[i], (ox[i] + ox[i + 1]) * 0.5, (oy[i] + oy[i + 1]) * 0.5);
      }
      g.lineTo(ox[m - 1], oy[m - 1]);
      g.closePath();
      g.fill();
    }

    /* ============================================================
       晕：湿边
       ------------------------------------------------------------
       轮廓不是圆，是"半径随方位角被噪声改写"的闭合曲线。
       内部淡淡一层，边界一圈更黑 —— 颜料被水带到了最外沿。
       ============================================================ */
    washGeom(s, t) {
      const N = 168;
      const pts = [];
      const cr = Math.cos(s.rot);
      const sr = Math.sin(s.rot);
      for (let k = 0; k <= N; k++) {
        const th = (k / N) * TAU;
        const ux = Math.cos(th);
        const uy = Math.sin(th);
        const ro = s.rough || 1;
        const n1 = noise3(ux * 1.55 + s.seed, uy * 1.55, t * 0.030);
        const n2 = noise3(ux * 4.1 + s.seed * 1.7, uy * 4.1, t * 0.046);
        const n3 = noise3(ux * 9.3, uy * 9.3 + s.seed, t * 0.070);
        const rr = s.r * (1 + 0.20 * ro * (n1 - 0.5) + 0.085 * ro * (n2 - 0.5) + 0.020 * ro * (n3 - 0.5));
        const px = ux * rr * s.rag;
        const py = uy * rr;
        const gx = s.cx + px * cr - py * sr;
        const gy = s.cy + px * sr + py * cr;
        pts.push({
          x: gx > -1e5 && gx < 1e5 ? gx : s.cx,
          y: gy > -1e5 && gy < 1e5 ? gy : s.cy,
        });
      }
      return pts;
    }

    pathFrom(pts, i0, i1) {
      const p = new Path2D();
      p.moveTo(pts[i0].x, pts[i0].y);
      for (let i = i0 + 1; i <= i1; i++) p.lineTo(pts[i].x, pts[i].y);
      return p;
    }

    /* 把轮廓朝圆心收一点，用来做"由外向内逐层加密"的颗粒层 */
    shrinkPath(pts, cx, cy, f) {
      const p = new Path2D();
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        const x = cx + (q.x - cx) * f;
        const y = cy + (q.y - cy) * f;
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      return p;
    }

    renderWash() {
      const g = this.washCtx;
      const w = this.w;
      const h = this.h;
      const t = this.t;
      if (!g) return;

      g.setTransform(this.washCv.width / w, 0, 0, this.washCv.height / h, 0, 0);
      g.clearRect(0, 0, w, h);

      if (!this.granPat) {
        try { this.granPat = g.createPattern(this.gran, "repeat"); } catch (_) {}
      }

      /* 1 · 晕身 + 内圈积色 + 颗粒沉积 */
      for (let i = 0; i < this.washes.length; i++) {
        const s = this.washes[i];
        const pts = this.washGeom(s, t);
        const path = this.pathFrom(pts, 0, pts.length - 1);
        path.closePath();
        s._pts = pts;
        s._path = path;

        const k = s.k || 1;
        /* 水渍贴图本身已经带上了"平的色 + 斑驳 + 颗粒毛边"，
           这里只要把它按椭圆拉好、裁进轮廓就行。
           再也没有径向渐变 —— 那个东西一眼就是打光。 */
        if (!this.spr || !this.spr.length) continue;
        const spr = k > 1.6 && this.sprSolid ? this.sprSolid : this.spr[i % this.spr.length];

        const cw = s.r * s.rag * 1.02;
        const ch = s.r * 1.02;
        /* 淡晕是"很浅的一层"，浓墨核也只是"比周围深一点"。
           真正的黑由丝来承担 —— 淡晕一旦压深，整幅立刻变成脏。 */
        /* 核底下那一片只做"回潮"，几乎看不出边界 —— 它一旦显形，
           就成了一团打光似的灰晕。重量全部交给丝本身。
           小屏上再淡一档：没有大片黑去平衡，灰场就只是"脏"。 */
        const cap = (k > 1.6 ? 0.15 : 0.085) * (this.mobile ? 0.55 : 1);
        let aa = cap * (0.70 + 0.45 * s.dens) * (k > 1.6 ? 1 : Math.min(1.7, k));
        if (aa > cap) aa = cap;
        if (!(aa > 0.002)) continue;

        if (this.nowash) continue;
        g.save();
        g.clip(path);
        g.globalAlpha = aa;
        /* 每片转一个自己的角度，免得三片看上去是同一张图 */
        const rot = s.rot || 0;
        if (rot) {
          g.translate(s.cx, s.cy);
          g.rotate(rot);
          g.drawImage(spr, -cw, -ch, cw * 2, ch * 2);
          g.rotate(-rot);
          g.translate(-s.cx, -s.cy);
        } else {
          g.drawImage(spr, s.cx - cw, s.cy - ch, cw * 2, ch * 2);
        }
        g.globalAlpha = 1;
        g.restore();
      }

    }

    /* ============================================================
       湿边：一条极细的深色水痕
       ------------------------------------------------------------
       必须画在主画布上。画在 0.8 倍的晕层里再上采样，这条线会被
       糊成一根柔软的灰带，那就一点都不"湿地"了 —— 而这道细边
       恰恰是整个画面最像真墨的地方。
       ============================================================ */
    paintWetEdges(g, t) {
      g.lineJoin = "round";
      g.lineCap = "round";
      for (let i = 0; i < this.washes.length; i++) {
        const s = this.washes[i];
        if (!s._pts) continue;
        const pts = s._pts;
        const N = pts.length - 1;

        /* 先铺一道极淡的整圈：让边界"存在"，但几乎看不出是图形 */
        g.strokeStyle = ink(Math.min(0.26, 0.15 * s.edge * Math.pow(s.k || 1, 0.4)));
        g.lineWidth = 0.9;
        const bpath = this.pathFrom(pts, 0, N);
        bpath.closePath();
        g.stroke(bpath);

        /* 真正的水痕只出现在水停下来的那几段，而且断断续续。
           整圈均匀描一遍，这个晕立刻变成一个"图形" */
        for (let k = 0; k < 7; k++) {
          const v = noise3(k * 4.3 + s.seed, s.seed * 0.7, t * 0.020);
          if (v < 0.56) continue;
          const a0 = ((k / 7 + v * 0.11) % 1) * N;
          const a1 = Math.min(N, a0 + N * (0.06 + (v - 0.56) * 0.55));
          if (a1 - a0 < 2) continue;
          g.strokeStyle = ink(Math.min(0.66, (0.14 + 0.40 * (v - 0.56) / 0.44) * s.edge * Math.pow(s.k || 1, 0.4)));
          g.lineWidth = 1.0;
          g.stroke(this.pathFrom(pts, a0 | 0, a1 | 0));
        }
      }
    }

    /* ============================================================
       飞溅
       ============================================================ */
    pushDrop(x, y, r, a, age0) {
      if (x < -30 || x > this.w + 30 || y < -30 || y > this.h + 30) return;
      if (this.drops.length > 220) return;
      this.drops.push({
        x: x,
        y: y,
        r: r,
        a: a,
        age: age0 || 0,
        life: 26 + this.rnd() * 52,
        seed: this.rnd() * 100,
      });
    }

    paintDrops(g) {
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        const lt = d.age / d.life;
        if (lt >= 1) continue;
        const a = d.a * (1 - lt * lt);
        if (a < 0.01) continue;
        const n = 7;
        g.beginPath();
        for (let k = 0; k < n; k++) {
          const th = (k / n) * TAU;
          const rr = d.r * (0.62 + 0.62 * noise3(Math.cos(th) * 1.3 + d.seed, Math.sin(th) * 1.3, d.seed));
          const x = d.x + Math.cos(th) * rr;
          const y = d.y + Math.sin(th) * rr;
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        g.fillStyle = ink(Math.min(0.94, a));
        g.fill();
      }
    }

    /* ============================================================
       合成
       ============================================================ */
    render() {
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      /* 1 · 晕（软） */
      ctx.globalAlpha = 1;
      ctx.drawImage(this.washCv, 0, 0, w, h);

      /* 2 · 湿边（硬 —— 全分辨率） */
      if (!this.nowet) this.paintWetEdges(ctx, this.t);

      /* 2 · 丝的吸水外洇（低分辨率层上采样 = 天然高斯模糊）。
         只往一侧偏、只做很薄一层：两侧等宽的一圈灰带是"投影"，
         真墨的硬边旁边没有投影，只有一边洇得开。 */
      const sg = this.softCtx;
      sg.setTransform(this.softCv.width / w, 0, 0, this.softCv.height / h, 0, 0);
      sg.clearRect(0, 0, w, h);
      for (let i = 0; i < (this.nothr ? 0 : this.threads.length); i++) {
        const r = this.threads[i];
        /* 外洇只往一侧偏、只做很薄一层。宽带上这一点灰是墨被纤维吸住
           的那圈，缺了它笔就是贴上去的；多了它整幅就成雾。 */
        const ba = 0.05 * r.bleed * (r.kind === "hair" ? 0.55 : 1);
        this.paintThread(r, sg, ba, 1.02, 0, r.side * 0.6);
      }
      ctx.drawImage(this.softCv, 0, 0, w, h);

      /* 3 · 丝（硬）—— 画在独立的墨层上 */
      const ik = this.inkCtx;
      ik.setTransform(this.inkCv.width / w, 0, 0, this.inkCv.height / h, 0, 0);
      ik.clearRect(0, 0, w, h);
      if (!this.nothr) {
        for (let i = 0; i < this.threads.length; i++) {
          this.paintThread(this.threads[i], ik, 1, 1);
        }

        /* 3.5 · 干刷：把笔身里的纸色条痕擦出来。
           只在笔的轮廓之内擦，于是墨带上出现了一排排顺着笔势的
           纸色条纹 —— 湿墨与干刷的区别，全在这一步。 */
        ctx.drawImage(this.inkCv, 0, 0, w, h);
      }

      /* 4 · 飞溅 */
      this.paintDrops(ctx);

      ctx.globalAlpha = 1;
    }

    step(dt) {
      this.t += dt;
      this.frame++;

      const F = this.flow;
      F.vx = (F.fx + 0.05 * (noise3(this.t * 0.028, 3.7, 0.9) - 0.5) * 2) * this.w;
      F.vy = (F.fy + 0.05 * (noise3(this.t * 0.025, 9.3, 4.1) - 0.5) * 2) * this.h;

      /* 晕的蠕动：轮廓中心与半径各自被噪声改写，永不复现 */
      for (let i = 0; i < this.washes.length; i++) {
        const s = this.washes[i];
        s.cx = s.cx0 + (noise3(this.t * s.wf, s.seed, 1.1) - 0.5) * 2 * s.wl;
        s.cy = s.cy0 + (noise3(this.t * s.wf * 0.87, s.seed + 5.5, 3.3) - 0.5) * 2 * s.wl;
        s.r = s.r0 * (0.90 + 0.20 * noise3(this.t * s.wf * 0.72, s.seed + 9.1, 6.2));
      }

      for (let i = this.threads.length - 1; i >= 0; i--) {
        const r = this.threads[i];
        r.age += dt;
        /* 涡心各走各的：所有笔绕着同一个点转，就会转成同心圆 */
        const T = r.F;
        T.vx = r.fx0 + (noise3(this.t * 0.026, r.seed, 0.9) - 0.5) * 0.1 * this.w;
        T.vy = r.fy0 + (noise3(this.t * 0.023, r.seed + 3.3, 4.1) - 0.5) * 0.1 * this.h;
        this.updateThread(r, dt);
        if (r.age > r.life || this.offscreen(r)) this.threads.splice(i, 1);
      }
      this.ensureThreads();

      for (let i = this.drops.length - 1; i >= 0; i--) {
        this.drops[i].age += dt;
        if (this.drops[i].age >= this.drops[i].life) this.drops.splice(i, 1);
      }

      if (this.t - this.lastWash > 0.30) {
        this.lastWash = this.t;
        this.renderWash();
      }
      if (!this.noRender) this.render();
    }

    offscreen(r) {
      const P = r.pts;
      const m = 220;
      for (let i = 0; i < P.length; i += 3) {
        const p = P[i];
        if (p.x > -m && p.x < this.w + m && p.y > -m && p.y < this.h + m) return false;
      }
      return true;
    }

    /* ---------- 文字识别墨迹 → 自动描边 ---------- */
    haloTick(now) {
      if (now - this.lastHalo < 200) return;
      this.lastHalo = now;

      this.grid.fill(0);
      for (let i = 0; i < this.threads.length; i++) {
        const r = this.threads[i];
        const P = r.pts;
        const rad = Math.max(6, r.hw * 2.4);
        for (let j = 0; j < P.length; j += 2) {
          this.gridAdd(P[j].x, P[j].y, rad, 0.5);
        }
      }
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        if (d.r > 1.6) this.gridAdd(d.x, d.y, d.r * 1.4, 0.5 * (1 - d.age / d.life));
      }

      if (this.debug) {
        let peak = 0;
        let cover = 0;
        let sampled = 0;
        let solid = 0;
        try {
          const px = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
          for (let i = 3; i < px.length; i += 16) {
            sampled++;
            if (px[i] > peak) peak = px[i];
            if (px[i] > 40) cover++;
            if (px[i] > 170) solid++;
          }
        } catch (_) {}

        let ns = 0, nh = 0, nt = 0, pts = 0;
        let dir = "";
        for (let i = 0; i < this.threads.length; i++) {
          const r = this.threads[i];
          if (r.kind === "spine") ns++;
          else if (r.kind === "hair") nh++;
          else nt++;
          pts += r.pts.length;
          const P0 = r.pts[0];
          const P1 = r.pts[r.pts.length - 1];
          dir += (dir ? " " : "") + r.kind.charAt(0) +
            Math.round(Math.atan2(r.axy, r.axx) * 57.3) + "/" +
            Math.round(Math.atan2(P1.y - P0.y, P1.x - P0.x) * 57.3) + "/" +
            Math.round(r.hw);
        }
        this.canvas.setAttribute(
          "data-ink",
          "t=" + this.t.toFixed(1) +
          " thr=" + this.threads.length + " s/h/t=" + ns + "/" + nh + "/" + nt +
          " wash=" + this.washes.length +
          " drop=" + this.drops.length +
          " pts=" + pts +
          " fam=" + Math.round((this.famAng || 0) * 57.3) +
          " dir=" + dir +
          " ft=" + (this._ft ? this._ft.toFixed(2) : "-") +
          " rt=" + (this._rt ? this._rt.toFixed(2) : "-") +
          " cover=" + (sampled ? (cover / sampled * 100).toFixed(2) + "%" : "-") +
          " solid=" + (sampled ? (solid / sampled * 100).toFixed(2) + "%" : "-") +
          " peakA=" + (peak / 255).toFixed(3)
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
        const on = cover > 0.13;
        if (on !== it.on) {
          it.on = on;
          it.el.classList.toggle("on-ink", on);
        }
      }
    }

    warp(seconds) {
      const n = Math.round(Math.min(240, seconds) * 30);
      const was = this.noRender;
      this.noRender = true;
      for (let i = 0; i < n; i++) this.step(1 / 30);
      this.noRender = was;
      this.renderWash();
      this.render();
      this.haloTick(1e7);
    }

    loop(now) {
      if (this.frameCap && this.frame >= this.frameCap) {
        this.raf = 0;
        return;
      }
      this.raf = window.requestAnimationFrame((t) => this.loop(t));
      if (this.last === 0) this.last = now;
      let delta = (now - this.last) / 1000;
      this.last = now;
      if (delta > 0.4) delta = 0.4;

      const p0 = performance.now();
      const STEP = 1 / 30;
      this.acc += delta;
      let steps = 0;
      while (this.acc >= STEP && steps < 3) {
        this.acc -= STEP;
        this.step(STEP);
        steps++;
      }
      if (steps) this.haloTick(now);
      this._ft = (this._ft || 0) * 0.88 + (performance.now() - p0) * 0.12;
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

    prime() {
      this.collectTexts();
      this.compose();
      this.ensureThreads();
      this.warp(3.0);
    }
  }

  /* fbm 的安全版：mkPt 里会用 */
  function fbmSafe(x, y, z) {
    return 0.646 * noise3(x, y, z) + 0.354 * noise3(x * 2.13 + 31.4, y * 2.13 + 17.7, z * 2.13 + 5.9);
  }

  /* ============================================================
     页面级装配
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
      const f = new InkField(hosts[i]);
      f.prime();
      fields.push(f);
      if (!reduce) f.start();
    }

    bindRevealObserver();

    /* 调试：?inkwarp=N 快进 N 秒（无头渲染没有真实时钟） */
    const warp = (window.location.search.match(/inkwarp=([\d.]+)/) || [])[1];
    if (warp) {
      const n = parseFloat(warp);
      for (let i = 0; i < fields.length; i++) fields[i].warp(n);
    }

    /* 调试：?inkbench=N 干净地跑 N 步并报告单帧耗时（无头环境下没有真实时钟） */
    const bench = (window.location.search.match(/inkbench=(\d+)/) || [])[1];
    if (bench) {
      const n = parseInt(bench, 10);
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        /* 必须先停 rAF：否则虚拟时间预算会把动画一直跑下去，基准数据也被覆盖 */
        f.stop();
        const m = Math.min(n, 8);
        f.noRender = true;
        const t0 = performance.now();
        for (let k = 0; k < n; k++) f.step(1 / 30);
        const t1 = performance.now();
        f.noRender = false;
        for (let k = 0; k < m; k++) f.render();
        const t2 = performance.now();
        f._ft = (t1 - t0) / n;
        f._rt = (t2 - t1) / m;
        f.haloTick(1e7);
        f.haloTick(2e7);
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

    window.setInterval(function () {
      for (let i = 0; i < fields.length; i++) fields[i].collectTexts();
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

  /* 新区块进入视口时，从它边上引一道墨出来 */
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
            if (f.threads.length > 14) break;
            f.spawn(f.rnd() < 0.5 ? "hair" : "spine");
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

  /* ---------- 滚动显影 ---------- */
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

  function initParallax() {}

  window.InkEngine = {
    mountAll: mountAll,
    initReveal: initReveal,
    initParallax: initParallax,
    _fields: fields,
  };
})();
