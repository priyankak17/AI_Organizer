import { GoogleGenAI } from "@google/genai";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";

// gemini-2.5-flash is on Google's free tier (1,500 requests/day, no card).
// If a newer free Flash model is offered, you can change this one line.
const MODEL = "gemini-2.5-flash";

export async function POST(req) {
  if (!(await isAuthed())) {
    return new Response(JSON.stringify({ text: "Please log in first." }), { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({
      text: "No GEMINI_API_KEY is set. Add it to your environment to switch the AI buttons on.",
    });
  }

  let prompt = "";
  let system;
  let search = false;
  try {
    const body = await req.json();
    prompt = body.prompt || "";
    system = body.system;
    search = Boolean(body.search);
  } catch {
    return Response.json({ text: "Bad request." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const config = {};
    if (system) config.systemInstruction = system;
    // search grounding is built in, no Console toggle needed
    if (search) config.tools = [{ googleSearch: {} }];

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config,
    });

    let text = (response.text || "").trim();

    // when we searched, append the real source links Google actually used,
    // so the reads are never invented
    if (search) {
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = [];
      const seen = new Set();
      for (const c of chunks) {
        const w = c.web;
        if (w && w.uri && !seen.has(w.uri)) {
          seen.add(w.uri);
          sources.push(`${w.title || "source"}: ${w.uri}`);
        }
      }
      if (sources.length) {
        text += "\n\nSources:\n" + sources.join("\n");
      }
    }

    return Response.json({ text: text || "No response came back. Try again." });
  } catch (e) {
    // surface the real reason, never a fake success
    const reason = e && e.message ? e.message : "unknown error";
    return Response.json({ text: "AI request failed: " + reason });
  }
}
