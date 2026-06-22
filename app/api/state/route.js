import { isAuthed, authConfigured } from "@/lib/auth";
import { loadState, saveState } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAuthed())) {
    return new Response(JSON.stringify({ authed: false, locked: authConfigured() }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const state = await loadState();
    return Response.json({ authed: true, state });
  } catch (e) {
    // surface the real reason in plain text so it is debuggable from the browser
    const reason = e && e.message ? e.message : "unknown storage error";
    return new Response(JSON.stringify({ error: "Storage read failed: " + reason }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req) {
  if (!(await isAuthed())) {
    return new Response(JSON.stringify({ authed: false }), { status: 401 });
  }
  try {
    const body = await req.json();
    await saveState(body);
    return Response.json({ ok: true });
  } catch (e) {
    const reason = e && e.message ? e.message : "unknown storage error";
    return new Response(JSON.stringify({ ok: false, error: "Storage write failed: " + reason }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
