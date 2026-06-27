// lib/google.js
// Everything here runs ONLY on the server. The browser never sees these tokens.
// We talk to Google with plain fetch so every step is visible and you can own it.

import { Redis } from "@upstash/redis";

// Tokens live in their own database slot, kept completely separate from the
// app's main "pynk:state" blob. That separation matters: the front end loads
// and saves "pynk:state", so if tokens lived there they could leak to the
// browser. They never touch that path.
const KEY = "pynk:google";

// Local-dev fallback. During `npm run dev` the server is one long-lived
// process, so this survives between the connect and the events call.
// On Vercel you have a real database (Upstash), so this is never used there.
let memory = null;

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

export async function getTokens() {
  if (!hasUpstash()) return memory;
  return (await getRedis().get(KEY)) || null;
}
export async function saveTokens(tokens) {
  if (!hasUpstash()) { memory = tokens; return; }
  await getRedis().set(KEY, tokens);
}
export async function clearTokens() {
  if (!hasUpstash()) { memory = null; return; }
  await getRedis().del(KEY);
}

// Are the Google keys present? If not, the UI shows "not configured yet"
// instead of breaking, exactly like the app already does for the Gemini key.
export function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Least privilege: we ask ONLY to read calendar events. Not write, not delete,
// not your contacts or settings. This is the smallest scope that lets us show
// your events.
const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Step 1 of OAuth: build the URL we send you to, where Google asks
// "do you allow this app to read your calendar?".
// access_type=offline + prompt=consent is what makes Google hand back a
// refresh token (the thing that lets us keep reading without you logging in
// every hour).
export function buildAuthUrl(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

// Step 2: Google sends you back to us with a one-time "code". We trade that
// code (plus our secret) for the real tokens.
export async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || "token exchange failed");
  return d; // { access_token, expires_in, refresh_token?, scope, token_type }
}

// Access tokens die after ~1 hour. When that happens we quietly use the
// long-lived refresh token to get a fresh one. No user action needed.
async function refreshAccess(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if (!r.ok) {
    const err = new Error(d.error_description || d.error || "refresh failed");
    err.code = d.error; // "invalid_grant" means the refresh token died -> reconnect
    throw err;
  }
  return d; // { access_token, expires_in, scope, token_type }
}

// Hand back a usable access token, refreshing + saving it first if it's stale.
export async function getValidAccessToken() {
  const t = await getTokens();
  if (!t || !t.refresh_token) {
    const e = new Error("not connected");
    e.code = "not_connected";
    throw e;
  }
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60000) {
    return t.access_token;
  }
  const d = await refreshAccess(t.refresh_token);
  const updated = {
    ...t,
    access_token: d.access_token,
    expires_at: Date.now() + (d.expires_in || 3600) * 1000,
  };
  await saveTokens(updated);
  return updated.access_token;
}

// Pull events from your PRIMARY calendar.
// - singleEvents=true expands repeating events into real dated instances
//   (without it, a weekly meeting comes back as one rule, not Monday/Tuesday/...).
// - We grab a generous window (yesterday through +8 days) in UTC and let the
//   BROWSER decide what counts as "today" in your real timezone. Timezone math
//   on the server would be wrong, because the server runs in UTC, not your zone.
export async function fetchUpcomingEvents() {
  const accessToken = await getValidAccessToken();
  const now = Date.now();
  const timeMin = new Date(now - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(now + 8 * 24 * 3600 * 1000).toISOString();
  const p = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p.toString()}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "calendar fetch failed");
  return (d.items || []).map((ev) => ({
    id: ev.id,
    title: ev.summary || "(no title)",
    // timed events carry a full timestamp with zone; all-day events carry just a date
    startDateTime: ev.start?.dateTime || null,
    startDate: ev.start?.date || null,
    allDay: Boolean(ev.start?.date && !ev.start?.dateTime),
  }));
}

// Disconnect: tell Google to forget us, then wipe our stored tokens.
export async function revokeAndClear() {
  const t = await getTokens();
  const tok = t?.refresh_token || t?.access_token;
  if (tok) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(tok)}`, { method: "POST" });
    } catch {
      // even if revoke fails, we still clear our side below
    }
  }
  await clearTokens();
}
