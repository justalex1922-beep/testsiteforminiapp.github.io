import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

dotenv.config();

const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "";
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const DB_PATH = process.env.DB_PATH || "./data/db.json";
const MAX_SUPPLY = Number(process.env.MAX_SUPPLY || 1_000_000);
const REF_BONUS = Number(process.env.REF_BONUS || 150);

if (!BOT_TOKEN) {
  console.warn("[WARN] BOT_TOKEN is not set. Telegram auth verification will fail.");
}

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const adapter = new JSONFile(DB_PATH);
const db = new Low(adapter, {
  users: {}, // { [tgId]: { ... } }
  global: { totalMined: 0, maxSupply: MAX_SUPPLY },
});

let dbReady = false;
let writeScheduled = null;
async function dbInit() {
  if (dbReady) return;
  await db.read();
  db.data ||= { users: {}, global: { totalMined: 0, maxSupply: MAX_SUPPLY } };
  db.data.users ||= {};
  db.data.global ||= { totalMined: 0, maxSupply: MAX_SUPPLY };
  if (!Number.isFinite(db.data.global.maxSupply) || db.data.global.maxSupply <= 0) {
    db.data.global.maxSupply = MAX_SUPPLY;
  }
  if (!Number.isFinite(db.data.global.totalMined) || db.data.global.totalMined < 0) {
    db.data.global.totalMined = 0;
  }
  dbReady = true;
  await db.write();
}

function scheduleWrite() {
  if (writeScheduled) return;
  writeScheduled = setTimeout(async () => {
    writeScheduled = null;
    try {
      await db.write();
    } catch (e) {
      console.warn("[WARN] db.write failed", e);
    }
  }, 50);
}

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "256kb" }));

// Serve frontend as static (same-origin API)
app.use(express.static(process.cwd(), { extensions: ["html"] }));

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Telegram initData verification per docs
function verifyInitData(initData) {
  if (!BOT_TOKEN) return { ok: false, reason: "BOT_TOKEN_NOT_SET" };
  if (!initData || typeof initData !== "string") return { ok: false, reason: "NO_INIT_DATA" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "NO_HASH" };

  params.delete("hash");

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeEqual(computedHash, hash)) return { ok: false, reason: "BAD_HASH" };

  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "NO_USER" };

  let user;
  try {
    user = JSON.parse(userJson);
  } catch {
    return { ok: false, reason: "BAD_USER_JSON" };
  }

  return { ok: true, user, startParam: params.get("start_param") || "" };
}

function getOrCreateUser(tgUser) {
  const now = Date.now();
  const key = String(tgUser.id);
  const existing = db.data.users[key];
  if (existing) {
    existing.username = tgUser.username || null;
    existing.firstName = tgUser.first_name || null;
    existing.lastName = tgUser.last_name || null;
    scheduleWrite();
    return existing;
  }

  const created = {
    tgId: tgUser.id,
    username: tgUser.username || null,
    firstName: tgUser.first_name || null,
    lastName: tgUser.last_name || null,
    points: 0,
    referredBy: null,
    refBonusClaimed: false,
    createdAt: now,
  };

  db.data.users[key] = created;
  scheduleWrite();
  return created;
}

function tryApplyReferral(newUserId, startParam) {
  if (!startParam || typeof startParam !== "string") return;
  // Accept: ref_<tgid>
  if (!startParam.startsWith("ref_")) return;
  const refId = Number(startParam.slice(4));
  if (!Number.isFinite(refId) || refId <= 0) return;
  if (refId === newUserId) return;

  const me = db.data.users[String(newUserId)];
  if (!me) return;
  if (me.referredBy) return;
  const referrer = db.data.users[String(refId)];
  if (!referrer) return;
  me.referredBy = refId;
  scheduleWrite();
}

function tryClaimReferralBonus(userId) {
  // Bonus is awarded to referrer once, when referred user is first seen and has a valid referrer.
  const me = db.data.users[String(userId)];
  if (!me) return { awarded: false };
  if (!me.referredBy) return { awarded: false };
  if (me.refBonusClaimed) return { awarded: false };

  const referrer = db.data.users[String(me.referredBy)];
  if (!referrer) return { awarded: false };

  referrer.points = Number(referrer.points || 0) + REF_BONUS;
  me.refBonusClaimed = true;
  scheduleWrite();

  return { awarded: true, referrerId: me.referredBy, amount: REF_BONUS };
}

function requireAuth(req, res, next) {
  const initData = req.header("x-telegram-init-data") || "";
  const verified = verifyInitData(initData);
  if (!verified.ok) return res.status(401).json({ ok: false, error: verified.reason });
  req.tgUser = verified.user;
  req.startParam = verified.startParam;
  next();
}

app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    botUsername: BOT_USERNAME,
    webappUrl: WEBAPP_URL,
    maxSupply: MAX_SUPPLY,
    refBonus: REF_BONUS,
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  const u = getOrCreateUser(req.tgUser);
  tryApplyReferral(req.tgUser.id, req.startParam);
  const bonus = tryClaimReferralBonus(req.tgUser.id);

  const global = db.data.global;
  const me2 = db.data.users[String(req.tgUser.id)];

  res.json({
    ok: true,
    user: {
      tgId: me2.tgId,
      username: me2.username,
      firstName: me2.firstName,
      lastName: me2.lastName,
    },
    points: Number(me2.points || 0),
    totalMined: Number(global.totalMined || 0),
    maxSupply: Number(global.maxSupply || MAX_SUPPLY),
    miningAvailable: Number(global.totalMined || 0) < Number(global.maxSupply || MAX_SUPPLY),
    referral: {
      referredBy: me2.referredBy,
      bonusClaimed: !!me2.refBonusClaimed,
      bonusAwardedNow: !!bonus.awarded,
      bonusAmount: REF_BONUS,
    },
  });
});

app.post("/api/tap", requireAuth, (req, res) => {
  const amount = 1;

  const global = db.data.global;
  const remaining = Math.max(0, Number(global.maxSupply || MAX_SUPPLY) - Number(global.totalMined || 0));
  if (remaining <= 0) {
    return res.json({
      ok: true,
      mined: 0,
      points: Number(db.data.users[String(req.tgUser.id)]?.points ?? 0),
      totalMined: Number(global.totalMined || 0),
      maxSupply: Number(global.maxSupply || MAX_SUPPLY),
      miningAvailable: false,
    });
  }

  const mined = Math.min(amount, remaining);

  getOrCreateUser(req.tgUser);
  const me = db.data.users[String(req.tgUser.id)];
  me.points = Number(me.points || 0) + mined;
  global.totalMined = Number(global.totalMined || 0) + mined;
  scheduleWrite();

  const points = Number(me.points || 0);
  const global2 = db.data.global;

  res.json({
    ok: true,
    mined,
    points,
    totalMined: Number(global2.totalMined || 0),
    maxSupply: Number(global2.maxSupply || MAX_SUPPLY),
    miningAvailable: Number(global2.totalMined || 0) < Number(global2.maxSupply || MAX_SUPPLY),
  });
});

app.get("/api/leaderboard", requireAuth, (req, res) => {
  getOrCreateUser(req.tgUser);

  const leaders = Object.values(db.data.users)
    .sort((a, b) => {
      const ap = Number(a.points || 0);
      const bp = Number(b.points || 0);
      if (bp !== ap) return bp - ap;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    })
    .slice(0, 50)
    .map((u) => ({
      tgId: u.tgId,
      name:
        (u.firstName || u.lastName)
          ? `${u.firstName || ""} ${u.lastName || ""}`.trim()
          : u.username
            ? `@${u.username}`
            : `User ${u.tgId}`,
      username: u.username,
      points: Number(u.points || 0),
    }));

  res.json({ ok: true, leaders });
});

app.post("/api/invite", requireAuth, (req, res) => {
  // returns a deep-link that opens the mini app with start_param
  getOrCreateUser(req.tgUser);
  const payload = `ref_${req.tgUser.id}`;

  // Prefer startapp for direct WebApp open when menu button configured:
  // https://t.me/<bot>?startapp=<payload>
  const link = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(payload)}` : "";
  res.json({ ok: true, link, payload, bonus: REF_BONUS });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

await dbInit();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

