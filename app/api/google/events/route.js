// app/api/google/events/route.js
// The browser calls this to get your events. It returns a clear connection
// status so the UI always knows what to show:
//   { connected:false, configured:false } -> keys not set yet
//   { connected:false }                   -> configured, but you haven't linked Google
//   { connected:false, needsReconnect:true } -> link expired, ask to reconnect
//   { connected:true, events:[...] }       -> here are your events
// Events themselves are not secret, so they're fine to send to the browser.
// Tokens never are, and never leave the server.

import { isAuthed } from "@/lib/auth";
import { isConfigured, getTokens, fetchUpcomingEvents } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always check live; never cache the connection state

export async function GET() {
  if (!(await isAuthed())) {
    return new Response(JSON.stringify({ connected: false }), { status: 401 });
  }
  if (!isConfigured()) {
    return Response.json({ connected: false, configured: false });
  }

  const t = await getTokens();
  if (!t || !t.refresh_token) {
    return Response.json({ connected: false, configured: true });
  }

  try {
    const events = await fetchUpcomingEvents();
    return Response.json({ connected: true, events });
  } catch (e) {
    // A dead/expired refresh token shows up as invalid_grant -> needs reconnect.
    if (e.code === "invalid_grant" || e.code === "not_connected") {
      return Response.json({ connected: false, needsReconnect: true, error: e.message });
    }
    // Any other hiccup (Google down, network): stay "connected" but surface why.
    return Response.json({ connected: true, events: [], error: e.message || "calendar error" });
  }
}
