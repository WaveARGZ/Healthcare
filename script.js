// ======================================================
// BodyMake Support App — local-DB build (v0.4)
// アカウント登録・ログイン + アカウント単位のローカル保存
// バックエンドなし。localStorage を「ローカルDB」として構造化して使う。
// ======================================================

// ---------- low-level storage (the local "DB") ----------

const DB = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      alert("保存に失敗しました。ローカル保存容量の上限に達している可能性があります。");
      return false;
    }
  },
  getRaw(key) {
    return localStorage.getItem(key);
  },
  setRaw(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      alert("写真の保存に失敗しました。画像サイズを小さくして再度お試しください（容量上限の可能性）。");
      return false;
    }
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};

// key namespace（テーブル相当）
const K = {
  users: "bm_users", // アカウント一覧
  session: "bm_session", // ログイン状態
  posts: "bm_posts", // 掲示板（端末内で共有）
  userData: (id) => `bm_u:${id}:data`, // ユーザーごとの記録
  userPhoto: (id) => `bm_u:${id}:photo`, // ユーザーごとの写真
};

// ---------- utilities ----------

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value == null ? "" : value;
}

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// 簡易ハッシュ（※研究用プロトタイプ。実運用ではサーバ側で安全に処理する）
function hashPassword(password, salt) {
  const str = String(salt) + "::" + String(password);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function makeId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- users / session ----------

function getUsers() {
  return DB.get(K.users, []);
}
function setUsers(list) {
  DB.set(K.users, list);
}
function findUserByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return getUsers().find((u) => u.email === e) || null;
}
function findUserById(id) {
  return getUsers().find((u) => u.id === id) || null;
}
function getSession() {
  return DB.get(K.session, null);
}
function setSession(userId) {
  DB.set(K.session, { userId });
}
function clearSession() {
  DB.remove(K.session);
}
function currentUser() {
  const s = getSession();
  return s ? findUserById(s.userId) : null;
}

// ---------- app state (現在ログイン中ユーザーの作業データ) ----------

let profile = null;
let bodyPhoto = null;
let selectedIdeal = null;
let meals = [];
let workouts = [];
let bookmarks = [];      // 種目ブックマーク（種目ID配列）
let pendingEntries = []; // 記録待ちセッション（保存前・メモリのみ）
let posts = DB.get(K.posts, []); // 掲示板は共有

function loadUserState(id) {
  const data = DB.get(K.userData(id), {});
  profile = data.profile || null;
  selectedIdeal = data.selectedIdeal || null;
  meals = Array.isArray(data.meals) ? data.meals : [];
  workouts = Array.isArray(data.workouts) ? data.workouts : [];
  bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  bodyPhoto = DB.getRaw(K.userPhoto(id)); // 文字列 or null
  migrateMeals(); // 旧フォーマットの食事を新モデルへ
}

function clearUserState() {
  profile = null;
  bodyPhoto = null;
  selectedIdeal = null;
  meals = [];
  workouts = [];
  bookmarks = [];
  pendingEntries = [];
}

function saveState() {
  const u = currentUser();
  if (!u) return;
  DB.set(K.userData(u.id), { profile, selectedIdeal, meals, workouts, bookmarks });
}

function savePhoto() {
  const u = currentUser();
  if (!u) return;
  if (bodyPhoto) DB.setRaw(K.userPhoto(u.id), bodyPhoto);
  else DB.remove(K.userPhoto(u.id));
}

function savePosts() {
  DB.set(K.posts, posts);
}

// ---------- 画面遷移 ----------

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.go === screenId);
  });

  if (screenId === "homeScreen") renderHome();
  if (screenId === "mealScreen") renderMeals();
  if (screenId === "dashboardScreen") renderDashboard();
  if (screenId === "settingsScreen") renderSettings();
  if (screenId === "communityScreen") renderPosts();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupNavigationButtons() {
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => {
      showScreen(button.dataset.go);
    });
  });
}

// ---------- ルーティング（ログイン状態・同意・進捗で初期画面を決める） ----------

function applyAuthedUI(shown) {
  // トップバーのアカウント/設定はセットアップ完了後（ホーム以降）だけ表示する
  document.body.classList.toggle("is-authed", shown);
  const u = currentUser();
  const name = document.getElementById("accountName");
  if (name) name.textContent = u ? u.name : "";
}

function route() {
  const u = currentUser();

  if (!u) {
    clearUserState();
    resetAuthForms();
    applyAuthedUI(false);
    showScreen("authScreen");
    return;
  }

  if (!u.consentedAt) {
    applyAuthedUI(false);
    showScreen("consentScreen");
    return;
  }

  loadUserState(u.id);
  hydrateForApp();

  if (!profile) {
    applyAuthedUI(false);
    showScreen("profileScreen");
    return;
  }
  if (!bodyPhoto) {
    applyAuthedUI(false);
    showScreen("photoScreen");
    return;
  }
  if (!selectedIdeal) {
    applyAuthedUI(false);
    showScreen("idealScreen");
    return;
  }

  applyAuthedUI(true);
  showScreen("homeScreen");
}

// フォーム・プレビュー・一覧を現在の状態に合わせて描き直す
function hydrateForApp() {
  if (profile) {
    setVal("heightInput", profile.height);
    setVal("weightInput", profile.weight);
    setVal("genderInput", profile.gender);
    setVal("ageInput", profile.age);
    setVal("goalInput", profile.goal);
    setVal("goalMemoInput", profile.memo);
  } else {
    ["heightInput", "weightInput", "genderInput", "ageInput", "goalInput", "goalMemoInput"].forEach((id) => setVal(id, ""));
  }

  const preview = document.getElementById("bodyPhotoPreview");
  if (preview) {
    if (bodyPhoto) {
      preview.innerHTML = `<img src="${bodyPhoto}" alt="現在の体型写真" />`;
      renderIdealImages();
    } else {
      preview.innerHTML = `<span>スキャン画像がここに表示されます</span>`;
      clearIdealImages();
    }
  }

  updateIdealUI();
  renderMeals();
  renderWorkouts();
  renderPosts();
  renderExChips();
  renderExList();
  renderPending();
}

// ---------- 日付初期値 ----------

function setTodayToDateInputs() {
  const today = new Date().toISOString().split("T")[0];
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.value = today;
  });
}

// ======================================================
// 認証：ログイン / 新規登録
// ======================================================

function setAuthError(msg) {
  const box = document.getElementById("authError");
  if (!box) return;
  box.textContent = msg || "";
  box.style.display = msg ? "block" : "none";
}

function switchAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  document.querySelectorAll(".auth-pane").forEach((p) => {
    p.classList.toggle("active", p.dataset.pane === tab);
  });
  setAuthError("");
}

function resetAuthForms() {
  ["loginEmail", "loginPassword", "registerName", "registerEmail", "registerPassword"].forEach((id) => setVal(id, ""));
  setAuthError("");
  switchAuthTab("login");
}

function handleRegister() {
  const name = val("registerName").trim();
  const email = val("registerEmail").trim().toLowerCase();
  const pw = val("registerPassword");

  if (!name || !email || !pw) {
    setAuthError("名前・メール・パスワードをすべて入力してください。");
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    setAuthError("メールアドレスの形式が正しくありません。");
    return;
  }
  if (pw.length < 4) {
    setAuthError("パスワードは4文字以上にしてください。");
    return;
  }
  if (findUserByEmail(email)) {
    setAuthError("このメールアドレスは既に登録されています。");
    return;
  }

  const salt = makeId("");
  const user = {
    id: makeId("u_"),
    name,
    email,
    salt,
    passHash: hashPassword(pw, salt),
    consentedAt: null,
    createdAt: new Date().toISOString(),
  };

  const users = getUsers();
  users.push(user);
  setUsers(users);

  // 空データを初期化
  DB.set(K.userData(user.id), { profile: null, selectedIdeal: null, meals: [], workouts: [] });

  setSession(user.id);
  resetAuthForms();
  route(); // → 同意画面
}

function handleLogin() {
  const email = val("loginEmail").trim().toLowerCase();
  const pw = val("loginPassword");

  if (!email || !pw) {
    setAuthError("メールアドレスとパスワードを入力してください。");
    return;
  }

  const user = findUserByEmail(email);
  if (!user || user.passHash !== hashPassword(pw, user.salt)) {
    setAuthError("メールアドレスまたはパスワードが違います。");
    return;
  }

  setSession(user.id);
  resetAuthForms();
  route();
}

function setupAuth() {
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchAuthTab(tab.dataset.tab));
  });
  document.getElementById("registerButton").addEventListener("click", handleRegister);
  document.getElementById("loginButton").addEventListener("click", handleLogin);
}

// ======================================================
// 利用同意
// ======================================================

function setupConsent() {
  const check = document.getElementById("consentCheck");
  const agree = document.getElementById("consentAgreeButton");
  const decline = document.getElementById("consentDeclineButton");

  check.addEventListener("change", () => {
    agree.disabled = !check.checked;
  });

  agree.addEventListener("click", () => {
    const u = currentUser();
    if (!u) {
      route();
      return;
    }
    const users = getUsers().map((x) =>
      x.id === u.id ? { ...x, consentedAt: new Date().toISOString() } : x
    );
    setUsers(users);
    check.checked = false;
    agree.disabled = true;
    route();
  });

  decline.addEventListener("click", () => {
    // 同意しない → ログアウト
    clearSession();
    clearUserState();
    route();
  });
}

// ======================================================
// STEP 1：プロフィール入力
// ======================================================

function setupProfileForm() {
  document.getElementById("saveProfileButton").addEventListener("click", () => {
    const height = val("heightInput");
    const weight = val("weightInput");
    const gender = val("genderInput");
    const age = val("ageInput");
    const goal = val("goalInput");
    const memo = val("goalMemoInput");

    if (!height || !weight || !gender || !age || !goal) {
      alert("身長・体重・性別・年齢・目標を入力してください。");
      return;
    }

    profile = {
      height: Number(height),
      weight: Number(weight),
      gender,
      age: Number(age),
      goal,
      memo,
      savedAt: new Date().toLocaleString("ja-JP"),
    };

    saveState();
    showScreen("photoScreen");
  });
}

// ======================================================
// STEP 2：写真アップロード
// ======================================================

function setupPhotoUpload() {
  const input = document.getElementById("bodyPhotoInput");
  const preview = document.getElementById("bodyPhotoPreview");

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      bodyPhoto = event.target.result;
      savePhoto();
      preview.innerHTML = `<img src="${bodyPhoto}" alt="現在の体型写真" />`;
      renderIdealImages();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("goIdealButton").addEventListener("click", () => {
    if (!bodyPhoto) {
      alert("まず写真をアップロードしてください。");
      return;
    }
    showScreen("idealScreen");
  });
}

// ======================================================
// STEP 3：理想体型選択
// ======================================================

const IDEAL_LABELS = {
  cut: "絞った体型",
  bulk: "筋肥大した体型",
  maintain: "健康的に維持する体型",
};

const IDEAL_IMAGE_IDS = ["idealCutImage", "idealBulkImage", "idealMaintainImage"];

function renderIdealImages() {
  if (!bodyPhoto) return;
  IDEAL_IMAGE_IDS.forEach((id) => {
    const box = document.getElementById(id);
    if (box) box.innerHTML = `<img src="${bodyPhoto}" alt="AI生成イメージ" />`;
  });
}

function clearIdealImages() {
  IDEAL_IMAGE_IDS.forEach((id) => {
    const box = document.getElementById(id);
    if (box) box.innerHTML = `<span>写真アップロード後に表示</span>`;
  });
}

function updateIdealUI() {
  document.querySelectorAll(".ideal-card").forEach((card) => {
    card.classList.toggle("selected", selectedIdeal && card.dataset.ideal === selectedIdeal.type);
  });

  const message = document.getElementById("selectedIdealMessage");
  if (!message) return;

  if (selectedIdeal) {
    message.textContent = `目標体型をロック中：${selectedIdeal.label}`;
  } else {
    message.textContent = "まだ目標体型はロックされていません。";
  }
}

function setupIdealSelection() {
  document.querySelectorAll(".select-ideal-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.ideal;
      selectedIdeal = {
        type,
        label: IDEAL_LABELS[type],
        selectedAt: new Date().toLocaleString("ja-JP"),
      };
      saveState();
      updateIdealUI();
    });
  });

  document.getElementById("goHomeButton").addEventListener("click", () => {
    if (!selectedIdeal) {
      alert("目標体型を1つ選択してください。");
      return;
    }
    showScreen("homeScreen");
  });
}

// ======================================================
// ホーム
// ======================================================

function renderHome() {
  const summary = document.getElementById("profileSummary");
  const title = document.getElementById("welcomeTitle");
  if (!summary || !title) return;

  if (!profile) {
    summary.innerHTML = "<p>プロフィール未入力</p>";
    title.textContent = "まずはプロフィールを入力しましょう";
    return;
  }

  summary.innerHTML = `
    <p><strong>${escapeHtml(profile.age)}歳 / ${escapeHtml(profile.gender)}</strong></p>
    <p>身長：${escapeHtml(profile.height)}cm</p>
    <p>体重：${escapeHtml(profile.weight)}kg</p>
    <p>目標：${escapeHtml(profile.goal)}</p>
    <p>理想体型：${selectedIdeal ? escapeHtml(selectedIdeal.label) : "未選択"}</p>
  `;

  title.textContent = `${profile.goal}ために、今日の記録を始めましょう`;

  renderHomeConsole();
}

// ======================================================
// ホーム・テレメトリコンソール（直近7日の可視化）
// ======================================================

const WD = ["日", "月", "火", "水", "木", "金", "土"];

function ymd(d) {
  return d.toISOString().split("T")[0];
}
function lastNDates(n) {
  const base = new Date(todayStr() + "T00:00:00Z"); // UTC基準（todayStrと一致）
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d);
  }
  return out;
}
function activityDateSet() {
  const s = new Set();
  meals.forEach((m) => { if (m.date) s.add(m.date); });
  workouts.forEach((w) => { if (w.date) s.add(w.date); });
  return s;
}
function currentStreak() {
  const days = activityDateSet();
  const base = new Date(todayStr() + "T00:00:00Z");
  const yest = new Date(base); yest.setUTCDate(yest.getUTCDate() - 1);
  let start;
  if (days.has(ymd(base))) start = 0;
  else if (days.has(ymd(yest))) start = 1;
  else return 0;
  let streak = 0;
  const d = new Date(base); d.setUTCDate(d.getUTCDate() - start);
  while (days.has(ymd(d))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
  return streak;
}
function daySets(date) {
  return workouts.filter((w) => w.date === date).reduce((s, w) => s + (Number(w.sets) || 0), 0);
}

function renderHomeConsole() {
  const statsEl = document.getElementById("teleStats");
  if (!statsEl) return;

  const dates = lastNDates(7);
  const cals = dates.map((d) => dayTotals(ymd(d)).cal);
  const sets = dates.map((d) => daySets(ymd(d)));
  const targets = computeTargets();
  const goal = targets ? targets.cal : 0;
  const today = todayStr();
  const todayCal = dayTotals(today).cal;
  const pct = goal ? Math.round((todayCal / goal) * 100) : null;
  const weekSets = sets.reduce((a, b) => a + b, 0);
  const calAvg = Math.round(cals.reduce((a, b) => a + b, 0) / 7);

  const tiles = [
    { label: "今日の摂取", value: todayCal, unit: "kcal" },
    { label: "目標達成率", value: pct == null ? "—" : pct, unit: pct == null ? "" : "%" },
    { label: "連続記録", value: currentStreak(), unit: "日" },
    { label: "7日トレ量", value: weekSets, unit: "セット" },
  ];
  statsEl.innerHTML = tiles
    .map((t) => `
    <div class="tele-stat">
      <span class="ts-label">${t.label}</span>
      <span class="ts-value">${t.value}<small>${t.unit}</small></span>
    </div>`)
    .join("");

  const calSub = document.getElementById("teleCalSub");
  if (calSub) calSub.textContent = `7日平均 ${calAvg} kcal`;
  const volSub = document.getElementById("teleVolSub");
  if (volSub) volSub.textContent = `7日合計 ${weekSets} セット`;

  const calPlot = document.getElementById("teleCalPlot");
  if (calPlot) {
    calPlot.innerHTML = barChartSVG(
      dates.map((d, i) => ({ label: WD[d.getUTCDay()], value: cals[i], date: ymd(d) })),
      { goal, unit: "kcal", over: true }
    );
  }
  const volPlot = document.getElementById("teleVolPlot");
  if (volPlot) {
    volPlot.innerHTML = barChartSVG(
      dates.map((d, i) => ({ label: WD[d.getUTCDay()], value: sets[i], date: ymd(d) })),
      { unit: "セット", cls: "v2" }
    );
  }
}

// 単系列バーチャート（SVG）。goal があれば目標ラインを描画。
function barChartSVG(data, opts) {
  opts = opts || {};
  const W = 340, H = 150, padL = 14, padR = 14, padT = 20, padB = 22;
  const x0 = padL, x1 = W - padR, y1 = H - padB;
  const plotW = x1 - x0, plotH = y1 - padT;
  const vals = data.map((d) => d.value);
  const maxV = Math.max(1, ...vals, opts.goal || 0);
  const top = maxV * 1.15;
  const n = data.length || 1;
  const slot = plotW / n;
  const bw = Math.min(34, slot * 0.62);
  const today = todayStr();
  const yOf = (v) => y1 - (v / top) * plotH;

  let marks = "";
  data.forEach((d, i) => {
    const cx = x0 + slot * i + slot / 2;
    const h = Math.max(0, (d.value / top) * plotH);
    const by = y1 - h;
    const over = opts.over && opts.goal && d.value > opts.goal;
    const isToday = d.date === today;
    const cls = "tele-bar" + (opts.cls ? " " + opts.cls : "") + (over ? " over" : "") + (isToday ? " today" : "");
    marks += `<rect class="${cls}" x="${(cx - bw / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" ry="4"><title>${escapeHtml(d.date)}（${d.label}） ${d.value}${opts.unit || ""}</title></rect>`;
    marks += `<text class="tele-axis" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${d.label}</text>`;
    if (isToday && d.value > 0) {
      marks += `<text class="tele-val" x="${cx.toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle">${d.value}</text>`;
    }
  });

  let goalLine = "";
  if (opts.goal) {
    const gy = yOf(opts.goal);
    goalLine =
      `<line class="tele-goal" x1="${x0}" x2="${x1}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" />` +
      `<text class="tele-goal-label" x="${x1}" y="${(gy - 4).toFixed(1)}" text-anchor="end">目標 ${opts.goal}</text>`;
  }
  const base = `<line class="tele-base" x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}" />`;

  return `<svg viewBox="0 0 ${W} ${H}" class="tele-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="7日間の推移">${base}${marks}${goalLine}</svg>`;
}

// ======================================================
// 食事管理（あすけん風：スロット別・食品DB・カロリー/PFC 収支）
// ======================================================

// 食事スロット（朝・昼・夕・間食）
const MEAL_SLOTS = [
  { key: "breakfast", label: "朝食" },
  { key: "lunch", label: "昼食" },
  { key: "dinner", label: "夕食" },
  { key: "snack", label: "間食" },
];
const SLOT_LABEL = MEAL_SLOTS.reduce((a, s) => ((a[s.key] = s.label), a), {});

// 食品データベース：1食あたりの目安（cal / P / F / C）
const FOODS = [
  { name: "ご飯 (白ごはん 100g)", cat: "主食", unit: "杯", cal: 156, p: 2.5, f: 0.3, c: 37.1 },
  { name: "ご飯 (白ごはん 150g)", cat: "主食", unit: "杯", cal: 234, p: 3.8, f: 0.5, c: 55.7 },
  { name: "ご飯 (白ごはん 200g)", cat: "主食", unit: "杯", cal: 312, p: 5.0, f: 0.6, c: 74.2 },
  { name: "玄米ご飯 (150g)", cat: "主食", unit: "杯", cal: 228, p: 4.2, f: 1.5, c: 51.3 },
  { name: "食パン (6枚切り1枚)", cat: "主食", unit: "枚", cal: 149, p: 5.3, f: 2.5, c: 26.6 },
  { name: "うどん (1玉)", cat: "主食", unit: "玉", cal: 242, p: 6.0, f: 0.9, c: 52.0 },
  { name: "パスタ (乾麺100g)", cat: "主食", unit: "皿", cal: 347, p: 12.9, f: 1.8, c: 66.9 },
  { name: "そば (1玉)", cat: "主食", unit: "玉", cal: 296, p: 9.6, f: 1.9, c: 57.0 },
  { name: "おにぎり (鮭)", cat: "主食", unit: "個", cal: 180, p: 4.5, f: 1.5, c: 36.0 },
  { name: "オートミール (40g)", cat: "主食", unit: "食", cal: 152, p: 5.5, f: 2.3, c: 27.6 },
  { name: "鶏むね肉 (皮なし100g)", cat: "主菜", unit: "食", cal: 108, p: 22.3, f: 1.5, c: 0.0 },
  { name: "鶏もも肉 (皮なし100g)", cat: "主菜", unit: "食", cal: 116, p: 18.8, f: 3.9, c: 0.0 },
  { name: "サラダチキン (1個)", cat: "主菜", unit: "個", cal: 114, p: 24.0, f: 1.5, c: 1.0 },
  { name: "卵 (Mサイズ1個)", cat: "主菜", unit: "個", cal: 76, p: 6.2, f: 5.2, c: 0.2 },
  { name: "納豆 (1パック)", cat: "主菜", unit: "個", cal: 100, p: 8.3, f: 5.0, c: 6.0 },
  { name: "鮭 (1切れ)", cat: "主菜", unit: "切れ", cal: 133, p: 22.3, f: 4.1, c: 0.1 },
  { name: "さば (1切れ)", cat: "主菜", unit: "切れ", cal: 211, p: 20.7, f: 12.1, c: 0.3 },
  { name: "豚ロース (100g)", cat: "主菜", unit: "食", cal: 263, p: 19.3, f: 19.2, c: 0.2 },
  { name: "牛赤身 (100g)", cat: "主菜", unit: "食", cal: 182, p: 21.2, f: 9.6, c: 0.3 },
  { name: "木綿豆腐 (半丁150g)", cat: "主菜", unit: "食", cal: 110, p: 9.9, f: 6.3, c: 1.8 },
  { name: "ツナ缶 (水煮1缶)", cat: "主菜", unit: "缶", cal: 71, p: 16.0, f: 0.7, c: 0.2 },
  { name: "プロテイン (1杯)", cat: "主菜", unit: "杯", cal: 120, p: 24.0, f: 1.5, c: 3.0 },
  { name: "サラダ (グリーン)", cat: "副菜", unit: "皿", cal: 40, p: 1.5, f: 2.5, c: 3.5 },
  { name: "ブロッコリー (100g)", cat: "副菜", unit: "食", cal: 37, p: 4.3, f: 0.5, c: 5.2 },
  { name: "ほうれん草おひたし", cat: "副菜", unit: "皿", cal: 25, p: 2.5, f: 0.4, c: 2.0 },
  { name: "きんぴらごぼう", cat: "副菜", unit: "皿", cal: 90, p: 1.8, f: 4.5, c: 11.0 },
  { name: "キムチ (50g)", cat: "副菜", unit: "食", cal: 23, p: 1.3, f: 0.1, c: 4.0 },
  { name: "味噌汁 (豆腐・わかめ)", cat: "汁物", unit: "杯", cal: 40, p: 3.0, f: 1.5, c: 4.0 },
  { name: "豚汁", cat: "汁物", unit: "杯", cal: 130, p: 6.0, f: 6.5, c: 12.0 },
  { name: "牛乳 (200ml)", cat: "乳製品", unit: "杯", cal: 134, p: 6.6, f: 7.6, c: 9.6 },
  { name: "ヨーグルト (無糖100g)", cat: "乳製品", unit: "個", cal: 62, p: 3.6, f: 3.0, c: 4.9 },
  { name: "ギリシャヨーグルト", cat: "乳製品", unit: "個", cal: 100, p: 10.0, f: 3.0, c: 6.0 },
  { name: "6Pチーズ (1個)", cat: "乳製品", unit: "個", cal: 60, p: 3.6, f: 4.8, c: 0.4 },
  { name: "バナナ (1本)", cat: "果物", unit: "本", cal: 86, p: 1.1, f: 0.2, c: 22.5 },
  { name: "りんご (1/2個)", cat: "果物", unit: "個", cal: 76, p: 0.2, f: 0.2, c: 20.0 },
  { name: "ブルーベリー (50g)", cat: "果物", unit: "食", cal: 25, p: 0.3, f: 0.1, c: 6.0 },
  { name: "プロテインバー (1本)", cat: "間食", unit: "本", cal: 200, p: 15.0, f: 8.5, c: 20.0 },
  { name: "アーモンド (25g)", cat: "間食", unit: "食", cal: 152, p: 5.0, f: 13.0, c: 5.0 },
  { name: "ダークチョコ (20g)", cat: "間食", unit: "食", cal: 112, p: 1.5, f: 8.0, c: 8.0 },
  { name: "ポテトチップス (60g)", cat: "間食", unit: "袋", cal: 336, p: 3.0, f: 21.0, c: 33.0 },
  { name: "ブラックコーヒー", cat: "飲料", unit: "杯", cal: 8, p: 0.2, f: 0.0, c: 1.4 },
  { name: "オレンジジュース (200ml)", cat: "飲料", unit: "杯", cal: 84, p: 1.4, f: 0.2, c: 20.0 },
  { name: "スポーツドリンク (500ml)", cat: "飲料", unit: "本", cal: 105, p: 0.0, f: 0.0, c: 26.0 },
  { name: "牛丼 (並)", cat: "外食", unit: "杯", cal: 635, p: 20.0, f: 20.0, c: 92.0 },
  { name: "ラーメン (醤油)", cat: "外食", unit: "杯", cal: 500, p: 20.0, f: 15.0, c: 70.0 },
  { name: "ハンバーグ定食", cat: "外食", unit: "食", cal: 750, p: 30.0, f: 40.0, c: 60.0 },
];
const FOOD_CATS = ["すべて", "主食", "主菜", "副菜", "汁物", "乳製品", "果物", "間食", "飲料", "外食"];

let foodModalSlot = "breakfast";
let foodModalCat = "すべて";
let foodModalQuery = "";

// 旧フォーマットの食事（{calories, protein}）を新モデルへ変換
function migrateMeals() {
  meals = (meals || []).map((m) => {
    if (m.slot && m.cal != null && m.qty != null) return m; // すでに新モデル
    return {
      id: m.id || Date.now() + Math.floor(Math.random() * 1000),
      date: m.date || "",
      slot: m.slot || "snack",
      name: m.name || "",
      cal: Number(m.cal != null ? m.cal : m.calories) || 0,
      p: Number(m.p != null ? m.p : m.protein) || 0,
      f: Number(m.f) || 0,
      c: Number(m.c) || 0,
      unit: m.unit || "",
      qty: Number(m.qty) || 1,
    };
  });
}

// ---- 目標カロリー / PFC（プロフィールから自動計算：Mifflin-St Jeor）----
function activityFactor() {
  return 1.55; // 中程度の活動量（プロトタイプ既定値）
}
function goalType() {
  if (selectedIdeal && selectedIdeal.type) return selectedIdeal.type;
  const g = (profile && profile.goal) || "";
  if (g.indexOf("落と") >= 0 || g.indexOf("引き締") >= 0) return "cut";
  if (g.indexOf("増や") >= 0 || g.indexOf("大き") >= 0) return "bulk";
  return "maintain";
}
function computeTargets() {
  if (!profile) return null;
  const w = Number(profile.weight) || 0;
  const h = Number(profile.height) || 0;
  const a = Number(profile.age) || 0;
  if (!w || !h || !a) return null;
  const offset = profile.gender === "男性" ? 5 : profile.gender === "女性" ? -161 : -78;
  const bmr = 10 * w + 6.25 * h - 5 * a + offset;
  const tdee = bmr * activityFactor();
  const gt = goalType();
  const adj = gt === "cut" ? 0.82 : gt === "bulk" ? 1.12 : 1.0;
  const cal = Math.max(1200, Math.round((tdee * adj) / 10) * 10);
  const pPerKg = gt === "cut" ? 2.2 : gt === "bulk" ? 2.0 : 1.6;
  const p = Math.round(w * pPerKg);
  const f = Math.round((cal * 0.25) / 9);
  const c = Math.max(0, Math.round((cal - p * 4 - f * 9) / 4));
  return { cal, p, f, c, goalType: gt };
}

// ---- 集計ヘルパー ----
function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function mealDateVal() {
  return val("mealDate") || todayStr();
}
function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}
function itemCal(m) {
  return Math.round((Number(m.cal) || 0) * (Number(m.qty) || 1));
}
function itemMacro(m, k) {
  return (Number(m[k]) || 0) * (Number(m.qty) || 1);
}
function slotMeals(date, slot) {
  return meals.filter((m) => m.date === date && m.slot === slot);
}
function dayTotals(date) {
  return meals
    .filter((m) => m.date === date)
    .reduce(
      (t, m) => {
        t.cal += itemCal(m);
        t.p += itemMacro(m, "p");
        t.f += itemMacro(m, "f");
        t.c += itemMacro(m, "c");
        return t;
      },
      { cal: 0, p: 0, f: 0, c: 0 }
    );
}

// 既存の呼び出し元（hydrateForApp / renderDashboard / showScreen）が使う統合レンダラ
function renderMeals() {
  renderCalorieSummary();
  renderMealSlots();
  renderDashboardMeals();
}

function renderCalorieSummary() {
  const totalEl = document.getElementById("caloTotal");
  if (!totalEl) return;
  const totals = dayTotals(mealDateVal());
  const targets = computeTargets();

  totalEl.textContent = totals.cal;
  document.getElementById("caloGoal").textContent = targets ? targets.cal : "—";

  const fillEl = document.getElementById("caloBarFill");
  const statusEl = document.getElementById("caloStatus");
  if (targets) {
    const pct = Math.min(100, Math.round((totals.cal / targets.cal) * 100));
    fillEl.style.width = pct + "%";
    const over = totals.cal > targets.cal;
    fillEl.classList.toggle("over", over);
    const diff = Math.abs(targets.cal - totals.cal);
    statusEl.innerHTML = over
      ? `目標より <strong>${diff}</strong> kcal オーバー`
      : `目標まで あと <strong>${diff}</strong> kcal（不足）`;
    statusEl.classList.toggle("over", over);
  } else {
    fillEl.style.width = "0%";
    statusEl.textContent = "プロフィールを登録すると、目標カロリーを自動計算します。";
    statusEl.classList.remove("over");
  }
  renderPfc(totals, targets);
}

function renderPfc(totals, targets) {
  const grid = document.getElementById("pfcGrid");
  if (!grid) return;
  const rows = [
    { name: "P たんぱく質", cls: "p", cur: Math.round(totals.p), tgt: targets ? targets.p : null },
    { name: "F 脂質", cls: "f", cur: Math.round(totals.f), tgt: targets ? targets.f : null },
    { name: "C 炭水化物", cls: "c", cur: Math.round(totals.c), tgt: targets ? targets.c : null },
  ];
  grid.innerHTML = rows
    .map((r) => {
      const pct = r.tgt ? Math.min(100, Math.round((r.cur / r.tgt) * 100)) : 0;
      const label = r.tgt != null ? `${r.cur} / ${r.tgt} g` : `${r.cur} g`;
      return `
      <div class="pfc-row">
        <div class="pfc-top"><span class="pfc-name">${r.name}</span><span class="pfc-val">${label}</span></div>
        <div class="pfc-bar"><span class="pfc-fill ${r.cls}" style="width:${pct}%"></span></div>
      </div>`;
    })
    .join("");
}

function renderMealSlots() {
  const wrap = document.getElementById("mealSlots");
  if (!wrap) return;
  const date = mealDateVal();

  wrap.innerHTML = MEAL_SLOTS.map((slot) => {
    const items = slotMeals(date, slot.key);
    const slotCal = items.reduce((s, m) => s + itemCal(m), 0);

    const itemsHtml = items.length
      ? items
          .map(
            (m) => `
        <div class="meal-item">
          <div class="mi-main">
            <span class="mi-name">${escapeHtml(m.name)}</span>
            <span class="mi-macros">P ${round1(itemMacro(m, "p"))} ・ F ${round1(itemMacro(m, "f"))} ・ C ${round1(itemMacro(m, "c"))} g</span>
          </div>
          <div class="mi-qty">
            <button class="qty-btn" data-qty="dec" data-mid="${m.id}" aria-label="減らす">−</button>
            <span class="qty-val">${m.qty}${escapeHtml(m.unit || "")}</span>
            <button class="qty-btn" data-qty="inc" data-mid="${m.id}" aria-label="増やす">＋</button>
          </div>
          <span class="mi-cal">${itemCal(m)}<small>kcal</small></span>
          <button class="mi-del" data-del="${m.id}" aria-label="削除"><svg class="icon"><use href="#i-trash" /></svg></button>
        </div>`
          )
          .join("")
      : `<p class="slot-empty">まだ記録がありません。</p>`;

    return `
    <div class="panel meal-slot">
      <div class="slot-head">
        <span class="slot-name">${slot.label}</span>
        <span class="slot-cal">${slotCal}<small>kcal</small></span>
      </div>
      <div class="slot-items">${itemsHtml}</div>
      <button class="slot-add" data-add-food="${slot.key}"><svg class="icon"><use href="#i-plus" /></svg>食品を追加</button>
    </div>`;
  }).join("");
}

function renderDashboardMeals() {
  const box = document.getElementById("dashboardMeals");
  if (!box) return;
  if (!meals.length) {
    box.innerHTML = `<p class="lead">食事記録はまだありません。</p>`;
    return;
  }
  const sorted = [...meals].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  box.innerHTML = sorted
    .slice(0, 40)
    .map(
      (m) => `
    <div class="list-item">
      <strong>${escapeHtml(m.date)} ・ ${escapeHtml(SLOT_LABEL[m.slot] || "食事")} / ${escapeHtml(m.name)}</strong>
      <div class="meta">${itemCal(m)}kcal ・ P${round1(itemMacro(m, "p"))} F${round1(itemMacro(m, "f"))} C${round1(itemMacro(m, "c"))}g ・ ×${m.qty}</div>
    </div>`
    )
    .join("");
}

// ---- 食品検索モーダル ----
function openFoodModal(slotKey) {
  foodModalSlot = slotKey;
  foodModalCat = "すべて";
  foodModalQuery = "";
  const title = document.getElementById("foodModalTitle");
  if (title) title.textContent = `${SLOT_LABEL[slotKey]}に食品を追加`;
  setVal("foodSearch", "");
  renderFoodCats();
  renderFoodResults();
  const modal = document.getElementById("foodModal");
  if (modal) modal.hidden = false;
  document.body.classList.add("modal-open");
  const s = document.getElementById("foodSearch");
  if (s) setTimeout(() => s.focus(), 60);
}
function closeFoodModal() {
  const modal = document.getElementById("foodModal");
  if (modal) modal.hidden = true;
  if (!document.querySelector(".ex-modal:not([hidden])")) document.body.classList.remove("modal-open");
}
function renderFoodCats() {
  const box = document.getElementById("foodCats");
  if (!box) return;
  box.innerHTML = FOOD_CATS.map(
    (c) => `<button type="button" class="food-cat${c === foodModalCat ? " active" : ""}" data-food-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join("");
}
function filteredFoods() {
  const q = foodModalQuery.trim();
  return FOODS.filter((f) => {
    const catOk = foodModalCat === "すべて" || f.cat === foodModalCat;
    const qOk = !q || f.name.indexOf(q) >= 0 || f.cat.indexOf(q) >= 0;
    return catOk && qOk;
  });
}
function renderFoodResults() {
  const box = document.getElementById("foodResults");
  if (!box) return;
  const list = filteredFoods();
  if (!list.length) {
    box.innerHTML = `<p class="slot-empty">該当する食品がありません。下の手入力から追加できます。</p>`;
    return;
  }
  const inSlot = new Set(slotMeals(mealDateVal(), foodModalSlot).map((m) => m.name));
  box.innerHTML = list
    .map((f) => {
      const idx = FOODS.indexOf(f);
      const added = inSlot.has(f.name);
      return `
    <button type="button" class="food-row${added ? " added" : ""}" data-food-idx="${idx}">
      <span class="fr-main">
        <span class="fr-name">${escapeHtml(f.name)}</span>
        <span class="fr-sub">${escapeHtml(f.cat)} ・ P${f.p} F${f.f} C${f.c}</span>
      </span>
      <span class="fr-cal">${f.cal}<small>kcal</small></span>
      <span class="fr-add"><svg class="icon"><use href="#i-${added ? "check" : "plus"}" /></svg></span>
    </button>`;
    })
    .join("");
}
function addFoodToSlot(food) {
  const date = mealDateVal();
  const existing = meals.find((m) => m.date === date && m.slot === foodModalSlot && m.name === food.name);
  if (existing) {
    existing.qty = (Number(existing.qty) || 1) + 1;
  } else {
    meals.push({
      id: Date.now() + Math.floor(Math.random() * 1000),
      date,
      slot: foodModalSlot,
      name: food.name,
      cal: Number(food.cal) || 0,
      p: Number(food.p) || 0,
      f: Number(food.f) || 0,
      c: Number(food.c) || 0,
      unit: food.unit || "",
      qty: 1,
    });
  }
  saveState();
  renderFoodResults();
  renderMealSlots();
  renderCalorieSummary();
}
function addCustomFood() {
  const name = val("customFoodName").trim();
  const cal = Number(val("customFoodCal"));
  if (!name || !cal) {
    alert("食品名とカロリーを入力してください。");
    return;
  }
  addFoodToSlot({
    name,
    cal,
    p: Number(val("customFoodP")) || 0,
    f: Number(val("customFoodF")) || 0,
    c: Number(val("customFoodC")) || 0,
    unit: "",
  });
  ["customFoodName", "customFoodCal", "customFoodP", "customFoodF", "customFoodC"].forEach((id) => setVal(id, ""));
}
function changeMealQty(id, delta) {
  const m = meals.find((x) => String(x.id) === String(id));
  if (!m) return;
  const next = (Number(m.qty) || 1) + delta;
  if (next < 1) meals = meals.filter((x) => String(x.id) !== String(id));
  else m.qty = next;
  saveState();
  renderMeals();
}
function removeMeal(id) {
  meals = meals.filter((x) => String(x.id) !== String(id));
  saveState();
  renderMeals();
}
function shiftMealDate(delta) {
  const input = document.getElementById("mealDate");
  if (!input) return;
  const d = new Date((input.value || todayStr()) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  input.value = d.toISOString().split("T")[0];
  renderMeals();
}

function setupMealScreen() {
  const dateInput = document.getElementById("mealDate");
  if (dateInput) dateInput.addEventListener("change", renderMeals);
  const prev = document.getElementById("mealPrevDay");
  const next = document.getElementById("mealNextDay");
  if (prev) prev.addEventListener("click", () => shiftMealDate(-1));
  if (next) next.addEventListener("click", () => shiftMealDate(1));

  // 摂取カロリー / PFC タブ
  document.querySelectorAll("[data-calotab]").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll("[data-calotab]").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll("[data-caloview]").forEach((v) => {
        v.hidden = v.getAttribute("data-caloview") !== t.dataset.calotab;
      });
    });
  });

  // スロットの操作（イベント委譲）
  const slots = document.getElementById("mealSlots");
  if (slots) {
    slots.addEventListener("click", (e) => {
      const addBtn = e.target.closest("[data-add-food]");
      if (addBtn) return openFoodModal(addBtn.dataset.addFood);
      const qBtn = e.target.closest("[data-qty]");
      if (qBtn) return changeMealQty(qBtn.dataset.mid, qBtn.dataset.qty === "inc" ? 1 : -1);
      const delBtn = e.target.closest("[data-del]");
      if (delBtn) return removeMeal(delBtn.dataset.del);
    });
  }

  // 食品検索モーダル
  const search = document.getElementById("foodSearch");
  if (search) search.addEventListener("input", () => { foodModalQuery = search.value; renderFoodResults(); });
  const cats = document.getElementById("foodCats");
  if (cats) {
    cats.addEventListener("click", (e) => {
      const b = e.target.closest("[data-food-cat]");
      if (!b) return;
      foodModalCat = b.dataset.foodCat;
      renderFoodCats();
      renderFoodResults();
    });
  }
  const results = document.getElementById("foodResults");
  if (results) {
    results.addEventListener("click", (e) => {
      const row = e.target.closest("[data-food-idx]");
      if (!row) return;
      const food = FOODS[Number(row.dataset.foodIdx)];
      if (food) addFoodToSlot(food);
    });
  }
  const customBtn = document.getElementById("customFoodAdd");
  if (customBtn) customBtn.addEventListener("click", addCustomFood);

  const closeBtn = document.getElementById("foodModalClose");
  if (closeBtn) closeBtn.addEventListener("click", closeFoodModal);
  const backdrop = document.querySelector("#foodModal .ex-modal-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeFoodModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("foodModal").hidden) closeFoodModal();
  });
}

// ======================================================
// 筋トレ記録
// ======================================================

// ---- 部位カラー（人体図ハイライト & ラベル色）----
const PART_COLOR = {
  "胸": ["#ff6b5a", "rgba(255,107,90,0.45)"],
  "背中": ["#35e2cd", "rgba(53,226,205,0.45)"],
  "肩": ["#7f97d9", "rgba(127,151,217,0.5)"],
  "腕": ["#e8b34b", "rgba(232,179,75,0.5)"],
  "脚": ["#8fd14f", "rgba(143,209,79,0.5)"],
  "腹筋・体幹": ["#c58bff", "rgba(197,139,255,0.5)"],
  "有酸素": ["#ff5da2", "rgba(255,93,162,0.5)"],
};
const PART_CLASS = {
  "胸": "pc-chest", "背中": "pc-back", "肩": "pc-shoulder", "腕": "pc-arm",
  "脚": "pc-leg", "腹筋・体幹": "pc-core", "有酸素": "pc-cardio", "全身": "pc-all",
};

const exState = { q: "", chip: "all", sort: "freq", sel: new Set() };
let exModalId = null;

function exReady() {
  return typeof EXERCISE_DB !== "undefined" && Array.isArray(EXERCISE_DB);
}
function exById(id) {
  return EXERCISE_DB.find((e) => e.id === id);
}
function exFreqMap() {
  const m = {};
  workouts.forEach((w) => { m[w.name] = (m[w.name] || 0) + 1; });
  return m;
}
function exIsCardio(ex) {
  return ex.e === "cd" || ex.c === "有酸素";
}

// 人体図：対象筋肉をCSS変数でハイライト（主働筋=濃 / 補助筋=淡）
function figStyle(ex) {
  const col = PART_COLOR[ex.c] || PART_COLOR["胸"];
  return (ex.m || []).map((k, i) => `--m-${k}:${i === 0 ? col[0] : col[1]}`).join(";");
}
function figSvg(ex) {
  const href = ex.view === "back" ? "#fig-back" : "#fig-front";
  return `<svg viewBox="0 0 120 240" style="${figStyle(ex)}" aria-hidden="true"><use href="${href}"></use></svg>`;
}

// ---- フィルタチップ ----
function renderExChips() {
  const box = document.getElementById("exChips");
  if (!box || !exReady()) return;
  const chips = [
    { k: "bm", label: `<svg class="icon"><use href="#i-book"></use></svg>`, title: "ブックマーク" },
    { k: "all", label: "すべて" },
  ].concat(EXERCISE_CATS.map((c) => ({ k: c, label: c })));
  box.innerHTML = chips
    .map((c) => `<button type="button" class="ex-chip${c.k === "bm" ? " ex-chip-bm" : ""}${exState.chip === c.k ? " active" : ""}" data-chip="${c.k}"${c.title ? ` aria-label="${c.title}"` : ""}>${c.label}</button>`)
    .join("");
}

// ---- 絞り込み＆並び替え ----
function exFiltered() {
  const q = exState.q.trim();
  const freq = exFreqMap();
  let list = EXERCISE_DB.filter((ex) => {
    if (exState.chip === "bm" && !bookmarks.includes(ex.id)) return false;
    if (exState.chip !== "bm" && exState.chip !== "all" && ex.c !== exState.chip) return false;
    if (q && !(ex.n.includes(q) || ex.s.includes(q) || ex.c.includes(q))) return false;
    return true;
  }).slice();
  if (exState.sort === "name") {
    list.sort((a, b) => a.n.localeCompare(b.n, "ja"));
  } else {
    list.sort((a, b) => (freq[b.n] || 0) - (freq[a.n] || 0) || a.n.localeCompare(b.n, "ja"));
  }
  return { list, freq };
}

// ---- 種目リスト描画 ----
function renderExList() {
  const box = document.getElementById("exList");
  if (!box || !exReady()) return;
  const { list, freq } = exFiltered();

  const cnt = document.getElementById("exCount");
  if (cnt) cnt.textContent = `${list.length} / 全${EXERCISE_DB.length}種目`;

  const customRow = document.getElementById("exCustomRow");
  const customBtn = document.getElementById("exCustomAdd");
  const q = exState.q.trim();
  if (customRow && customBtn) {
    if (q && list.length === 0) {
      customRow.hidden = false;
      customBtn.textContent = `「${q}」をカスタム種目として追加`;
    } else {
      customRow.hidden = true;
    }
  }

  if (list.length === 0) {
    box.innerHTML = `<p class="lead ex-empty">${q ? "見つかりませんでした。" : "該当する種目がありません。"}</p>`;
    updateSelInfo();
    return;
  }

  box.innerHTML = list
    .map((ex) => {
      const f = freq[ex.n] || 0;
      const bm = bookmarks.includes(ex.id);
      const checked = exState.sel.has(ex.id);
      return `<div class="ex-row${checked ? " checked" : ""}" data-id="${ex.id}">
        <input type="checkbox" class="ex-check" ${checked ? "checked" : ""} aria-label="${escapeHtml(ex.n)}を選択" />
        <span class="ex-tile">${figSvg(ex)}</span>
        <span class="ex-main">
          <span class="ex-part ${PART_CLASS[ex.c] || ""}">${escapeHtml(ex.c)}</span>
          <span class="ex-nm">${escapeHtml(ex.n)}</span>
          <small>${escapeHtml(ex.s)} ・ ${escapeHtml(EQ_LABEL[ex.e] || "")}</small>
        </span>
        <span class="ex-freq">${f || ""}</span>
        <button type="button" class="ex-ic ex-bm${bm ? " on" : ""}" data-act="bm" aria-label="ブックマーク"><svg class="icon"><use href="#i-book"></use></svg></button>
        <button type="button" class="ex-ic" data-act="info" aria-label="詳細"><svg class="icon"><use href="#i-info"></use></svg></button>
      </div>`;
    })
    .join("");
  updateSelInfo();
}

function updateSelInfo() {
  const n = exState.sel.size;
  const info = document.getElementById("exSelInfo");
  if (info) info.textContent = `${n}件 選択中`;
  const btn = document.getElementById("addSelectedButton");
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n ? `選択した${n}種目を追加する` : "トレーニングを追加する";
  }
}

// ---- ブックマーク ----
function toggleBookmark(id) {
  const i = bookmarks.indexOf(id);
  if (i >= 0) bookmarks.splice(i, 1);
  else bookmarks.push(id);
  saveState();
  renderExList();
  if (exModalId === id) syncModalBookmark();
}

// ---- 記録待ち（SESSION）----
function renderPending() {
  const box = document.getElementById("pendingList");
  if (!box) return;
  if (pendingEntries.length === 0) {
    box.innerHTML = `<p class="lead">ライブラリから種目を選んで「追加」してください。</p>`;
    return;
  }
  box.innerHTML = pendingEntries
    .map((p) => {
      const partSel = p.custom
        ? `<label class="pend-partlabel">部位<select class="pend-part">${["全身"].concat(EXERCISE_CATS).map((c) => `<option${c === p.part ? " selected" : ""}>${c}</option>`).join("")}</select></label>`
        : "";
      const inputs = p.kind === "c"
        ? `<label>時間 <span class="unit">分</span><input type="number" class="pend-min" min="1" placeholder="30" /></label>`
        : `<label>重量 <span class="unit">kg・任意</span><input type="number" class="pend-w" min="0" placeholder="自重は空欄" /></label>
           <label>回数<input type="number" class="pend-r" min="1" placeholder="10" /></label>
           <label>セット<input type="number" class="pend-s" min="1" placeholder="3" /></label>`;
      return `<div class="pend-item" data-pid="${p.pid}">
        <div class="pend-top">
          <div><span class="ex-part ${PART_CLASS[p.part] || ""}">${escapeHtml(p.part)}</span> <strong>${escapeHtml(p.name)}</strong></div>
          <button type="button" class="ex-ic pend-del" aria-label="削除"><svg class="icon"><use href="#i-close"></use></svg></button>
        </div>
        ${partSel}
        <div class="pend-inputs${p.kind === "c" ? " is-cardio" : ""}">${inputs}</div>
        <div class="pend-actions"><button type="button" class="small-btn pend-save">この種目を記録</button></div>
      </div>`;
    })
    .join("");
}

function savePending(pid, silent) {
  const p = pendingEntries.find((x) => x.pid === pid);
  const card = document.querySelector(`.pend-item[data-pid="${pid}"]`);
  if (!p || !card) return false;
  const date = val("workoutDate") || new Date().toISOString().split("T")[0];
  let entry;
  if (p.kind === "c") {
    const min = Number(card.querySelector(".pend-min").value);
    if (!min) { if (!silent) alert(`${p.name}：時間（分）を入力してください。`); return false; }
    entry = { id: Date.now() + Math.random(), date, name: p.name, bodyPart: p.part, kind: "c", minutes: min };
  } else {
    const w = Number(card.querySelector(".pend-w").value) || 0;
    const r = Number(card.querySelector(".pend-r").value);
    const s = Number(card.querySelector(".pend-s").value) || 1;
    if (!r) { if (!silent) alert(`${p.name}：回数を入力してください。`); return false; }
    entry = { id: Date.now() + Math.random(), date, name: p.name, bodyPart: p.part, kind: "w", weight: w, reps: r, sets: s };
  }
  workouts.unshift(entry);
  saveState();
  pendingEntries = pendingEntries.filter((x) => x.pid !== pid);
  renderPending();
  renderWorkouts();
  renderExList(); // 頻度カウント更新
  return true;
}

// ---- 詳細モーダル ----
function openExModal(id) {
  const ex = exById(id);
  const modal = document.getElementById("exModal");
  if (!ex || !modal) return;
  exModalId = id;

  document.getElementById("exmName").textContent = ex.n;
  const part = document.getElementById("exmPart");
  part.textContent = `${ex.c} ｜ ${ex.s}`;
  part.className = "exm-part " + (PART_CLASS[ex.c] || "");

  const fig = document.getElementById("exmFig");
  fig.setAttribute("style", figStyle(ex));
  document.getElementById("exmFigUse").setAttribute("href", ex.view === "back" ? "#fig-back" : "#fig-front");

  document.getElementById("exmMeta").innerHTML = [
    `器具：${EQ_LABEL[ex.e] || "-"}`,
    `記録：${exIsCardio(ex) ? "時間（分）" : "重量（任意）× 回数 × セット"}`,
  ].map((t) => `<span class="exm-chip">${escapeHtml(t)}</span>`).join("");

  document.getElementById("exmMuscles").innerHTML = (ex.m || [])
    .map((k, i) => `<span class="exm-mchip${i === 0 ? " main" : ""}">${escapeHtml(MUSCLE_LABEL[k] || k)}</span>`)
    .join("");

  document.getElementById("exmDesc").textContent = ex.d || "";
  document.getElementById("exmYt").href = `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.n + " やり方 フォーム")}`;
  document.getElementById("exmGg").href = `https://www.google.com/search?q=${encodeURIComponent(ex.n + " 筋トレ 効果 やり方")}`;

  syncModalBookmark();
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function syncModalBookmark() {
  const b = document.getElementById("exmBookmark");
  if (!b || exModalId == null) return;
  const on = bookmarks.includes(exModalId);
  b.textContent = on ? "★ ブックマーク済み（タップで解除）" : "ブックマークに追加";
  b.classList.toggle("on", on);
}

function closeExModal() {
  const modal = document.getElementById("exModal");
  if (modal) modal.hidden = true;
  exModalId = null;
  document.body.classList.remove("modal-open");
}

// ---- イベント配線 ----
function setupExercisePicker() {
  const search = document.getElementById("exSearch");
  const sort = document.getElementById("exSort");
  const chips = document.getElementById("exChips");
  const list = document.getElementById("exList");
  if (!search || !list || !exReady()) return;

  search.addEventListener("input", () => { exState.q = search.value; renderExList(); });
  sort.addEventListener("change", () => { exState.sort = sort.value; renderExList(); });

  chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    exState.chip = b.dataset.chip;
    renderExChips();
    renderExList();
  });

  // 行クリック＝選択トグル / ブックマーク / 詳細
  list.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    const row = e.target.closest(".ex-row");
    if (!row) return;
    const id = row.dataset.id;
    if (act) {
      if (act.dataset.act === "bm") { toggleBookmark(id); return; }
      if (act.dataset.act === "info") { openExModal(id); return; }
    }
    if (exState.sel.has(id)) exState.sel.delete(id);
    else exState.sel.add(id);
    const cb = row.querySelector(".ex-check");
    if (cb) cb.checked = exState.sel.has(id);
    row.classList.toggle("checked", exState.sel.has(id));
    updateSelInfo();
  });

  // 選択した種目を記録待ちへ
  document.getElementById("addSelectedButton").addEventListener("click", () => {
    if (exState.sel.size === 0) return;
    exState.sel.forEach((id) => {
      const ex = exById(id);
      if (!ex) return;
      pendingEntries.push({
        pid: makeId("p_"), exId: ex.id, name: ex.n, part: ex.c, sub: ex.s,
        kind: exIsCardio(ex) ? "c" : "w", custom: false,
      });
    });
    exState.sel.clear();
    renderExList();
    renderPending();
    const pl = document.getElementById("pendingList");
    if (pl) pl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // カスタム種目（検索ヒットなし時）
  document.getElementById("exCustomAdd").addEventListener("click", () => {
    const name = exState.q.trim();
    if (!name) return;
    pendingEntries.push({ pid: makeId("p_"), exId: null, name, part: "全身", sub: "カスタム", kind: "w", custom: true });
    exState.q = "";
    search.value = "";
    renderExList();
    renderPending();
  });

  // 記録待ちカード操作
  document.getElementById("pendingList").addEventListener("click", (e) => {
    const card = e.target.closest(".pend-item");
    if (!card) return;
    const pid = card.dataset.pid;
    if (e.target.closest(".pend-del")) {
      pendingEntries = pendingEntries.filter((x) => x.pid !== pid);
      renderPending();
      return;
    }
    if (e.target.closest(".pend-save")) savePending(pid, false);
  });
  document.getElementById("pendingList").addEventListener("change", (e) => {
    const sel = e.target.closest(".pend-part");
    if (!sel) return;
    const card = e.target.closest(".pend-item");
    const p = pendingEntries.find((x) => x.pid === card.dataset.pid);
    if (p) p.part = sel.value;
  });

  document.getElementById("saveAllPendingButton").addEventListener("click", () => {
    if (pendingEntries.length === 0) return;
    const pids = pendingEntries.map((p) => p.pid);
    let saved = 0;
    pids.forEach((pid) => { if (savePending(pid, true)) saved += 1; });
    if (saved === 0) alert("入力が未完了の種目があります。回数（有酸素は分）を入力してください。");
  });

  // モーダル
  document.getElementById("exmClose").addEventListener("click", closeExModal);
  document.querySelector("#exModal .ex-modal-backdrop").addEventListener("click", closeExModal);
  document.getElementById("exmBookmark").addEventListener("click", () => { if (exModalId) toggleBookmark(exModalId); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("exModal").hidden) closeExModal();
  });
}

function renderWorkouts() {
  const latest = document.getElementById("latestWorkouts");
  const dashboard = document.getElementById("dashboardWorkouts");

  const html =
    workouts.length === 0
      ? `<p class="lead">筋トレ記録はまだありません。</p>`
      : workouts
          .map((workout) => {
            const meta =
              workout.kind === "c"
                ? `${escapeHtml(workout.bodyPart)} / 有酸素 ${Number(workout.minutes) || 0}分`
                : `${escapeHtml(workout.bodyPart)} / ${Number(workout.weight) ? `${Number(workout.weight)}kg` : "自重"} × ${Number(workout.reps) || 0}回 × ${Number(workout.sets) || 0}セット`;
            return `
      <div class="list-item">
        <strong>${escapeHtml(workout.date)} / ${escapeHtml(workout.name)}</strong>
        <div class="meta">${meta}</div>
      </div>
    `;
          })
          .join("");

  if (latest) latest.innerHTML = html;
  if (dashboard) dashboard.innerHTML = html;
}

// ======================================================
// ダッシュボード
// ======================================================

function renderDashboard() {
  const mc = document.getElementById("mealCount");
  const wc = document.getElementById("workoutCount");
  const is = document.getElementById("idealSummary");
  if (mc) mc.textContent = `${meals.length}件`;
  if (wc) wc.textContent = `${workouts.length}件`;
  if (is) is.textContent = selectedIdeal ? selectedIdeal.label : "未選択";

  renderMeals();
  renderWorkouts();
}

function setupFeedback() {
  document.getElementById("generateFeedbackButton").addEventListener("click", () => {
    const date = todayStr();
    const totals = dayTotals(date);
    const targets = computeTargets();
    const latestWorkout = workouts[0];

    let feedback = "【今日の簡易フィードバック】\n\n";
    if (profile) feedback += `目標：${profile.goal}\n`;
    if (selectedIdeal) feedback += `理想体型：${selectedIdeal.label}\n`;
    if (targets) feedback += `目標カロリー：${targets.cal}kcal（P${targets.p} / F${targets.f} / C${targets.c}g）\n`;
    feedback += "\n";

    if (totals.cal === 0) {
      feedback += "食事：今日の記録がまだありません。まずは1品、朝食から記録してみましょう。\n";
    } else {
      feedback += `食事：今日は ${totals.cal}kcal（P${Math.round(totals.p)} / F${Math.round(totals.f)} / C${Math.round(totals.c)}g）を記録できています。\n`;
      if (targets) {
        const diff = targets.cal - totals.cal;
        if (diff > 300) feedback += `目標まであと約${diff}kcal。エネルギー不足に注意し、あと1〜2品足すと良いです。\n`;
        else if (diff < -300) feedback += `目標を約${-diff}kcal超えています。夜の間食を控えるなど微調整しましょう。\n`;
        else feedback += "摂取カロリーは目標に近く、良いバランスです。\n";
        if (totals.p < targets.p * 0.8) feedback += "タンパク質が目標より不足気味です。鶏むね・卵・プロテインなどを追加しましょう。\n";
        else feedback += "タンパク質はしっかり摂れています。\n";
      }
    }

    if (latestWorkout) {
      feedback += `筋トレ：${latestWorkout.name}を記録できています。継続のために記録を残すのは良い習慣です。\n`;
    } else {
      feedback += "筋トレ：記録がまだないため、今日は1種目だけでも記録してみましょう。\n";
    }

    feedback += "\n明日の行動目標：\n";
    const gt = goalType();
    if (gt === "cut") feedback += "摂取カロリーを目標内に抑えつつ、タンパク質を確保しましょう。";
    else if (gt === "bulk") feedback += "目標カロリーを下回らないよう食事を確保し、扱う重量を少しずつ伸ばしましょう。";
    else feedback += "食事・運動のバランスを保ち、無理なく記録を継続しましょう。";

    document.getElementById("feedbackBox").textContent = feedback;
  });
}

// ======================================================
// 掲示板（端末内で共有・投稿者のみ削除可）
// ======================================================

function setupCommunity() {
  document.getElementById("addPostButton").addEventListener("click", () => {
    const u = currentUser();
    const post = {
      id: Date.now(),
      userId: u ? u.id : null,
      name: val("postName") || (u ? u.name : "匿名ユーザー"),
      category: val("postCategory"),
      content: val("postContent"),
      likes: 0,
      createdAt: new Date().toLocaleString("ja-JP"),
    };

    if (!post.content) {
      alert("投稿内容を入力してください。");
      return;
    }

    posts.unshift(post);
    savePosts();

    setVal("postContent", "");
    renderPosts();
  });
}

function renderPosts() {
  const list = document.getElementById("postList");
  if (!list) return;

  const u = currentUser();

  if (posts.length === 0) {
    list.innerHTML = `<p class="lead">投稿はまだありません。</p>`;
    return;
  }

  list.innerHTML = posts
    .map((post) => {
      const own = u && post.userId === u.id;
      return `
    <div class="list-item">
      <strong>${escapeHtml(post.name)} / ${escapeHtml(post.category)}</strong>
      <div class="meta">${escapeHtml(post.createdAt)}</div>
      <p>${escapeHtml(post.content)}</p>
      <button class="small-btn" onclick="likePost(${post.id})">いいね ${post.likes}</button>
      ${own ? `<button class="small-btn" onclick="deletePost(${post.id})">削除</button>` : ""}
    </div>
  `;
    })
    .join("");
}

function likePost(id) {
  posts = posts.map((post) => (post.id === id ? { ...post, likes: post.likes + 1 } : post));
  savePosts();
  renderPosts();
}

function deletePost(id) {
  const u = currentUser();
  const target = posts.find((p) => p.id === id);
  if (!target) return;
  if (!u || target.userId !== u.id) {
    alert("自分の投稿のみ削除できます。");
    return;
  }
  if (!confirm("この投稿を削除しますか？")) return;

  posts = posts.filter((post) => post.id !== id);
  savePosts();
  renderPosts();
}

// ======================================================
// 設定・データ管理
// ======================================================

function renderSettings() {
  const u = currentUser();
  if (!u) return;
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("settingsName", u.name);
  set("settingsEmail", u.email);
  set("settingsCreated", new Date(u.createdAt).toLocaleString("ja-JP"));
  set("settingsMealCount", `${meals.length}件`);
  set("settingsWorkoutCount", `${workouts.length}件`);
}

function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeName(str) {
  return String(str || "user").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function exportMyData() {
  const u = currentUser();
  if (!u) return;
  const payload = {
    app: "BodyMake Support",
    version: "0.4",
    exportedAt: new Date().toISOString(),
    account: { name: u.name, email: u.email, createdAt: u.createdAt, consentedAt: u.consentedAt },
    data: { profile, selectedIdeal, meals, workouts, bodyPhoto },
  };
  downloadFile(`bodymake_${safeName(u.email)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function importMyData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const d = parsed && parsed.data ? parsed.data : null;
      if (!d) throw new Error("no data");

      if (!confirm("読み込んだ内容で、現在ログイン中のアカウントのデータを上書きします。よろしいですか？")) {
        e.target.value = "";
        return;
      }

      profile = d.profile || null;
      selectedIdeal = d.selectedIdeal || null;
      meals = Array.isArray(d.meals) ? d.meals : [];
      workouts = Array.isArray(d.workouts) ? d.workouts : [];
      bodyPhoto = d.bodyPhoto || null;

      saveState();
      savePhoto();
      alert("データを読み込みました。");
      route();
    } catch (err) {
      alert("ファイルの読み込みに失敗しました。JSON形式（このアプリで書き出したファイル）を確認してください。");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const rows = [["type", "date", "name", "detail1", "detail2", "detail3", "memo"]];
  meals.forEach((m) => {
    rows.push(["meal", m.date, `${SLOT_LABEL[m.slot] || ""} ${m.name}`.trim(), `${itemCal(m)}kcal`, `x${m.qty}`, `P${round1(itemMacro(m, "p"))} F${round1(itemMacro(m, "f"))} C${round1(itemMacro(m, "c"))}`, ""]);
  });
  workouts.forEach((w) => {
    if (w.kind === "c") {
      rows.push(["workout", w.date, w.name, w.bodyPart, `${Number(w.minutes) || 0}min`, "", ""]);
    } else {
      rows.push(["workout", w.date, w.name, w.bodyPart, Number(w.weight) ? `${Number(w.weight)}kg` : "bodyweight", `${Number(w.reps) || 0}x${Number(w.sets) || 0}`, ""]);
    }
  });
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const u = currentUser();
  downloadFile(`bodymake_log_${safeName(u ? u.email : "user")}.csv`, "\uFEFF" + csv, "text/csv;charset=utf-8");
}

function setupSettings() {
  document.getElementById("logoutButton").addEventListener("click", () => {
    clearSession();
    clearUserState();
    route();
  });

  document.getElementById("exportDataButton").addEventListener("click", exportMyData);
  document.getElementById("exportCsvButton").addEventListener("click", exportCsv);
  document.getElementById("importDataInput").addEventListener("change", importMyData);

  document.getElementById("deleteDataButton").addEventListener("click", () => {
    const u = currentUser();
    if (!u) return;
    if (!confirm("あなたのプロフィール・写真・記録をすべて削除します（アカウントは残ります）。よろしいですか？")) return;
    DB.set(K.userData(u.id), { profile: null, selectedIdeal: null, meals: [], workouts: [] });
    DB.remove(K.userPhoto(u.id));
    clearUserState();
    alert("記録データを削除しました。");
    route();
  });

  document.getElementById("deleteAccountButton").addEventListener("click", () => {
    const u = currentUser();
    if (!u) return;
    if (!confirm("このアカウントと保存データを完全に削除します。元に戻せません。削除しますか？")) return;
    DB.remove(K.userData(u.id));
    DB.remove(K.userPhoto(u.id));
    setUsers(getUsers().filter((x) => x.id !== u.id));
    clearSession();
    clearUserState();
    alert("アカウントを削除しました。");
    route();
  });

  document.getElementById("resetAllButton").addEventListener("click", () => {
    if (!confirm("【全データ初期化】この端末に保存された全アカウント・全記録・掲示板を削除します。元に戻せません。実行しますか？")) return;
    localStorage.clear();
    location.reload();
  });
}

// ======================================================
// テーマ切り替え（pop=ポップ / hud=クラシック）
// ======================================================

function applyTheme(theme) {
  const t = theme === "hud" ? "hud" : "pop";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("bm_theme", t); } catch (e) {}
  const label = document.getElementById("themeLabel");
  const emoji = document.getElementById("themeEmoji");
  if (label) label.textContent = t === "pop" ? "ポップ" : "クラシック";
  if (emoji) emoji.textContent = t === "pop" ? "🎨" : "🖥️";
}

function setupThemeToggle() {
  applyTheme(document.documentElement.dataset.theme || "pop");
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "pop" ? "hud" : "pop");
    });
  }
}

// ======================================================
// 初期化
// ======================================================

function init() {
  setupNavigationButtons();
  setupThemeToggle();
  setTodayToDateInputs();

  setupAuth();
  setupConsent();
  setupProfileForm();
  setupPhotoUpload();
  setupIdealSelection();
  setupMealScreen();
  setupExercisePicker();
  setupFeedback();
  setupCommunity();
  setupSettings();

  renderPosts();
  route();
}

init();
