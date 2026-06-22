import { Redis } from "@upstash/redis";

const KEY = "pynk:state";

// in-memory fallback so the app still boots before you set up a database.
// note: this resets on every server restart, it is only for local testing.
let memory = null;

// the Vercel Upstash integration injects KV_REST_API_URL / KV_REST_API_TOKEN,
// while a manual Upstash setup uses UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
// accept either naming so the app finds your database in both cases.
function getCreds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return { url, token };
}

function hasUpstash() {
  const { url, token } = getCreds();
  return Boolean(url && token);
}

function getRedis() {
  const { url, token } = getCreds();
  return new Redis({ url, token });
}

export function blankState() {
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    version: 1,
    events: [],
    habits: { date: d, swim: false, gym: false, meditation: false },
    streaks: {
      swim: { count: 0, last: null },
      gym: { count: 0, last: null },
      meditation: { count: 0, last: null },
    },
    tasks: [],
    insta: { log: [], ideas: [] },
  };
}

export async function loadState() {
  if (!hasUpstash()) return memory || blankState();
  const redis = getRedis();
  const value = await redis.get(KEY); // the client parses JSON for us
  return value || blankState();
}

export async function saveState(state) {
  if (!hasUpstash()) {
    memory = state;
    return;
  }
  const redis = getRedis();
  await redis.set(KEY, state);
}
