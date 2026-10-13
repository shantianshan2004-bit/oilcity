/* ============================================================
   油城往事 · 活墨引擎（Living Ink）
   ------------------------------------------------------------
   墨不再是"画"上去的图形，而是"长"出来的：
   每一滴墨是一个粒子，被流场推着走，靠毛细作用长大，
   边走边在纸上沉积颜料，将干时把颜料推向边缘留下深色轮廓，
   最后慢慢淡去。每次打开页面，种子不同，墨的走向都不一样。

   六条物理规则（都只用便宜运算，保证 30fps 稳）
     1. 流场      标量势场的旋度 —— 数学上无散度，墨只被推着走，
                  不会在某些地方堆积、另一些地方变空
     2. 动量      速度受流场加速，再乘阻尼 —— 有惯性、会拐弯、会停
     3. 扩散      半径按 √t 增长（毛细扩散方程的解）
     4. 沉积      每帧按当前半径把墨刷到纸上，重叠处更浓
     5. 咖啡环    墨将干时颜料向边缘迁移 —— 真实水渍的深色轮廓
     6. 干燥      全局极缓褪色，旧墨随时间淡去，纸面永不淤死

   与上一版的关键区别
     上一版把 transform 动画加在挂了 SVG 滤镜的 <g> 上，
     feTurbulence 被迫逐帧重算噪声场，于是频闪抽搐。
     这一版没有任何滤镜参与动画：每帧只 drawImage 几十个预渲染
     的小色块，绘制量与墨滴数成正比，与画布面积无关。
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 纸与墨 ---------- */
  const INK  = { r: 23,  g: 23, b: 21 };   /* --ink    浓墨 */
  const SEAL = { r: 135, g: 61, b: 50 };   /* --accent 朱砂 */

  const rgb = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
     旋度场天然无散度，等价于不可压缩流：墨不会凭空聚成团。
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
    let dx = (a - b) / (2 * GH);      /* ∂φ/∂y */
    let dy = -(c - d) / (2 * GH);     /* -∂φ/∂x */
    const m = Math.sqrt(dx * dx + dy * dy) || 1;
    out[0] = dx / m;
    out[1] = dy / m;
    return out;
  }

  /* ============================================================
     2. 墨点贴图
     ------------------------------------------------------------
     每帧给几十滴墨各建一个径向渐变太浪费，改成预渲染几档贴图，
     之后只 drawImage 缩放 —— 这是整帧唯一的绘制开销。
     两种形态：core 是湿墨的核，ring 是干后颜料聚到边缘的咖啡环。
     ============================================================ */
  const SPRITE_SIZES = [12, 20, 32, 52, 84, 136, 220];
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
            grad.addColorStop(0.0, rgb(col, 0.04));
            grad.addColorStop(0.52, rgb(col, 0.26));
            grad.addColorStop(0.86, rgb(col, 0.58));
            grad.addColorStop(0.97, rgb(col, 0.14));
            grad.addColorStop(1.0, rgb(col, 0));
          } else {
            grad.addColorStop(0.0, rgb(col, 0.5));
            grad.addColorStop(0.42, rgb(col, 0.38));
            grad.addColorStop(0.74, rgb(col, 0.19));
            grad.addColorStop(0.93, rgb(col, 0.05));
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
     3. 墨滴
     ============================================================ */
  function makeDrop(x, y, rnd, opt) {
    const ang = rnd() * Math.PI * 2;
    /* 落笔是一记快的冲量，随即被纸的阻力刹住 ——
       这一下冲出来的细丝就是枯笔的飞白 */
    const spd = 26 + rnd() * 82;
    return {
      x: x,
      y: y,
      px: x,
      py: y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      r0: 14 + rnd() * 26,
      r: 0,
      age: 0,
      life: opt.life * (0.72 + rnd() * 0.66),
      seal: rnd() < opt.sealRate,
      speedK: 0.55 + rnd() * 0.95,
      /* 颜料是有限的：随移动洒出，洒完这一滴就不再出墨。
         停在原地就聚成浓点，被流场带走就摊成淡晕 ——
         浓淡由"走得多快"自然决定，不需要人为调。 */
      deposit: opt.deposit * (0.75 + rnd() * 0.6),
      cap: 3.2 + rnd() * 2.6,
      spent: 0,
      /* 每滴墨带自己的流场参数 —— 几十滴走几十条不同的路，
         这是"每次呈现都不同"的第二层随机（第一层是种子）。 */
      k: {
        f1: 0.0015 + rnd() * 0.0017,
        f2: 0.0017 + rnd() * 0.0019,
        f3: 0.0010 + rnd() * 0.0013,
        f4: 0.0012 + rnd() * 0.0015,
        s1: 0.048 + rnd() * 0.062,
        s2: 0.040 + rnd() * 0.052,
        s3: 0.030 + rnd() * 0.050,
        s4: 0.034 + rnd() * 0.052,
      },
    };
  }

  /* ============================================================
     4. 一层墨（一个页面一层）
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

      /* 覆盖度栅格：比逐滴做几何求交便宜，且能记住"已经沉积的墨" */
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
      this.maxDrops = mobile ? 10 : clamp(Math.round(area / 75000), 12, 18);
      this.opt = {
        life: 22,
        /* 每帧出墨量。颜料总量由 cap 封顶，所以墨池的浓度有上界：
           实测 0.035 配 3.2~5.8 的 cap，墨心约 3~5 秒长到 0.45~0.55 就停。
           浓淡只调这一处（手机屏小、墨要更轻，给 0.028）。 */
        deposit: mobile ? 0.028 : 0.035,
        sealRate: 0.07,
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
          seen: false,
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
      if (p < 0.42) x = a.left - 12 - R() * 66;
      else if (p < 0.72) x = a.left + a.w + 12 + R() * 76;
      else x = a.left + a.w * (0.1 + R() * 0.8);
      const y = top + a.h * (0.1 + R() * 0.95) + (R() - 0.5) * 34;
      return { x: clamp(x, -40, this.w + 40), y: clamp(y, -40, this.h + 40) };
    }

    release(n) {
      if (!this.anchors.length) this.collectAnchors();
      const list = this.anchors;
      for (let i = 0; i < n; i++) {
        if (this.drops.length >= this.maxDrops) return;
        let x;
        let y;
        if (list.length) {
          /* 优先挑视口内的锚点，墨才看得出是从界面上长出来的 */
          const sy = window.scrollY || window.pageYOffset || 0;
          let pick = null;
          for (let tryN = 0; tryN < 6; tryN++) {
            const cand = list[(this.rnd() * list.length) | 0];
            const vt = cand.top - sy;
            if (vt > -80 && vt < this.h + 80) {
              pick = cand;
              break;
            }
          }
          if (!pick) pick = list[(this.rnd() * list.length) | 0];
          const pt = this.anchorPoint(pick);
          x = pt.x;
          y = pt.y;
        } else {
          x = this.rnd() * this.w;
          y = this.rnd() * this.h;
        }
        this.drops.push(makeDrop(x, y, this.rnd, this.opt));
      }
    }

    /* ---------- 单步 ---------- */
    step(dt) {
      const ctx = this.ctx;
      /* 阻尼很大：落笔那一记冲量很快被纸吃掉，
         之后只剩流场的极缓推力 —— 墨停在界面元素附近成池，不漫游 */
      const drag = Math.pow(0.1, dt);
      const drops = this.drops;

      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;

        /* 3. 扩散：r ∝ √t（毛细扩散的解） */
        d.r = d.r0 * Math.sqrt(1 + d.age / 5);

        /* 1 + 2. 流场推力 → 加速度；再乘阻尼 → 有惯性、会停 */
        flowAt(d.x, d.y, this.t, d.k, _v);
        const acc = d.speedK * 4;
        d.vx += _v[0] * acc * dt;
        d.vy += _v[1] * acc * dt;
        d.vy += this.wind * dt;          /* 滚动带来的风 */
        d.vx *= drag;
        d.vy *= drag;

        d.px = d.x;
        d.py = d.y;
        d.x += d.vx * dt;
        d.y += d.vy * dt;

        const lifeT = d.age / d.life;
        const fade = 1 - lifeT;
        if (fade <= 0) {
          drops.splice(i, 1);
          continue;
        }

        /* 4 + 5. 沉积。
           颜料有限（spent 封顶），纸面饱和再打个小折 ——
           墨池长到合适浓度就自然停住，既不淤黑也不淡得看不见。 */
        const damp = 1 - this.gridAt(d.x, d.y) * 0.35;
        const room = d.cap - d.spent;
        if (room > 0.002 && damp > 0.05) {
          const p = Math.min(d.deposit * damp * (1 - lifeT * 0.35), room);
          d.spent += p;
          const ringness = clamp((lifeT - 0.34) / 0.42, 0, 1);
          const key = d.seal ? "seal" : "ink";
          const size = d.r * 2;
          const dx = d.x - d.r;
          const dy = d.y - d.r;

          if (ringness < 1) {
            ctx.globalAlpha = p * (1 - ringness);
            ctx.drawImage(spriteFor(key, 0, d.r), dx, dy, size, size);
          }
          if (ringness > 0) {
            ctx.globalAlpha = p * ringness;
            ctx.drawImage(spriteFor(key, 1, d.r), dx, dy, size, size);
          }
          ctx.globalAlpha = 1;
          this.gridAdd(d.x, d.y, d.r * 0.8, p * 1.2);

          /* 飞白：落笔那一记冲量拖出的细丝。只在墨还湿、走得还快时
             出现，且不受饱和限制 —— 枯笔是划破纸面的，不是洇进去的。 */
          const sp = Math.sqrt(
            (d.x - d.px) * (d.x - d.px) + (d.y - d.py) * (d.y - d.py)
          ) / Math.max(dt, 1e-4);
          if (sp > 40 && lifeT < 0.5) {
            ctx.strokeStyle = d.seal ? rgb(SEAL, 0.03) : rgb(INK, 0.03);
            ctx.lineWidth = Math.max(0.5, d.r * 0.16);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(d.px, d.py);
            ctx.lineTo(d.x, d.y);
            ctx.stroke();
          }
        }
      }

      this.t += dt;
      this.frame++;

      /* 6. 干燥：整幅极缓褪色，旧墨随时间淡去 */
      if (this.frame % 26 === 0) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,0.008)";
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.globalCompositeOperation = "source-over";
        const g = this.grid;
        for (let i = 0; i < g.length; i++) g[i] *= 0.992;
      }

      /* 持续落墨：每 1～3 秒一滴，墨一直"在长"，但不喧宾夺主 */
      this.releaseAcc += dt;
      if (this.releaseAcc >= 1.1 + this.rnd() * 2.2) {
        this.releaseAcc = 0;
        this.release(1);
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
        let info = "";
        try {
          const px = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
          for (let i = 3; i < px.length; i += 16) {
            if (px[i] > peak) peak = px[i];
          }
        } catch (_) {}
        info = " peakA=" + (peak / 255).toFixed(3);
        if (this.drops.length) {
          const d0 = this.drops[0];
          info +=
            " r=" + d0.r.toFixed(1) +
            " spent=" + d0.spent.toFixed(2) +
            " cap=" + d0.cap.toFixed(2);
        }
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
        const on = cover > 0.1;
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

    /* ---------- 开局：先在视口里落几滴，别让纸空着 ---------- */
    prime() {
      this.collectAnchors();
      this.collectTexts();
      this.release(Math.min(this.maxDrops, Math.round(this.maxDrops * 0.5)));
      /* 空跑 1.2 秒 —— 一上来就已经"洇开"了，不是从零开始 */
      for (let i = 0; i < 36; i++) this.step(1 / 30);
    }
  }

  /* ============================================================
     5. 页面级装配
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

  /* 新的界面区块进入视口时补一滴墨 —— 墨跟着界面出现 */
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
            if (f.drops.length >= f.maxDrops) break;
            f.drops.push(
              makeDrop(
                r.left + r.width * (0.15 + f.rnd() * 0.7),
                Math.min(f.h - 20, Math.max(20, r.top + r.height * (0.2 + f.rnd() * 0.5))),
                f.rnd,
                f.opt
              )
            );
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
     6. 滚动显影（保持不变）
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
     这个函数保留只为兼容各页原有的调用，不再移动墨层
     （移动带滤镜的墨层正是上一版闪烁的根源）。 */
  function initParallax() {}

  window.InkEngine = {
    mountAll: mountAll,
    initReveal: initReveal,
    initParallax: initParallax,
    _fields: fields,
  };
})();
