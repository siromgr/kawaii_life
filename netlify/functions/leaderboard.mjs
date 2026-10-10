// Bảng xếp hạng Kawaii Life — lưu trên Netlify Blobs
// GET  /api/leaderboard          → danh sách người chơi (JSON)
// GET  /kawaii-players.txt       → danh sách dạng notepad: Tên user | Tên file json | Thời điểm tạo | IP address tạo
// POST /api/leaderboard {action:"register"|"update"|"delete", ...}
import { getStore } from "@netlify/blobs";

const KEY = "players";
const BUDDIES = ["bunny", "kitty", "bear", "puppy"];
const slug = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "be";
const clean = (s, n) => String(s ?? "").replace(/[|\r\n<>]/g, " ").trim().slice(0, n);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fmt = iso => {
  try { return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }); }
  catch { return String(iso); }
};
const publicEntry = e => ({ name: e.name, file: e.file, createdAt: e.createdAt, ip: e.ip, gender: e.gender,
  babyName: e.babyName, buddy: e.buddy, record: e.record });
function cleanRecord(r, fallbackAt) {
  const level = Math.max(0, Math.min(6, parseInt(r?.level, 10) || 0));
  const money = Math.max(0, Math.min(1e6, parseInt(r?.money, 10) || 0));
  const at = isNaN(Date.parse(r?.at)) ? fallbackAt : new Date(r.at).toISOString();
  return { level, money, at };
}

export default async (req, context) => {
  const store = getStore({ name: "kawaii-life", consistency: "strong" });
  const url = new URL(req.url);
  const data = (await store.get(KEY, { type: "json" })) || { players: {} };
  const list = Object.values(data.players);

  if (req.method === "GET") {
    if (url.pathname.endsWith(".txt") || url.searchParams.get("format") === "txt") {
      const lines = list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(e => `${e.name} | ${e.file} | ${fmt(e.createdAt)} | ${e.ip}`);
      return new Response(["Tên user | Tên file json | Thời điểm tạo | IP address tạo", ...lines].join("\n") + "\n",
        { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }
    return json({ ok: true, players: list.map(publicEntry) });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad-json" }, 400); }

  if (body.action === "register") {
    const name = clean(body.name, 16);
    if (!name) return json({ ok: false, error: "no-name" }, 400);
    const file = `kawaii-${slug(name)}.json`;
    if (data.players[file]) return json({ ok: false, error: "exists" }, 409);
    const now = new Date().toISOString();
    const token = crypto.randomUUID();
    data.players[file] = {
      name, file, createdAt: now, ip: context.ip || req.headers.get("x-nf-client-connection-ip") || "không xác định",
      gender: body.gender === "m" ? "m" : body.gender === "f" ? "f" : null,
      babyName: clean(body.babyName, 12), buddy: BUDDIES.includes(body.buddy) ? body.buddy : "bunny",
      record: cleanRecord(body.record, now), token
    };
    await store.setJSON(KEY, data);
    return json({ ok: true, token, entry: publicEntry(data.players[file]) });
  }

  const e = data.players[body.file];
  if (!e) return json({ ok: false, error: "not-found" }, 404);
  if (!body.token || body.token !== e.token) return json({ ok: false, error: "token" }, 403);

  if (body.action === "update") {
    if (body.gender === "m" || body.gender === "f") e.gender = body.gender;
    if (body.babyName != null) e.babyName = clean(body.babyName, 12);
    if (BUDDIES.includes(body.buddy)) e.buddy = body.buddy;
    if (body.record) e.record = cleanRecord(body.record, e.record.at);
    await store.setJSON(KEY, data);
    return json({ ok: true, entry: publicEntry(e) });
  }
  if (body.action === "delete") {
    delete data.players[body.file];
    await store.setJSON(KEY, data);
    return json({ ok: true });
  }
  return json({ ok: false, error: "action" }, 400);
};

export const config = { path: ["/api/leaderboard", "/kawaii-players.txt"] };
