// app/api/google/callback/route.js
// Google sends you back here after you click "allow". We:
//  1. check the "state" matches the cookie we set (anti-forgery),
//  2. trade the one-time code for real tokens,
//  3. save the tokens server-side,
//  4. send you back to the app.
// On any problem we redirect home with ?gerror=... so the app can show why,
// instead of dumping a raw error page.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { exchangeCode, getTokens, saveTokens } from "@/lib/google";

export const runtime = "nodejs";

function baseUrl(req) {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(req) {
  const home = baseUrl(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error"); // e.g. user clicked "deny"

  if (googleError) {
    return NextResponse.redirect(`${home}/?gerror=${encodeURIComponent(googleError)}`);
  }
  if (!(await isAuthed())) {
    return NextResponse.redirect(`${home}/?gerror=not_logged_in`);
  }

  const store = await cookies();
  const saved = store.get("g_oauth_state")?.value;
  if (!code || !state || !saved || state !== saved) {
    return NextResponse.redirect(`${home}/?gerror=state_mismatch`);
  }

  try {
    // Must be the SAME redirect URI we used to start the flow, or Google rejects it.
    const redirectUri = `${home}/api/google/callback`;
    const d = await exchangeCode(code, redirectUri);

    // Google only sends a refresh token on the first consent. If we ever get a
    // round without one, keep the one we already had.
    const existing = (await getTokens()) || {};
    await saveTokens({
      refresh_token: d.refresh_token || existing.refresh_token || null,
      access_token: d.access_token,
      expires_at: Date.now() + (d.expires_in || 3600) * 1000,
      scope: d.scope,
    });

    const res = NextResponse.redirect(`${home}/?connected=1`);
    res.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 }); // clear the one-time state
    return res;
  } catch (e) {
    return NextResponse.redirect(`${home}/?gerror=${encodeURIComponent(e.message || "exchange_failed")}`);
  }
}
