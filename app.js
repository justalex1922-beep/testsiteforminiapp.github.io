const POINTS_PER_TAP = 1;

// Базовый URL для API. Если бэкенд крутится рядом с фронтом — оставьте пустым.
// Если вы деплоите Node-сервер на отдельный домен, укажите здесь, например:
// const API_BASE = "https://your-backend-host.com";
const API_BASE = "https://thetestserver-1.onrender.com/";

const state = {
  // user
  user: null,
  userPoints: 0,

  // global mining
  totalMined: 0,
  maxSupply: 1_000_000,
  miningAvailable: true,

  // ui
  currentScreen: "main",
  tonConnectUI: null,
  walletAddress: "",

  // config
  botUsername: "",
  refBonus: 150,
  apiOk: false,
};

const tg = window.Telegram?.WebApp;

document.addEventListener("DOMContentLoaded", async () => {
  if (tg) {
    tg.ready();
    tg.expand?.();
    tg.disableVerticalSwipes?.();
  }

  setupHaptics();
  setupNavigation();

  // Prefer server sync. If Telegram initData not available (e.g., desktop browser),
  // fallback to local state to keep demo working.
  await loadConfig();
  await syncMe();

  renderCurrentScreen();
  updatePointsHeader();
  initTonConnect();
  updateThemeByMiningState();
});

function setupHaptics() {
  // Haptic on every button press (and tap-button).
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target instanceof Element ? e.target.closest("button") : null;
      if (!target) return;
      // Tap button uses stronger haptic handled in tap logic
      if (target.id === "tap-button") return;
      hapticImpact("light");
    },
    true
  );
}

function hapticImpact(style) {
  try {
    if (tg?.HapticFeedback?.impactOccurred) {
      tg.HapticFeedback.impactOccurred(style);
      return;
    }
  } catch {
    // ignore
  }

  // fallback (works outside Telegram on many Android devices)
  try {
    if (navigator.vibrate) navigator.vibrate(12);
  } catch {
    // ignore
  }
}

function initDataHeader() {
  const initData = tg?.initData || "";
  return initData ? { "x-telegram-init-data": initData } : {};
}

async function apiFetch(path, options = {}) {
  const url = (API_BASE || "") + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
      ...initDataHeader(),
    },
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

async function loadConfig() {
  try {
    const data = await apiFetch("/api/config");
    if (data?.ok) {
      state.botUsername = data.botUsername || "";
      state.maxSupply = Number(data.maxSupply || state.maxSupply);
      state.refBonus = Number(data.refBonus || state.refBonus);
    }
  } catch {
    // ignore, offline/demo mode
  }
}

function restoreLocalFallback() {
  try {
    const savedUser = localStorage.getItem("vibe_tap_user_points");
    const savedTotal = localStorage.getItem("vibe_tap_total_mined");
    if (savedUser) state.userPoints = Number(savedUser) || 0;
    if (savedTotal) state.totalMined = Number(savedTotal) || 0;
  } catch {
    // ignore
  }
  state.miningAvailable = state.totalMined < state.maxSupply;
}

function persistLocalFallback() {
  try {
    localStorage.setItem("vibe_tap_user_points", String(state.userPoints));
    localStorage.setItem("vibe_tap_total_mined", String(state.totalMined));
  } catch {
    // ignore
  }
}

async function syncMe() {
  if (!tg?.initData) {
    restoreLocalFallback();
    state.apiOk = false;
    return;
  }

  try {
    const data = await apiFetch("/api/me");
    if (!data?.ok) throw new Error("BAD_RESPONSE");

    state.apiOk = true;
    state.user = data.user || null;
    state.userPoints = Number(data.points || 0);
    state.totalMined = Number(data.totalMined || 0);
    state.maxSupply = Number(data.maxSupply || state.maxSupply);
    state.miningAvailable = !!data.miningAvailable;

    // if ref bonus was awarded now, make it feel good
    if (data.referral?.bonusAwardedNow) {
      hapticImpact("medium");
    }
  } catch (e) {
    console.warn("API /api/me failed, fallback to local", e);
    restoreLocalFallback();
    state.apiOk = false;
  }
}

function updatePointsHeader() {
  const el = document.getElementById("points-balance");
  if (el) el.textContent = String(state.userPoints);
}

function setupNavigation() {
  const navButtons = document.querySelectorAll(".nav-btn");
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const screen = btn.getAttribute("data-screen");
      if (!screen || screen === state.currentScreen) return;

      state.currentScreen = screen;
      navButtons.forEach((b) => b.classList.toggle("active", b === btn));
      renderCurrentScreen();
    });
  });
}

function renderCurrentScreen() {
  const container = document.getElementById("screen-container");
  if (!container) return;

  switch (state.currentScreen) {
    case "wallet":
      container.innerHTML = renderWalletScreen();
      bindWalletScreenEvents();
      break;
    case "leaderboard":
      container.innerHTML = renderLeaderboardScreen();
      bindLeaderboardScreenEvents();
      break;
    case "main":
    default:
      container.innerHTML = renderMainScreen();
      bindMainScreenEvents();
      break;
  }
}

function renderMainScreen() {
  const remaining = Math.max(0, state.maxSupply - state.totalMined);
  const disabled = !state.miningAvailable;

  return `
    <section class="main-screen">
      <div class="hero-top">
        <div class="hero-badge">
          <span class="hero-badge-dot"></span>
          <span>${state.apiOk ? "Синхронизация: ON" : "Синхронизация: OFF (demo)"}</span>
        </div>
        <div class="hero-balance">
          <div class="hero-balance-label">Ваши поинты</div>
          <div class="hero-balance-value">${state.userPoints.toLocaleString("ru-RU")}</div>
        </div>
      </div>
      <div class="tap-button-wrapper">
        <button
          id="tap-button"
          class="tap-button ${disabled ? "disabled" : ""}"
          ${disabled ? "disabled" : ""}
        ></button>
      </div>
      <div class="tap-remaining">
        ${
          disabled
            ? '<span class="text-muted">Лимит майнинга исчерпан. В будущем поинты будут конвертированы в токены.</span>'
            : `<span>Доступно к майнингу: <b>${remaining.toLocaleString("ru-RU")}</b> поинтов</span>`
        }
      </div>
    </section>
  `;
}

function bindMainScreenEvents() {
  const btn = document.getElementById("tap-button");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    if (!state.miningAvailable) return;

    // Tap should feel stronger
    hapticImpact("medium");

    if (state.apiOk) {
      try {
        const data = await apiFetch("/api/tap", { method: "POST", body: "{}" });
        if (!data?.ok) throw new Error("BAD_RESPONSE");

        state.userPoints = Number(data.points || state.userPoints);
        state.totalMined = Number(data.totalMined || state.totalMined);
        state.maxSupply = Number(data.maxSupply || state.maxSupply);
        state.miningAvailable = !!data.miningAvailable;

        updatePointsHeader();
        updateThemeByMiningState();
        renderCurrentScreen();
        return;
      } catch (e) {
        console.warn("API /api/tap failed, fallback local", e);
        state.apiOk = false;
      }
    }

    // Local fallback
    const remaining = state.maxSupply - state.totalMined;
    if (remaining <= 0) {
      state.miningAvailable = false;
      onMiningFinished();
      return;
    }

    const amount = Math.min(POINTS_PER_TAP, remaining);
    state.userPoints += amount;
    state.totalMined += amount;
    updatePointsHeader();
    persistLocalFallback();

    if (state.totalMined >= state.maxSupply) {
      state.miningAvailable = false;
      onMiningFinished();
    } else {
      renderCurrentScreen();
    }
  });
}

function onMiningFinished() {
  updateThemeByMiningState();
  const btn = document.getElementById("tap-button");
  if (btn) {
    btn.classList.add("disabled");
    btn.setAttribute("disabled", "true");
  }
  const remainingEl = document.querySelector(".tap-remaining");
  if (remainingEl) {
    remainingEl.innerHTML =
      '<span class="text-muted">Лимит майнинга исчерпан. Дальнейший майнинг недоступен.</span>';
  }
}

function updateThemeByMiningState() {
  if (state.miningAvailable) {
    document.body.classList.remove("theme-dark");
    document.body.classList.add("theme-colorful");
  } else {
    document.body.classList.remove("theme-colorful");
    document.body.classList.add("theme-dark");
  }
}

function renderWalletScreen() {
  return `
    <section class="wallet-screen">
      <div class="card">
        <div class="card-title">Ваш баланс</div>
        <div class="card-subtitle">
          Эти поинты будут конвертированы в токены после окончания майнинга.
        </div>
        <div class="wallet-balance-row">
          <div class="wallet-balance-value">${state.userPoints.toLocaleString("ru-RU")}</div>
          <div class="wallet-balance-caption">поинтов</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">TON кошелек</div>
        <div class="card-subtitle">
          Подключите TON-кошелек через TonConnect, чтобы в будущем получить токены.
        </div>
        <div id="tonconnect-container"></div>
        <div style="margin-top:10px;font-size:12px;">
          ${
            state.walletAddress
              ? `<span class="text-muted">Кошелек подключен:</span><br /><span>${state.walletAddress}</span>`
              : `<span class="text-muted">Кошелек еще не подключен.</span>`
          }
        </div>
      </div>
    </section>
  `;
}

function bindWalletScreenEvents() {
  if (state.tonConnectUI) {
    try {
      state.tonConnectUI.uiOptions = {
        uiPreferences: {
          theme: document.body.classList.contains("theme-dark") ? "DARK" : "LIGHT",
        },
      };
      //state.tonConnectUI.renderWalletsList("#tonconnect-container");
    } catch (e) {
      console.warn("TonConnect render failed", e);
    }
  }
}

function initTonConnect() {
  // Манифест лежит на GitHub Pages по вашему URL
  const manifestUrl =
    "https://justalex1922-beep.github.io/testsiteforminiapp.github.io/tonconnect-manifest.json";

  try {
    if (typeof TON_CONNECT_UI === "undefined" || !TON_CONNECT_UI?.TonConnectUI) {
      throw new Error("TON_CONNECT_UI global not found");
    }

    state.tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
      manifestUrl,
    });

    // Восстанавливаем сессию/следим за подключением
    const applyAccount = () => {
      const account = state.tonConnectUI.account;
      state.walletAddress = account?.address || "";
      if (state.currentScreen === "wallet") {
        renderCurrentScreen();
      }
    };

    applyAccount();
    state.tonConnectUI.onStatusChange(() => {
      applyAccount();
    });
  } catch (e) {
    console.warn("TonConnect UI init failed", e);
  }
}

async function getLeaderboard() {
  if (!state.apiOk) {
    const me = tg?.initDataUnsafe?.user;
    const myName = me ? `${me.first_name || ""} ${me.last_name || ""}`.trim() : "Вы";
    return [
      { tgId: "me", name: myName || "Вы", points: state.userPoints },
      { tgId: 1, name: "Demo user", points: Math.max(0, state.userPoints - 10) },
    ].sort((a, b) => b.points - a.points);
  }

  const data = await apiFetch("/api/leaderboard");
  return data?.leaders || [];
}

function renderLeaderboardScreen() {
  return `
    <section class="leaderboard-screen">
      <div class="card">
        <div class="leaderboard-header">
          <div>
            <div class="leaderboard-title">Лидерборд</div>
            <div class="leaderboard-subtitle">
              Реальные пользователи. Топ‑3 — золото/серебро/бронза.
            </div>
          </div>
          <button id="lb-refresh" class="btn-ghost" type="button">Обновить</button>
        </div>
        <div id="leaderboard-list" class="leaderboard-list">
          <div class="text-muted">Загрузка…</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Пригласить друзей</div>
        <div class="card-subtitle">
          Пригласите друга и получите <b>+${state.refBonus}</b> поинтов на баланс.
        </div>
        <button id="invite-btn" class="btn-primary">Invite frens</button>
        <p class="text-muted" style="margin-top:8px;">
          Ссылка ведет в вашего бота и открывает Mini App с реф‑параметром.
        </p>
      </div>
    </section>
  `;
}

function bindLeaderboardScreenEvents() {
  const refreshBtn = document.getElementById("lb-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      hydrateLeaderboard().catch((e) => console.warn("hydrateLeaderboard failed", e));
    });
  }

  const inviteBtn = document.getElementById("invite-btn");
  if (inviteBtn) {
    inviteBtn.addEventListener("click", async () => {
      let refUrl = "";

      if (state.apiOk) {
        try {
          const data = await apiFetch("/api/invite", { method: "POST", body: "{}" });
          if (data?.ok && data.link) refUrl = data.link;
        } catch (e) {
          console.warn("API /api/invite failed", e);
        }
      }

      if (!refUrl && state.botUsername && tg?.initDataUnsafe?.user?.id) {
        const payload = `ref_${tg.initDataUnsafe.user.id}`;
        refUrl = `https://t.me/${state.botUsername}?startapp=${encodeURIComponent(payload)}`;
      }

      if (!refUrl) {
        refUrl = "https://t.me/";
      }

      if (tg?.openTelegramLink) tg.openTelegramLink(refUrl);
      else window.open(refUrl, "_blank");
    });
  }

  hydrateLeaderboard().catch((e) => console.warn("hydrateLeaderboard failed", e));
}

async function hydrateLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  if (!list) return;
  list.innerHTML = `<div class="text-muted">Загрузка…</div>`;

  let leaders = [];
  try {
    leaders = await getLeaderboard();
  } catch (e) {
    console.warn("leaderboard fetch failed", e);
  }

  const myId = tg?.initDataUnsafe?.user?.id;
  const itemsHtml = (leaders || [])
    .map((user, index) => {
      const rank = index + 1;
      let rankClass = "";
      if (rank === 1) rankClass = "rank-1";
      if (rank === 2) rankClass = "rank-2";
      if (rank === 3) rankClass = "rank-3";

      const isMe = myId && Number(user.tgId) === Number(myId);
      const youBadge = isMe ? " (Вы)" : "";

      return `
        <div class="leaderboard-row ${rankClass} ${isMe ? "is-me" : ""}">
          <span class="leaderboard-rank">#${rank}</span>
          <span class="leaderboard-name">${escapeHtml(user.name || "User")}${youBadge}</span>
          <span class="leaderboard-points">${Number(user.points || 0).toLocaleString("ru-RU")}</span>
        </div>
      `;
    })
    .join("");

  list.innerHTML = itemsHtml || `<div class="text-muted">Пока нет игроков.</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}



