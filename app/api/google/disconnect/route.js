// app/api/google/disconnect/route.js
// Unlinks Google: tells Google to forget us and wipes the stored tokens.

import { isAuthed } from "@/lib/auth";
import { revokeAndClear } from "@/lib/google";

export const runtime = "nodejs";

export async function POST() {
  if (!(await isAuthed())) {
    return new Response(JSON.stringify({ ok: false }), { status: 401 });
  }
  try {
    await revokeAndClear();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e.message || "disconnect failed" });
  }
}
