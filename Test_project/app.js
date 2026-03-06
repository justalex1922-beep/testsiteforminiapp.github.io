const MAX_SUPPLY = 1_000_000;
const POINTS_PER_TAP = 1;

const state = {
  userPoints: 0,
  totalMined: 0,
  currentScreen: "main",
  miningAvailable: true,
  tonConnectUI: null,
};

const tg = window.Telegram?.WebApp;

document.addEventListener("DOMContentLoaded", () => {
  if (tg) tg.ready();

  restoreLocalState();
  setupNavigation();
  renderCurrentScreen();
  updatePointsHeader();
  initTonConnect();
  updateThemeByMiningState();
});

function restoreLocalState() {
  try {
    const savedUser = localStorage.getItem("vibe_tap_user_points");
    const savedTotal = localStorage.getItem("vibe_tap_total_mined");
    if (savedUser) state.userPoints = Number(savedUser) || 0;
    if (savedTotal) state.totalMined = Number(savedTotal) || 0;
  } catch (e) {
    console.warn("Local storage not available", e);
  }
  state.miningAvailable = state.totalMined < MAX_SUPPLY;
}

function persistState() {
  try {
    localStorage.setItem("vibe_tap_user_points", String(state.userPoints));
    localStorage.setItem("vibe_tap_total_mined", String(state.totalMined));
  } catch (e) {
    /* ignore */
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
  const remaining = Math.max(0, MAX_SUPPLY - state.totalMined);
  const disabled = !state.miningAvailable;

  return `
    <section class="main-screen">
      <div>
        <div class="tap-info">
          Нажимай на логотип, чтобы майнить поинты
          <div class="tap-counter">${state.userPoints} поинтов</div>
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

  btn.addEventListener("click", () => {
    if (!state.miningAvailable) return;

    const remaining = MAX_SUPPLY - state.totalMined;
    if (remaining <= 0) {
      state.miningAvailable = false;
      onMiningFinished();
      return;
    }

    const amount = Math.min(POINTS_PER_TAP, remaining);
    state.userPoints += amount;
    state.totalMined += amount;

    updatePointsHeader();
    persistState();

    const counter = document.querySelector(".tap-counter");
    if (counter) {
      counter.textContent = `${state.userPoints} поинтов`;
    }

    const remainingNow = MAX_SUPPLY - state.totalMined;
    const remainingEl = document.querySelector(".tap-remaining");
    if (remainingEl && remainingNow >= 0) {
      remainingEl.innerHTML = `<span>Доступно к майнингу: <b>${remainingNow.toLocaleString(
        "ru-RU"
      )}</b> поинтов</span>`;
    }

    if (state.totalMined >= MAX_SUPPLY) {
      state.miningAvailable = false;
      onMiningFinished();
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
          <div class="wallet-balance-value">${state.userPoints}</div>
          <div class="wallet-balance-caption">поинтов</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">TON кошелек</div>
        <div class="card-subtitle">
          Подключите TON-кошелек через TonConnect, чтобы в будущем получить токены.
        </div>
        <div id="tonconnect-container"></div>
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
      state.tonConnectUI.renderWalletsListButton("#tonconnect-container");
    } catch (e) {
      console.warn("TonConnect render failed", e);
    }
  }
}

function initTonConnect() {
  const manifestUrl = "https://your-domain.com/tonconnect-manifest.json";

  try {
    state.tonConnectUI = new window.TonConnectUI.TonConnectUI({
      manifestUrl,
    });
  } catch (e) {
    console.warn("TonConnect UI init failed", e);
  }
}

function getMockLeaderboard() {
  const me = tg?.initDataUnsafe?.user;
  const myName = me ? `${me.first_name || ""} ${me.last_name || ""}`.trim() : "Вы";

  const base = [
    { id: 1, name: "Whale", points: 125_000 },
    { id: 2, name: "Farmer", points: 80_500 },
    { id: 3, name: "Diamond Hands", points: 45_300 },
    { id: 4, name: "Vibe Player", points: 21_700 },
  ];

  base.push({
    id: "me",
    name: myName || "Вы",
    points: state.userPoints,
  });

  return base.sort((a, b) => b.points - a.points).slice(0, 50);
}

function renderLeaderboardScreen() {
  const leaders = getMockLeaderboard();
  const itemsHtml = leaders
    .map((user, index) => {
      const rank = index + 1;
      let rankClass = "";
      if (rank === 1) rankClass = "rank-1";
      if (rank === 2) rankClass = "rank-2";
      if (rank === 3) rankClass = "rank-3";

      const youBadge = user.id === "me" ? " (Вы)" : "";

      return `
        <div class="leaderboard-row ${rankClass}">
          <span class="leaderboard-rank">#${rank}</span>
          <span class="leaderboard-name">${user.name}${youBadge}</span>
          <span class="leaderboard-points">${user.points.toLocaleString("ru-RU")}</span>
        </div>
      `;
    })
    .join("");

  return `
    <section class="leaderboard-screen">
      <div class="card">
        <div class="leaderboard-header">
          <div>
            <div class="leaderboard-title">Лидерборд</div>
            <div class="leaderboard-subtitle">
              Соревнуйтесь за топ-3 места с золотым, серебряным и бронзовым свечением.
            </div>
          </div>
        </div>
        <div class="leaderboard-list">
          ${itemsHtml}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Пригласить друзей</div>
        <div class="card-subtitle">
          Пригласите друга и получите <b>+150 поинтов</b> на баланс за каждого.
        </div>
        <button id="invite-btn" class="btn-primary">Пригласить друга</button>
        <p class="text-muted" style="margin-top:8px;">
          В реальном приложении здесь можно открыть реферальную ссылку или Telegram-инвайт через WebApp API.
        </p>
      </div>
    </section>
  `;
}

function bindLeaderboardScreenEvents() {
  const inviteBtn = document.getElementById("invite-btn");
  if (!inviteBtn) return;

  inviteBtn.addEventListener("click", () => {
    const refUrl = "https://t.me/your_bot?start=ref123";

    if (tg && tg.openTelegramLink) {
      tg.openTelegramLink(refUrl);
    } else {
      window.open(refUrl, "_blank");
    }

    state.userPoints += 150;
    updatePointsHeader();
    persistState();

    if (state.currentScreen === "leaderboard") {
      renderCurrentScreen();
    }
  });
}

