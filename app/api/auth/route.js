import { cookies } from "next/headers";
import { authConfigured } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req) {
  // open mode, nothing to check
  if (!authConfigured()) return Response.json({ ok: true });

  let password = "";
  try {
    const body = await req.json();
    password = body.password || "";
  } catch {
    password = "";
  }

  if (password === process.env.APP_PASSWORD) {
    const store = await cookies();
    store.set("pynk_auth", "ok", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return Response.json({ ok: true });
  }

  return new Response(JSON.stringify({ ok: false }), { status: 401 });
}
