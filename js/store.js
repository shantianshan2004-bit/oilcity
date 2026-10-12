/* ============================================================
   油城往事 · 数据层
   ------------------------------------------------------------
   一个共享数据源，两种工作状态：

   · cloud   —— 已连上云端（WorkBuddy Cloud Service）
               读：contents / revisions 表
               写：需登录（写前写入 revisions，保留版本历史）
               文件：Storage 上传

   · local   —— 云端不可达，退回到内置种子数据（原文只读）。
               此状态下【写入不可用】，界面会明确说明，
               不会把本地改动伪装成多人协作。

   站点从不隐藏自己处于哪种状态。
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 云端配置 ---------- */
  const CFG = {
    resourceId: "wbcs_D7mSSSmSnPaodlPlrkZMV3",
    endpoint: "https://oil-city-archives.app.workbuddy.host",
    oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
    publishableKey: "wbpk_bjjEnYmR3bnbqIkReGnes3_80zIbtLkjorx8eAhy46WDGMRMtaQO6ky",
  };

  const SDK_URL =
    "https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js";

  const state = {
    mode: "local",       // 'cloud' | 'local'
    cloud: null,         // SDK 实例
    session: null,       // 当前登录会话
    contents: [],        // 内存缓存（全站共享读源）
    revisions: [],
    lastError: null,
  };

  /* ---------- 工具 ---------- */
  /* SDK 客户端的数据库模块属性是 cloud.database（旧名 cloud.db 兜底） */
  function dbh() {
    const c = state.cloud;
    if (!c) throw new Error("雲端客戶端未建立。");
    const m = c.database || c.db;
    if (!m) throw new Error("SDK 客戶端上找不到資料庫模組（database/db 均不存在）。");
    return m;
  }
  state.db = dbh;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function slugify(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(
      d.getHours()
    )}:${p(d.getMinutes())}`;
  }

  /* ============================================================
     载入 SDK
     ============================================================ */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-sdk="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.sdk = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("SDK 載入失敗"));
      document.head.appendChild(s);
    });
  }

  /* ============================================================
     初始化
     ============================================================ */
  async function init() {
    /* 先用种子数据立即可读 —— 页面永远不空 */
    state.contents = clone(window.SEED || []);

    try {
      await loadScript(SDK_URL);
      const ns = window.WorkBuddyCloud || {};
      /* SDK 的工厂函数是 createWorkBuddyCloud；createClient 是防御性兜底 */
      const factory =
        typeof ns.createWorkBuddyCloud === "function"
          ? ns.createWorkBuddyCloud
          : typeof ns.createClient === "function"
          ? ns.createClient
          : typeof ns === "function"
          ? ns
          : null;
      if (!factory) throw new Error("SDK 形狀不符：找不到工廠函數");

      /* 会话持久化由 SDK 自己负责：默认即使用 localStorage，
         键名 workbuddy-cloud.session.<publishableKey>。
         localStorage 不可用（隐私模式等）时才退回内存。 */
      const cloud = await factory({
        resourceId: CFG.resourceId,
        endpoint: CFG.endpoint,
        publishableKey: CFG.publishableKey,
        oauthRelayBaseUrl: CFG.oauthRelayBaseUrl,
      });

      state.cloud = cloud;
      state.mode = "cloud";

      /* 恢复登录态：getSession/peek 读回持久化的会话，
         必要时 SDK 会自己用 refreshToken 续期。 */
      await readSession();
      watchSession();

      await pull();
    } catch (err) {
      state.mode = "local";
      state.lastError = String(err && err.message ? err.message : err);
      console.warn("[油城往事] 云端不可用，以原文只读模式运行：", state.lastError);
    }

    return state;
  }

  /* ============================================================
     读：把云端内容合并进缓存
     ============================================================ */
  async function pull() {
    if (state.mode !== "cloud") return;
    const { data, error } = await state.db()
      .from("contents")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message || "讀取失敗");
    if (!Array.isArray(data)) return;

    /* 云端行覆盖同 slug 的种子行；云端独有的行追加 */
    const map = new Map(state.contents.map((r) => [r.slug, r]));
    for (const row of data) {
      /* 过滤调试期间遗留的无用行 */
      if (!row || !row.slug) continue;
      if (/^(test-|sead-)/.test(row.slug)) continue;
      if (row.type !== "chapter" && row.type !== "character" && row.type !== "song")
        continue;
      const merged = Object.assign({}, map.get(row.slug) || {}, {
        slug: row.slug,
        type: row.type,
        title: row.title,
        subtitle: row.subtitle || undefined,
        date_label: row.date_label || undefined,
        summary: row.summary || "",
        body: row.body || "",
        data: row.data && typeof row.data === "object" ? row.data : {},
        tags: row.tags || [],
        cover_path: row.cover_path || undefined,
        audio_path: row.audio_path || undefined,
        updated_at: row.updated_at || undefined,
        created_at: row.created_at || undefined,
        _cloud: true,
      });
      /* 空正文不覆盖种子里的原文 */
      if (!merged.body && map.has(row.slug)) {
        merged.body = map.get(row.slug).body || "";
      }
      map.set(row.slug, merged);
    }
    state.contents = Array.from(map.values());
  }

  /* ============================================================
     查
     ============================================================ */
  const byType = (t) => state.contents.filter((r) => r.type === t);
  const bySlug = (s) => state.contents.find((r) => r.slug === s) || null;

  function search(q) {
    const k = String(q || "").trim().toLowerCase();
    if (!k) return [];
    const hit = (v) => String(v || "").toLowerCase().includes(k);
    return state.contents.filter(
      (r) =>
        hit(r.title) ||
        hit(r.subtitle) ||
        hit(r.summary) ||
        hit(r.body) ||
        (r.tags || []).some(hit)
    );
  }

  /* ============================================================
     登录
     ------------------------------------------------------------
     SDK 的 auth 方法返回 { data, error }，不是直接抛错；
     且 SDK 会在初始化后广播 INITIAL_SESSION / SIGNED_IN /
     TOKEN_REFRESHED / SIGNED_OUT / USER_UPDATED。
     这里既主动读回会话，也订阅事件，保证刷新后登录态不丢。
     ============================================================ */
  function applySession(sess) {
    if (!sess || !sess.accessToken) {
      state.session = null;
      return null;
    }
    state.session = {
      accessToken: sess.accessToken,
      refreshToken: sess.refreshToken,
      expiresAt: sess.expiresAt,
      user: sess.user || null,
    };
    return state.session;
  }

  /* 会话里的 user 只有 id/name/avatar（SDK 的 parseSession 不含 email），
     邮箱等信息来自 auth.getUser()。这一步只补一次，失败不影响登录。 */
  async function hydrateUser() {
    if (!state.cloud || !state.session) return;
    const auth = state.cloud.auth;
    if (typeof auth.getUser !== "function") return;
    try {
      const res = await auth.getUser();
      const u = res && res.data ? res.data : null;
      if (u && (u.email || u.phone)) {
        state.session.user = Object.assign({}, state.session.user, u);
      }
    } catch (_) {}
  }

  async function readSession() {
    if (state.mode !== "cloud" || !state.cloud) return null;
    const auth = state.cloud.auth;
    try {
      /* 先看本地持久化的会话（不打网络） */
      const peeked = auth.sessions && auth.sessions.peek && auth.sessions.peek();
      if (peeked && peeked.accessToken) {
        applySession(peeked);
        await hydrateUser();
        return state.session;
      }
      /* 再让 SDK 校验/续期 */
      const res = await auth.getSession();
      const sess = res && res.data ? res.data : res;
      if (sess && sess.accessToken) {
        applySession(sess);
        await hydrateUser();
        return state.session;
      }
      applySession(null);
    } catch (_) {
      applySession(null);
    }
    return state.session;
  }

  /* 订阅 SDK 的登录态事件：token 续期、退出、会话失效都能实时反映 */
  function watchSession() {
    if (state.mode !== "cloud" || !state.cloud) return;
    const auth = state.cloud.auth;
    if (!auth || typeof auth.onAuthStateChange !== "function") return;
    try {
      auth.onAuthStateChange((event, sess) => {
        if (event === "SIGNED_OUT") applySession(null);
        else if (sess && sess.accessToken) applySession(sess);
        /* 通知界面重绘 */
        if (state.onAuthChange) state.onAuthChange(event);
      });
    } catch (_) {}
  }

  /* 暂存 signInWithOtp 返回的 {verificationId, isExistingUser, verify}
     —— 它带着 isExistingUser 标志，必须原样交回 verifyOtp，
     否则后端会用错分支（新用户走注册、老用户走登录）。 */
  let pendingOtp = null;

  async function sendCode(email) {
    if (state.mode !== "cloud") throw new Error("雲端未連接，無法登入。");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new Error("請填寫有效的信箱。");

    /* 老用户走 signIn；新用户会被后端拒绝。
       统一用 signInWithOtp：它同时给出 verificationId 与 isExistingUser。 */
    const res = await state.cloud.auth.signInWithOtp({ email });
    if (!res || res.error) {
      const m = res && res.error && res.error.message;
      throw new Error(m || "驗證碼寄送失敗，請稍後再試。");
    }
    pendingOtp = res.data || null;
    if (!pendingOtp || !pendingOtp.verificationId)
      throw new Error("雲端未回傳驗證標識。");
    return true;
  }

  async function verifyCode(email, code) {
    if (state.mode !== "cloud") throw new Error("雲端未連接，無法登入。");
    const token = String(code || "").trim();
    if (!token) throw new Error("請填寫驗證碼。");
    if (!pendingOtp || !pendingOtp.verificationId)
      throw new Error("請先點「寄送驗證碼」，再輸入驗證碼。");

    let res;
    try {
      /* SDK 提供的 verify 已绑定 verificationId 与 isExistingUser */
      res =
        typeof pendingOtp.verify === "function"
          ? await pendingOtp.verify({ token })
          : await state.cloud.auth.verifyOtp({
              email,
              verificationId: pendingOtp.verificationId,
              token,
              isExistingUser: pendingOtp.isExistingUser,
            });
    } catch (err) {
      throw new Error(
        (err && err.error && err.error.message) || err.message || "驗證失敗。"
      );
    }

    if (res && res.error) {
      const e = res.error;
      const m = e.message || "";
      /* 过期/错误是最常见的两种，给出可操作的提示 */
      if (/expired|過期/i.test(m)) throw new Error("驗證碼已過期，請重新寄送。");
      if (/invalid|錯誤|不正確/i.test(m)) throw new Error("驗證碼不正確，請核對後重試。");
      if (e.kind === "rate-limited") throw new Error("嘗試過於頻繁，請稍後再試。");
      throw new Error(m || "驗證失敗。");
    }

    const sess = res && res.data ? res.data : res;
    applySession(sess);
    if (!state.session) await readSession();
    else await hydrateUser();
    pendingOtp = null;
    return state.session;
  }

  async function signOut() {
    if (state.cloud && state.cloud.auth) {
      try {
        const r = await state.cloud.auth.signOut();
        if (r && r.error) console.warn("[油城往事] 登出返回错误：", r.error.message);
      } catch (_) {}
    }
    applySession(null);
  }

  const isSignedIn = () => !!(state.session && state.session.accessToken);
  const userLabel = () => {
    const u = state.session && state.session.user;
    if (!u) return "";
    return u.email || u.phone || u.name || (u.id ? String(u.id).slice(0, 8) : "已登入");
  };

  /* ============================================================
     写：保存内容 + 留档版本
     ------------------------------------------------------------
     先写 revisions（快照上一版），再 upsert contents。
     未登录一律拒绝，绝不写本地。
     ============================================================ */
  async function save(entry, note) {
    if (state.mode !== "cloud")
      throw new Error("雲端未連接。目前為原文只讀模式，無法儲存。");
    if (!isSignedIn()) throw new Error("請先登入，再提交修改。");

    const slug = entry.slug || slugify(entry.title);
    if (!slug) throw new Error("缺少條目識別。");
    if (!entry.title || !String(entry.title).trim())
      throw new Error("標題不能為空。");

    const prev = bySlug(slug);

    /* 1) 版本快照 */
    if (prev) {
      await state.db().from("revisions").insert({
        target_slug: slug,
        target_type: prev.type,
        title: prev.title,
        note: note || "內容修改",
        snapshot: {
          title: prev.title,
          subtitle: prev.subtitle || null,
          date_label: prev.date_label || null,
          summary: prev.summary || "",
          body: prev.body || "",
          data: prev.data || {},
        },
        editor_name: userLabel(),
      });
    }

    /* 2) 主表 upsert */
    const payload = {
      slug,
      type: entry.type,
      title: String(entry.title).trim(),
      subtitle: entry.subtitle || null,
      date_label: entry.date_label || null,
      summary: entry.summary || "",
      body: entry.body || "",
      data: entry.data || {},
      tags: entry.tags || [],
      cover_path: entry.cover_path || null,
      audio_path: entry.audio_path || null,
      updated_at: nowISO(),
    };

    const { error } = await state.db()
      .from("contents")
      .upsert(payload, { onConflict: "slug" });
    if (error) throw new Error(error.message || "儲存失敗");

    await pull();
    return bySlug(slug);
  }

  async function remove(slug) {
    if (state.mode !== "cloud") throw new Error("雲端未連接，無法刪除。");
    if (!isSignedIn()) throw new Error("請先登入。");
    const { error } = await state.db().from("contents").delete().eq("slug", slug);
    if (error) throw new Error(error.message || "刪除失敗");
    state.contents = state.contents.filter((r) => r.slug !== slug);
  }

  /* ---------- 版本历史 ---------- */
  async function revisionsOf(slug) {
    if (state.mode !== "cloud") return [];
    const { data, error } = await state.db()
      .from("revisions")
      .select("*")
      .eq("target_slug", slug)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return [];
    return Array.isArray(data) ? data : [];
  }

  async function restore(revisionId) {
    if (state.mode !== "cloud") throw new Error("雲端未連接。");
    if (!isSignedIn()) throw new Error("請先登入。");
    const { data, error } = await state.db()
      .from("revisions")
      .select("*")
      .eq("id", revisionId)
      .limit(1);
    if (error || !data || !data.length) throw new Error("找不到該版本。");
    const rev = data[0];
    const cur = bySlug(rev.target_slug);
    const snap = rev.snapshot || {};
    return save(
      Object.assign({}, cur || { type: rev.target_type, slug: rev.target_slug }, snap, {
        slug: rev.target_slug,
        type: cur ? cur.type : rev.target_type,
      }),
      `還原至 ${fmtTime(rev.created_at)}`
    );
  }

  /* ============================================================
     文件上传
     ============================================================ */
  const LIMITS = {
    image: { max: 8 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "image/gif"], label: "圖片 ≤ 8MB（PNG / JPG / WEBP / GIF）" },
    audio: { max: 32 * 1024 * 1024, types: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/mp4", "audio/x-m4a"], label: "音訊 ≤ 32MB（MP3 / WAV / OGG / M4A）" },
  };

  function validateFile(kind, file) {
    const rule = LIMITS[kind];
    if (!rule) return "未知的檔案類型。";
    if (!file) return "未選擇檔案。";
    if (file.size > rule.max)
      return `檔案過大：${(file.size / 1048576).toFixed(1)}MB，上限 ${rule.max / 1048576}MB。`;
    if (rule.types.length && file.type && !rule.types.includes(file.type))
      return `格式不支援：${file.type}。允許 ${rule.label}`;
    return null;
  }

  /* SDK 只开放一个存储桶，名字固定为 "runtime"：
       from(e = "runtime") { if (e !== "runtime") throw ... }
     其它桶名一律被拒。storage.from() 不传参数即拿默认桶。 */
  function storageBucket() {
    if (state.mode !== "cloud" || !state.cloud) return null;
    const st = state.cloud.storage;
    if (!st || typeof st.from !== "function") return null;
    return st.from();
  }

  /* 当前登录用户的存储作用域。SDK 提供了 userPath/sharedPath 两个正规构造器，
     优先用它们，避免自己拼路径踩到服务端的路径规则。 */
  function scopePath(storage, file) {
    const safe = String(file.name || "file")
      .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_")
      .slice(-80);
    const stamp = Date.now();
    const uid =
      (state.session &&
        state.session.user &&
        (state.session.user.id || state.session.user.sub)) ||
      null;

    try {
      if (typeof storage.userPath === "function" && uid)
        return storage.userPath(uid, `${stamp}-${safe}`);
      if (typeof storage.sharedPath === "function")
        return storage.sharedPath(uid || "anon", `${stamp}-${safe}`);
    } catch (_) {}
    return `${uid ? "users/" + uid : "shared/anon"}/${stamp}-${safe}`;
  }

  async function upload(kind, file, onProgress) {
    if (state.mode !== "cloud") throw new Error("雲端未連接，無法上傳。");
    if (!isSignedIn()) throw new Error("請先登入，再上傳檔案。");
    const bad = validateFile(kind, file);
    if (bad) throw new Error(bad);

    const storage = storageBucket();
    if (!storage) throw new Error("雲端儲存未就緒。");

    const path = scopePath(storage, file);
    const { data, error } = await storage.upload(path, file, {
      upsert: true,
      onProgress,
    });
    if (error) throw new Error(error.message || "上傳失敗");
    return (data && (data.path || data.fullPath)) || path;
  }

  async function signedUrl(path, seconds) {
    if (state.mode !== "cloud" || !path) return "";
    const storage = storageBucket();
    if (!storage) return "";
    const { data, error } = await storage.createSignedUrl(
      path,
      seconds || 3600
    );
    if (error) return "";
    return (data && (data.signedUrl || data.url)) || "";
  }

  /* ============================================================
     导出
     ============================================================ */
  window.Store = {
    init,
    refresh: pull,
    get state() { return state; },
    get mode() { return state.mode; },
    byType,
    bySlug,
    search,
    chapters: () => byType("chapter"),
    characters: () => byType("character"),
    songs: () => byType("song"),
    sendCode,
    verifyCode,
    signOut,
    readSession,
    isSignedIn,
    userLabel,
    save,
    remove,
    revisionsOf,
    restore,
    upload,
    signedUrl,
    validateFile,
    LIMITS,
    fmtTime,
    slugify,
  };
})();
