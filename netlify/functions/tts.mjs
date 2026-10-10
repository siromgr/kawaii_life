// Giọng đọc tiếng Việt online qua FPT.AI (cần biến môi trường FPTAI_API_KEY trên Netlify)
// GET /api/tts?check=1                     → {enabled:true|false}
// GET /api/tts?voice=banmai&text=Xin chào  → file mp3 (có lưu đệm trên Netlify Blobs để đỡ tốn lượt)
import { getStore } from "@netlify/blobs";

const VOICES = ["banmai", "thuminh", "leminh", "myan", "giahuy", "lannhi", "linhsan"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export default async (req) => {
  const url = new URL(req.url);
  const key = process.env.FPTAI_API_KEY;
  if (url.searchParams.get("check")) return Response.json({ enabled: !!key, voices: VOICES });
  if (!key) return new Response("TTS chưa được cấu hình", { status: 503 });

  const text = String(url.searchParams.get("text") || "").trim().slice(0, 500);
  const voice = VOICES.includes(url.searchParams.get("voice")) ? url.searchParams.get("voice") : "banmai";
  if (!text) return new Response("thiếu text", { status: 400 });

  const store = getStore("kawaii-tts");
  const id = await sha(voice + "|" + text);
  const cached = await store.get(id, { type: "arrayBuffer" });
  const audio = buf => new Response(buf, { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=31536000, immutable" } });
  if (cached) return audio(cached);

  const r = await fetch("https://api.fpt.ai/hmi/tts/v5", {
    method: "POST", headers: { "api-key": key, voice, speed: "0" }, body: text
  });
  const j = await r.json().catch(() => ({}));
  if (!j.async) return new Response("FPT.AI lỗi: " + (j.message || r.status), { status: 502 });

  // FPT.AI trả về link mp3, file sẵn sàng sau vài giây
  for (let i = 0; i < 14; i++) {
    await sleep(i < 3 ? 400 : 600);
    const a = await fetch(j.async);
    if (a.ok && (a.headers.get("content-type") || "").includes("audio")) {
      const buf = await a.arrayBuffer();
      await store.set(id, buf);
      return audio(buf);
    }
  }
  return new Response("Hết thời gian chờ FPT.AI", { status: 504 });
};

export const config = { path: "/api/tts" };
