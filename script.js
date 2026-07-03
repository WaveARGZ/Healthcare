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
}

// ======================================================
// 食事管理
// ======================================================

function setupMealForm() {
  document.getElementById("addMealButton").addEventListener("click", () => {
    const meal = {
      id: Date.now(),
      date: val("mealDate"),
      name: val("mealName"),
      calories: Number(val("mealCalories")),
      protein: Number(val("mealProtein")),
      memo: val("mealMemo"),
    };

    if (!meal.date || !meal.name || !meal.calories) {
      alert("日付・食事内容・摂取カロリーを入力してください。");
      return;
    }

    meals.unshift(meal);
    saveState();

    setVal("mealName", "");
    setVal("mealCalories", "");
    setVal("mealProtein", "");
    setVal("mealMemo", "");

    renderMeals();
    alert("食事を保存しました。");
  });
}

function renderMeals() {
  const latest = document.getElementById("latestMeals");
  const dashboard = document.getElementById("dashboardMeals");

  const html =
    meals.length === 0
      ? `<p class="lead">食事記録はまだありません。</p>`
      : meals
          .map(
            (meal) => `
      <div class="list-item">
        <strong>${escapeHtml(meal.date)} / ${escapeHtml(meal.name)}</strong>
        <div class="meta">${Number(meal.calories) || 0}kcal / タンパク質 ${Number(meal.protein) || 0}g</div>
        <p>${escapeHtml(meal.memo || "メモなし")}</p>
      </div>
    `
          )
          .join("");

  if (latest) latest.innerHTML = html;
  if (dashboard) dashboard.innerHTML = html;
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
    const latestMeal = meals[0];
    const latestWorkout = workouts[0];

    let feedback = "【今日の簡易フィードバック】\n\n";

    if (profile) feedback += `目標：${profile.goal}\n`;
    if (selectedIdeal) feedback += `理想体型：${selectedIdeal.label}\n\n`;

    if (!latestMeal && !latestWorkout) {
      feedback += "まだ記録がありません。まずは食事または筋トレを1つ記録してみましょう。";
      document.getElementById("feedbackBox").textContent = feedback;
      return;
    }

    if (latestMeal) {
      feedback += `食事：${latestMeal.name}を記録できています。\n`;
      if (latestMeal.protein >= 80) {
        feedback += "タンパク質量は良い意識ができています。\n";
      } else {
        feedback += "タンパク質が少なめの場合は、卵・鶏肉・魚・豆腐などを追加すると良いです。\n";
      }
    } else {
      feedback += "食事記録がないため、まずは摂取カロリーだけでも記録しましょう。\n";
    }

    if (latestWorkout) {
      feedback += `筋トレ：${latestWorkout.name}を記録できています。継続のために、重量・回数・セット数を残すのは良い習慣です。\n`;
    } else {
      feedback += "筋トレ記録がないため、今日は1種目だけでも記録してみましょう。\n";
    }

    feedback += "\n明日の行動目標：\n";

    if (selectedIdeal?.type === "cut") {
      feedback += "食事記録を継続し、摂取カロリーと歩数を意識しましょう。";
    } else if (selectedIdeal?.type === "bulk") {
      feedback += "筋トレ記録を継続し、タンパク質とトレーニング量を意識しましょう。";
    } else {
      feedback += "無理なく記録を続け、食事と運動のバランスを確認しましょう。";
    }

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
    rows.push(["meal", m.date, m.name, `${Number(m.calories) || 0}kcal`, `protein ${Number(m.protein) || 0}g`, "", m.memo || ""]);
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
// 初期化
// ======================================================

function init() {
  setupNavigationButtons();
  setTodayToDateInputs();

  setupAuth();
  setupConsent();
  setupProfileForm();
  setupPhotoUpload();
  setupIdealSelection();
  setupMealForm();
  setupExercisePicker();
  setupFeedback();
  setupCommunity();
  setupSettings();

  renderPosts();
  route();
}

init();
