// app/api/google/connect/route.js
// You hit this when you click "connect Google". It bounces you to Google's
// permission screen. We attach a random "state" value (stored in a short-lived
// cookie) so that when Google sends you back, we can prove the reply is really
// for this request and not a forged one (CSRF protection).

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { isConfigured, buildAuthUrl } from "@/lib/google";

export const runtime = "nodejs";

// Work out the site's own address from the incoming request, so this works
// the same on localhost and on your live Vercel domain without hardcoding.
function baseUrl(req) {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(req) {
  if (!(await isAuthed())) {
    return new Response("Please log in first.", { status: 401 });
  }
  if (!isConfigured()) {
    return new Response(
      "Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then redeploy.",
      { status: 500 }
    );
  }

  const redirectUri = `${baseUrl(req)}/api/google/callback`;
  const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  const res = NextResponse.redirect(buildAuthUrl(redirectUri, state), 302);
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes is plenty to click "allow"
  });
  return res;
}
