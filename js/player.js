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
      const canUp = Store.mode === "cloud" && Store.isSignedIn();
      note.innerHTML = canUp
        ? '尚无音频文件。可在本页右侧「投稿」处直接上传音讯，上传完成即可播放。'
        : '尚无音频文件。登录后可在本页「投稿」处上传音讯，也可前往<a class="underscore" href="music.html">留声机</a>投稿。';
      root.querySelector("#plPlay").disabled = true;
      root.querySelector("#plPrev").disabled = true;
      root.querySelector("#plNext").disabled = true;
      return;
    }

    (async () => {
      let url = src;
      if (!/^https?:/i.test(src)) {
        if (!Store.isSignedIn()) {
          note.textContent =
            '音频需要登录后才能取得播放地址。请先登录，再回到本页。';
          return;
        }
        url = await Store.signedUrl(src, 3600);
        if (!url) {
          /* 把存储层记录的具体原因带出来，不再只说"失败" */
          const why = (Store.getTrace ? Store.getTrace() : [])
            .filter((r) => /拒绝|中止|抛错|未返回/.test(r.step))
            .map((r) => r.step + "：" + r.detail)
            .join("；");
          const notFound = /not.?found/i.test(why);
          note.textContent = notFound
            ? "云端找不到这个音频文件 —— 多半是早期按「用户私有路径」上传的，只有上传者本人能听。请在本页重新上传一次（新上传走共享区，所有读者都能播放）。"
            : "播放地址获取失败" + (why ? " —— " + why : "") + "。请确认已登录后再试。";
          return;
        }
      }
      note.textContent = "";

      audio = new Audio(url);
      audio.preload = "metadata";

      /* 播放失败也要说出原因，不能静默无声 */
      audio.addEventListener("error", () => {
        const e = audio.error;
        const map = {
          1: "加载被中止。",
          2: "网络中断，音频未能下载完成。",
          3: "音频解码失败，文件可能已损坏或格式不受支持。",
          4: "音频格式不受浏览器支持，或文件地址已失效。",
        };
        note.textContent =
          (e && map[e.code]) || "音频加载失败，请重新上传后再试。";
      });

      /* 签名请求成功但拿到的链接指向缺失对象时，Audio 也会报错；
         这里对"对象缺失"补一条明确指引（多见于旧版按用户私有路径上传的音频）。 */
      audio.addEventListener("stalled", () => {
        note.textContent = "音频加载缓慢或停滞，请稍候…";
      });

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
