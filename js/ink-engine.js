/* ============================================================
   油城往事 · 水墨笔触生成引擎
   ------------------------------------------------------------
   依据两张参考图提炼出的两套笔法：

   A. 放射扇笔（dry-fan）
      黑色干笔自一侧向另一侧放射铺开，呈扇形层叠，
      边缘不规则，笔内留飞白（未着墨的纸缝），
      尾部有摩擦与断口。

   B. 压顶涡笔（press-whorl）
      浓墨自上方压入，向下呈弧形 / 涡状漫开，
      墨色由浓入淡，自然过渡，下半留大片空白。

   全部使用 SVG 滤镜：
     feTurbulence  造不规则骨相与飞白
     feDisplacementMap 让笔路被纸纤维扰动
     feGaussianBlur    做边缘的墨晕
   不使用规则圆形、不使用标准线性渐变。
   ============================================================ */

const NS = "http://www.w3.org/2000/svg";

/* —— 确定性随机：同一个 seed 得到同一笔墨，保证可复现 —— */
function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}
const rnd = makeRandom;

/* —— 唯一的滤镜 id 计数 —— */
let uid = 0;
const nextId = (p) => `${p}-${(++uid).toString(36)}`;

/* ============================================================
   滤镜库
   ============================================================ */

/** 纸纤维扰动：让笔触边缘毛糙、带摩擦 */
function filterDisplace(id, scale = 22, freq = 0.022, octaves = 4) {
  return `
    <filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"
            filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${freq}"
                    numOctaves="${octaves}" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise"
                         scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
}

/** 飞白：用高频噪声在笔内掏空细缝 */
function filterDryBrush(id, scale = 14, freq = 0.09) {
  return `
    <filter id="${id}" x="-25%" y="-25%" width="150%" height="150%"
            filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${freq}"
                    numOctaves="5" seed="19" result="grain"/>
      <feDisplacementMap in="SourceGraphic" in2="grain"
                         scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feComponentTransfer in="rough" result="cut">
        <feFuncA type="table" tableValues="0 0 0.15 0.72 1 1"/>
      </feComponentTransfer>
      <feGaussianBlur in="cut" stdDeviation="0.55"/>
    </filter>`;
}

/** 墨晕：向外极缓地化开 */
function filterBleed(id, blur = 3.2) {
  return `
    <filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"
            filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>`;
}

/* ============================================================
   A. 放射扇笔
   ------------------------------------------------------------
   从枢轴点（cx, cy）向角度区间 [a0, a1] 放射，
   生成 N 条长度递变的扇形笔路，每条笔路自身带有粗细与飞白。
   ============================================================ */
function dryFan(opts = {}) {
  const {
    cx = 0, cy = 0,
    r0 = 40, r1 = 380,
    a0 = -70, a1 = 66,
    blades = 26,
    seed = 11,
    spread = 22,      // 相邻笔路的角向抖动（度）
    weight = 1.5,     // 基础粗细
    taper = 0.72,     // 尖端收束
    opacity = 0.9,
    inner = true,     // 是否保留内圈的浓墨核心
  } = opts;

  const R = rnd(seed);
  const g = [];
  const rad = (d) => (d * Math.PI) / 180;

  /* 内圈浓墨核：不是圆，是被扰动过的团块 */
  if (inner) {
    const pts = [];
    const spokes = 18;
    for (let i = 0; i <= spokes; i++) {
      const a = rad((360 / spokes) * i);
      const rr = r0 * (0.62 + R() * 0.62);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      const mx = (px + x) / 2;
      const my = (py + y) / 2;
      d += ` Q ${px.toFixed(2)} ${py.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
    d += " Z";
    g.push(
      `<path d="${d}" fill="currentColor" opacity="${(opacity * 0.95).toFixed(3)}"/>`
    );
  }

  /* 扇形放射笔路 */
  const span = a1 - a0;
  for (let i = 0; i < blades; i++) {
    const t = blades === 1 ? 0.5 : i / (blades - 1);
    let a = a0 + span * t + (R() - 0.5) * spread;

    /* 长度：中段最长，两端收短 —— 形成扇形轮廓 */
    const bell = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    let len = r0 + (r1 - r0) * (0.42 + 0.58 * bell) * (0.72 + R() * 0.56);

    /* 起点也抖动，避免所有笔都从同一点出发 */
    const sr = r0 * (0.52 + R() * 0.42);
    const sa = rad(a + (R() - 0.5) * 6);
    const sx = cx + Math.cos(sa) * sr;
    const sy = cy + Math.sin(sa) * sr;

    const ea = rad(a + (R() - 0.5) * 9);
    const ex = cx + Math.cos(ea) * (sr + len);
    const ey = cy + Math.sin(ea) * (sr + len);

    /* 控制点：让笔路微微弓起，不是直线 */
    const bow = (R() - 0.5) * 0.42;
    const mx = (sx + ex) / 2 + Math.cos(rad(a + 90)) * len * bow;
    const my = (sy + ey) / 2 + Math.sin(rad(a + 90)) * len * bow;

    const w = weight * (0.62 + R() * 0.96);

    /* 飞白：一条笔路其实由 2–4 段断续墨组成 */
    const segs = 2 + Math.floor(R() * 3);
    let cursor = 0;
    for (let s = 0; s < segs; s++) {
      const segFrac = (1 - cursor) * (0.45 + R() * 0.55);
      const t0 = cursor;
      const t1 = Math.min(1, cursor + segFrac);
      cursor = t1;

      const p = (tt) => {
        const u = 1 - tt;
        return [
          u * u * sx + 2 * u * tt * mx + tt * tt * ex,
          u * u * sy + 2 * u * tt * my + tt * tt * ey,
        ];
      };
      const [x0, y0] = p(t0);
      const [x1, y1] = p(t1);

      /* 尖端收束 */
      const w0 = w * (1 - t0 * taper * 0.55) * (0.66 + 0.34 * (1 - t0));
      const w1 = w * (1 - t1 * taper);

      const op = opacity * (1 - t1 * 0.52) * (s === 0 ? 1 : 0.62 + R() * 0.38);

      g.push(
        `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)}" ` +
          `stroke="currentColor" stroke-width="${w0.toFixed(2)}" ` +
          `stroke-linecap="round" opacity="${op.toFixed(3)}"/>`
      );
      /* 外侧稍粗的一段叠压，营造墨的厚度 */
      if (s > 0 && R() > 0.55) {
        g.push(
          `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)}" ` +
            `stroke="currentColor" stroke-width="${(w1 * 1.9).toFixed(2)}" ` +
            `stroke-linecap="round" opacity="${(op * 0.34).toFixed(3)}"/>`
        );
      }
    }
  }
  return g.join("\n");
}

/* ============================================================
   B. 压顶涡笔
   ------------------------------------------------------------
   浓墨自上方压入，沿弧线向下漫开，墨色由浓转淡，
   末端化成散点与细丝，下半留白。
   ============================================================ */
function pressWhorl(opts = {}) {
  const {
    x = 0, yTop = -40,          // 顶部起始
    width = 640,                // 压顶墨的横向跨度
    depth = 520,                // 向下蔓延的深度
    arcs = 16,                  // 弧线数
    seed = 23,
    thick = 6,                  // 顶部墨的厚度
    sx = 1.0,                   // 横向缩放
    opacity = 0.94,
    disperse = true,            // 末端是否散开
  } = opts;

  const R = rnd(seed);
  const g = [];

  /* 压顶墨块：顶部厚、边缘不规则 */
  const topPts = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x - width / 2 + width * t;
    const py = yTop + (R() - 0.5) * 18 + Math.sin(t * Math.PI) * 10;
    topPts.push([px, py]);
  }
  let dTop = `M ${topPts[0][0].toFixed(1)} ${topPts[0][1].toFixed(1)}`;
  for (let i = 1; i < topPts.length; i++) {
    const [px, py] = topPts[i - 1];
    const [qx, qy] = topPts[i];
    dTop += ` Q ${px.toFixed(1)} ${py.toFixed(1)} ${((px + qx) / 2).toFixed(1)} ${((py + qy) / 2).toFixed(1)}`;
  }
  /* 下沿：参差垂落 */
  const lower = [];
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const px = x - width / 2 + width * t;
    const py = yTop + thick * (0.8 + R() * 1.6) + Math.sin(t * Math.PI) * thick * 2.4;
    lower.push([px, py]);
  }
  for (const [px, py] of lower) dTop += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
  dTop += " Z";
  g.push(`<path d="${dTop}" fill="currentColor" opacity="${opacity.toFixed(3)}"/>`);

  /* 向下弧线：每条弧自上方某一处垂下，弧形张开 */
  for (let i = 0; i < arcs; i++) {
    const t = arcs === 1 ? 0.5 : i / (arcs - 1);
    const ax = x - (width / 2) * 0.86 + width * 0.86 * t + (R() - 0.5) * width * 0.06;
    const ay = yTop + thick * 0.8;

    /* 弧的横向摆幅：越往两侧，弧越向外张开 */
    const dir = t < 0.5 ? -1 : 1;
    const outness = Math.abs(t - 0.5) * 2;
    const swing = dir * (40 + outness * 150) * (0.5 + R() * 0.9) * sx;

    const dep = depth * (0.5 + R() * 0.72);
    const ex = ax + swing;
    const ey = ay + dep;

    const c1x = ax + swing * 0.18;
    const c1y = ay + dep * 0.42;
    const c2x = ax + swing * 0.82;
    const c2y = ay + dep * 0.8;

    /* 用多段折线近似，每段透明度递减 —— 墨由浓入淡 */
    const N = 9;
    let prev = [ax, ay];
    for (let k = 1; k <= N; k++) {
      const tt = k / N;
      const u = 1 - tt;
      const px =
        u * u * u * ax + 3 * u * u * tt * c1x + 3 * u * tt * tt * c2x + tt * tt * tt * ex;
      const py =
        u * u * u * ay + 3 * u * u * tt * c1y + 3 * u * tt * tt * c2y + tt * tt * tt * ey;

      const w = thick * (0.9 - tt * 0.72) * (0.7 + R() * 0.6);
      const op = opacity * (1 - tt) ** 1.35 * (0.55 + R() * 0.45);

      if (w > 0.16 && op > 0.012) {
        g.push(
          `<path d="M ${prev[0].toFixed(1)} ${prev[1].toFixed(1)} L ${px.toFixed(1)} ${py.toFixed(1)}" ` +
            `stroke="currentColor" stroke-width="${w.toFixed(2)}" ` +
            `stroke-linecap="round" opacity="${op.toFixed(3)}"/>`
        );
      }
      /* 末端散开：飞散的墨点与被纸吸住的细丝 */
      if (disperse && tt > 0.62 && R() > 0.42) {
        const dx = px + (R() - 0.5) * 70;
        const dy = py + (R() - 0.5) * 46;
        const rr = 0.5 + R() * 2.1;
        g.push(
          `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${rr.toFixed(2)}" ` +
            `fill="currentColor" opacity="${(op * 0.62).toFixed(3)}"/>`
        );
      }
      if (disperse && tt > 0.74 && R() > 0.62) {
        const sx0 = px, sy0 = py;
        const sx1 = px + (R() - 0.5) * 130;
        const sy1 = py + R() * 60;
        g.push(
          `<path d="M ${sx0.toFixed(1)} ${sy0.toFixed(1)} Q ${((sx0 + sx1) / 2).toFixed(1)} ${(sy0 + 8).toFixed(1)} ${sx1.toFixed(1)} ${sy1.toFixed(1)}" ` +
            `stroke="currentColor" stroke-width="0.5" fill="none" opacity="${(op * 0.4).toFixed(3)}"/>`
        );
      }
      prev = [px, py];
    }
  }
  return g.join("\n");
}

/* ============================================================
   C. 一抹横扫（用于分隔与强调，替代线条）
   ============================================================ */
function sweep(opts = {}) {
  const { x = 0, y = 0, len = 420, seed = 41, thick = 3, opacity = 0.8, angle = -3 } = opts;
  const R = rnd(seed);
  const g = [];
  const rad = (angle * Math.PI) / 180;
  const ex = x + Math.cos(rad) * len;
  const ey = y + Math.sin(rad) * len;
  const segs = 4 + Math.floor(R() * 4);
  let cursor = 0;
  for (let s = 0; s < segs; s++) {
    const t0 = cursor;
    const t1 = Math.min(1, cursor + (1 - cursor) * (0.4 + R() * 0.55));
    cursor = t1;
    const x0 = x + (ex - x) * t0, y0 = y + (ey - y) * t0;
    const x1 = x + (ex - x) * t1, y1 = y + (ey - y) * t1;
    const w = thick * (1 - t1 * 0.6) * (0.7 + R() * 0.7);
    g.push(
      `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}" ` +
        `stroke="currentColor" stroke-width="${w.toFixed(2)}" stroke-linecap="round" ` +
        `opacity="${(opacity * (1 - t1 * 0.35)).toFixed(3)}"/>`
    );
  }
  return g.join("\n");
}

/* ============================================================
   组装：把笔路包进带滤镜的 <svg>
   ------------------------------------------------------------
   【动效铁律】动画只加在 <svg> 根元素上。

   <svg> 根是 HTML 层元素，被提升为合成层后，浏览器把滤镜结果
   栅格化成一张纹理；之后每帧只是移动/旋转这张纹理，不重算滤镜。

   反面做法（曾导致"动画频闪抽搐"）：把 transform 动画加在挂了
   filter 的 <g> 上。feTurbulence 是分形噪声，滤镜必须随每帧的
   变换重新生成噪声场、重做位移映射，笔触轮廓于是剧烈抖动；
   若再叠加 feTurbulence 的 baseFrequency 动画，等于每帧换一套
   噪声，整幅墨会抽搐到无法观看。

   两个根元素：
     ink-svg-a  干笔飞白 + 纸纤维扰动 —— 墨的"形"
     ink-svg-b  墨晕 —— 墨的"洇"，单独漂移并做浓淡呼吸
   ============================================================ */
function compose(body, { viewBox, cls = "", color = "var(--ink)", extraFilters = [] }) {
  const fid = nextId("fx");
  const dryId = nextId("dry");
  const bleedId = nextId("bl");

  const open = (klass) =>
    `<svg class="${`${cls} ${klass}`.trim()}" viewBox="${viewBox}" ` +
    `preserveAspectRatio="xMidYMid slice" xmlns="${NS}" ` +
    `aria-hidden="true" focusable="false">`;

  return `
${open("ink-svg ink-svg-a")}
  <defs>
    ${filterDryBrush(dryId, 12, 0.085)}
    ${filterDisplace(fid, 20, 0.02, 4)}
    ${extraFilters.join("\n")}
  </defs>
  <g style="color:${color}" filter="url(#${dryId})">${body}</g>
  <g style="color:${color}" filter="url(#${fid})" opacity="0.55">${body}</g>
</svg>
${open("ink-svg ink-svg-b")}
  <defs>
    ${filterBleed(bleedId, 3.4)}
  </defs>
  <g style="color:${color}" filter="url(#${bleedId})" opacity="0.22">${body}</g>
</svg>`;
}

/* ============================================================
   预设：首页 / 章节 / 人物 / 音乐 / 共创
   ============================================================ */

const PRESETS = {
  /* —— 首页：左侧干笔放射 + 顶部压顶涡墨 —— */
  home(stage) {
    const fan = dryFan({
      cx: 214, cy: 372, r0: 52, r1: 396,
      a0: -104, a1: 6, blades: 30, seed: 907,
      spread: 17, weight: 1.6, opacity: 0.93,
    });
    const fan2 = dryFan({
      cx: 168, cy: 430, r0: 30, r1: 210,
      a0: -88, a1: 22, blades: 16, seed: 331,
      spread: 26, weight: 1.1, opacity: 0.5,
    });
    const whorl = pressWhorl({
      x: 792, yTop: -70, width: 820, depth: 560,
      arcs: 20, seed: 55, thick: 8, opacity: 0.96,
    });
    const base = compose(fan + fan2 + whorl, {
      viewBox: "0 0 1000 780",
      cls: "ink-layer",
    });
    return { svg: base, layers: { fan, fan2, whorl } };
  },

  /* —— 章节页：右上压顶，左下余白 —— */
  chapters() {
    return compose(
      pressWhorl({ x: 806, yTop: -60, width: 560, depth: 400, arcs: 13, seed: 71, thick: 6 }),
      { viewBox: "0 0 1000 620", cls: "ink-layer" }
    );
  },

  /* —— 人物页：右侧一束极淡的放射，作为背景呼吸 —— */
  characters() {
    return compose(
      dryFan({
        cx: 946, cy: 500, r0: 26, r1: 330,
        a0: 152, a1: 252, blades: 20, seed: 613,
        spread: 20, weight: 1.05, opacity: 0.34,
      }),
      { viewBox: "0 0 1000 700", cls: "ink-layer" }
    );
  },

  /* —— 留声机：整片压顶浓墨，最暗的一页 —— */
  music() {
    const whorl = pressWhorl({
      x: 500, yTop: -130, width: 1180, depth: 720,
      arcs: 26, seed: 883, thick: 14, opacity: 0.99,
    });
    return compose(whorl, {
      viewBox: "0 0 1000 900",
      cls: "ink-layer",
      color: "var(--ink)",
    });
  },

  /* —— 共创：两笔交错的横扫，像两份笔迹叠在一张纸上 —— */
  coCreate() {
    return compose(
      sweep({ x: 60, y: 150, len: 620, seed: 17, thick: 4, opacity: 0.72, angle: -6 }) +
      sweep({ x: 300, y: 260, len: 560, seed: 29, thick: 2.6, opacity: 0.42, angle: 4 }),
      { viewBox: "0 0 1000 420", cls: "ink-layer" }
    );
  },

  /* —— 内页页眉：一小抹横扫 —— */
  mark() {
    return compose(
      sweep({ x: 0, y: 14, len: 300, seed: 53, thick: 4, opacity: 0.8, angle: -2 }),
      { viewBox: "0 0 300 30", cls: "ink-mark" }
    );
  },
};

/* ============================================================
   视差：滚动时墨层轻微位移（极克制）
   ============================================================ */
function initParallax() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layers = Array.from(document.querySelectorAll("[data-parallax]"));
  if (!layers.length) return;

  let raf = null;
  const apply = () => {
    raf = null;
    const vh = window.innerHeight;
    for (const el of layers) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) continue;
      const k = parseFloat(el.dataset.parallax) || 0.06;
      const mid = rect.top + rect.height / 2 - vh / 2;
      el.style.transform = `translate3d(0, ${(-mid * k).toFixed(2)}px, 0)`;
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  apply();
}

/* ============================================================
   滚动显影
   ============================================================ */
function initReveal() {
  const items = Array.from(document.querySelectorAll(".reveal"));
  if (!items.length) return;
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
  );
  items.forEach((el) => io.observe(el));
}

window.InkEngine = {
  dryFan, pressWhorl, sweep, compose, PRESETS,
  initParallax, initReveal,
};
