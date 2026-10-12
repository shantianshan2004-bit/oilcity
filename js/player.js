/* ============================================================
   油城往事 · 音频播放器
   ------------------------------------------------------------
   进度条是一条墨线。播放/暂停、拖动、音量、上一首/下一首。
   尚无音频文件时明确说明，不伪装成可播放。
   ============================================================ */

window.Player = (function () {
  "use strict";

  let audio = null;

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function mount(song) {
    const root = document.getElementById("player");
    if (!root) return;

    const src = song.audio_path || "";
    const cover = song.cover_path || "";

    root.innerHTML = `
      <div class="controls">
        <button id="plPlay" aria-label="播放或暂停">播放</button>
        <span class="time" id="plCur">0:00</span>
        <span class="bar" id="plBar" role="slider" tabindex="0"
              aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="track"></span><span class="fill" id="plFill"></span>
          <span class="knob" id="plKnob"></span>
        </span>
        <span class="time" id="plDur">0:00</span>
        <button id="plVol" aria-label="静音或取消静音">音量</button>
        <button id="plPrev" aria-label="上一首">上一首</button>
        <button id="plNext" aria-label="下一首">下一首</button>
      </div>
      ${cover ? `<p class="micro">封面：<span class="en">${cover}</span></p>` : ""}
      <p class="notice" id="plNote"></p>
    `;

    const note = root.querySelector("#plNote");

    if (!src) {
      note.innerHTML =
        "尚无音频文件。可在<a class=\"underscore\" href=\"cocreate.html\">共创档案</a>登录后上传音讯，上传完成即可在此播放。";
      root.querySelector("#plPlay").disabled = true;
      root.querySelector("#plPrev").disabled = true;
      root.querySelector("#plNext").disabled = true;
      return;
    }

    (async () => {
      let url = src;
      if (!/^https?:/i.test(src)) {
        url = await Store.signedUrl(src, 3600);
        if (!url) {
          note.textContent = "音频链接获取失败，请确认已登录后再试。";
          return;
        }
      }
      note.textContent = "";

      audio = new Audio(url);
      audio.preload = "metadata";

      const play = root.querySelector("#plPlay");
      const cur = root.querySelector("#plCur");
      const dur = root.querySelector("#plDur");
      const bar = root.querySelector("#plBar");
      const fill = root.querySelector("#plFill");
      const knob = root.querySelector("#plKnob");
      const vol = root.querySelector("#plVol");

      const paint = () => {
        const d = audio.duration || 0;
        const p = d ? (audio.currentTime / d) * 100 : 0;
        fill.style.width = p + "%";
        knob.style.left = p + "%";
        bar.setAttribute("aria-valuenow", String(Math.round(p)));
        cur.textContent = fmt(audio.currentTime);
        dur.textContent = fmt(d);
      };

      play.addEventListener("click", () => {
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
      });
      audio.addEventListener("play", () => { play.textContent = "暂停"; });
      audio.addEventListener("pause", () => { play.textContent = "播放"; });
      audio.addEventListener("timeupdate", paint);
      audio.addEventListener("loadedmetadata", paint);
      audio.addEventListener("ended", () => { play.textContent = "播放"; });

      const seek = (e) => {
        if (!audio.duration) return;
        const r = bar.getBoundingClientRect();
        const x = Math.min(Math.max(0, (e.clientX - r.left) / r.width), 1);
        audio.currentTime = x * audio.duration;
        paint();
      };
      bar.addEventListener("click", seek);
      bar.addEventListener("keydown", (e) => {
        if (!audio.duration) return;
        if (e.key === "ArrowRight") { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); paint(); }
        if (e.key === "ArrowLeft") { audio.currentTime = Math.max(0, audio.currentTime - 5); paint(); }
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); play.click(); }
      });

      vol.addEventListener("click", () => {
        audio.muted = !audio.muted;
        vol.textContent = audio.muted ? "已静音" : "音量";
      });

      root.querySelector("#plPrev").addEventListener("click", () => {
        const all = Store.songs();
        const i = all.findIndex((s) => s.slug === song.slug);
        if (i > 0) location.href = `song.html?id=${encodeURIComponent(all[i - 1].slug)}`;
      });
      root.querySelector("#plNext").addEventListener("click", () => {
        const all = Store.songs();
        const i = all.findIndex((s) => s.slug === song.slug);
        if (i >= 0 && i < all.length - 1)
          location.href = `song.html?id=${encodeURIComponent(all[i + 1].slug)}`;
      });
    })();
  }

  return { mount };
})();
