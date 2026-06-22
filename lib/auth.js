import { cookies } from "next/headers";

export function authConfigured() {
  return Boolean(process.env.APP_PASSWORD);
}

// awaiting cookies() works on both old (sync) and new (async) Next.js,
// so this is safe across versions
export async function isAuthed() {
  if (!authConfigured()) return true;
  const store = await cookies();
  return store.get("pynk_auth")?.value === "ok";
}
