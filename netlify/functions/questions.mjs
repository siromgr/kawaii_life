// Sinh câu hỏi trắc nghiệm bằng AI qua server (khóa API giấu trên Netlify)
// Đặt 1 hoặc nhiều khóa (game thử lần lượt, nguồn nào hết lượt thì chuyển sang nguồn sau):
//   GEMINI_API_KEY      Google AI Studio – có gói miễn phí   (GEMINI_MODEL, mặc định gemini-2.5-flash)
//   GROQ_API_KEY        Groq – có gói miễn phí                (GROQ_MODEL, mặc định llama-3.3-70b-versatile)
//   OPENROUTER_API_KEY  OpenRouter – có model ":free"          (OPENROUTER_MODEL)
//   AI_BASE_URL + AI_API_KEY + AI_MODEL  bất kỳ dịch vụ tương thích OpenAI
//   ANTHROPIC_API_KEY   Claude (trả phí)                       (ANTHROPIC_MODEL, mặc định claude-haiku-5-5)
// AI_DAILY_LIMIT: số lần gọi AI tối đa mỗi ngày (mặc định 300). Hết lượt thì dùng kho câu hỏi đã lưu.
// GET  /api/questions          → {enabled, providers, pool}
// POST /api/questions {subject, grade, diff, career, cambLevel} → {ok, questions, source}
import { getStore } from "@netlify/blobs";

const SUBJ = {
  math: "Toán",
  en: "Tiếng Anh: ngữ pháp và từ vựng. Câu hỏi và cả 4 đáp án phải viết HOÀN TOÀN bằng tiếng Anh, không dùng tiếng Việt",
  vn: "Tiếng Việt (từ loại, chính tả, từ đồng nghĩa, trái nghĩa, thành ngữ, tục ngữ)",
  social: "Kỹ năng giao tiếp và ứng xử: đưa ra một tình huống thường gặp, 4 cách ứng xử, chỉ 1 cách đúng nhất; phần explain giải thích lý do",
  camb: "Luyện thi Cambridge English. Câu hỏi và đáp án hoàn toàn bằng tiếng Anh"
};
const CAREER = { doctor: "bác sĩ", engineer: "kỹ sư", teacher: "giáo viên", chef: "đầu bếp", pilot: "phi công", artist: "họa sĩ", coder: "lập trình viên", business: "doanh nhân" };
const DNAME = ["dễ", "vừa", "khó"];
const TOPICS = {
  math: ["phép cộng trừ", "phép nhân chia", "bài toán có lời văn", "đo lường, đơn vị đo", "hình học", "phân số", "tìm x", "so sánh số", "trung bình cộng", "thời gian, lịch"],
  en: ["verb tenses", "prepositions", "articles a/an/the", "plural nouns", "comparatives", "question words", "vocabulary: animals", "vocabulary: school", "vocabulary: food", "pronouns"],
  vn: ["từ loại", "chính tả", "từ đồng nghĩa", "từ trái nghĩa", "thành ngữ, tục ngữ", "câu kể, câu hỏi, câu cảm, câu khiến", "chủ ngữ, vị ngữ", "từ láy, từ ghép"],
  social: ["ở trường", "ở nhà", "nơi công cộng", "an toàn trên mạng", "tình bạn", "an toàn giao thông", "lễ phép với người lớn"],
  camb: ["grammar", "vocabulary", "reading signs and notices", "everyday conversation replies", "prepositions"]
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function buildPrompt(b) {
  const g = Math.max(0, Math.min(12, parseInt(b.grade, 10) || 0));
  const lop = g === 0 ? "trẻ mẫu giáo 5 tuổi" : `học sinh lớp ${g} chương trình Việt Nam`;
  const subj = SUBJ[b.subject] || SUBJ.math;
  const career = CAREER[b.career] ? ` Hãy đặt bối cảnh câu hỏi liên quan tới nghề ${CAREER[b.career]} (ví dụ bài toán có lời văn về công việc của ${CAREER[b.career]}), nhưng độ khó kiến thức vẫn đúng mức ${lop}.` : "";
  const camb = b.subject === "camb" && b.cambLevel ? ` Cấp độ: ${b.cambLevel}.` : "";
  const tp = TOPICS[b.subject] ? TOPICS[b.subject][Math.floor(Math.random() * TOPICS[b.subject].length)] : "";
  return `Tạo 5 câu hỏi trắc nghiệm môn ${subj} cho ${lop}, mức ${DNAME[b.diff] || "vừa"}.${tp ? " Chủ đề: " + tp + "." : ""}${camb}${career}
Yêu cầu: mỗi câu có đúng 4 lựa chọn ngắn gọn, chỉ 1 đáp án đúng, các đáp án không trùng nhau, nội dung chính xác tuyệt đối (hãy tự kiểm tra lại phép tính), thân thiện với trẻ em. Không dùng hình ảnh.
Chỉ trả về JSON hợp lệ, không viết gì khác, theo dạng:
[{"q":"câu hỏi","choices":["A","B","C","D"],"answer":0,"explain":"giải thích ngắn bằng tiếng Việt"}]
trong đó answer là số thứ tự 0-3 của đáp án đúng.`;
}
function parse(text) {
  let o = null;
  try { o = JSON.parse(text); } catch { const m = String(text).match(/\[[\s\S]*\]/); if (m) try { o = JSON.parse(m[0]); } catch { } }
  if (o && !Array.isArray(o)) o = o.questions || Object.values(o).find(Array.isArray) || null;
  if (!Array.isArray(o)) return [];
  return o.filter(x => x && typeof x.q === "string" && Array.isArray(x.choices) && x.choices.length === 4
    && new Set(x.choices.map(String)).size === 4 && Number.isInteger(+x.answer) && +x.answer >= 0 && +x.answer < 4)
    .map(x => ({ q: x.q.slice(0, 400), choices: x.choices.map(c => String(c).slice(0, 120)), answer: +x.answer, explain: String(x.explain || "").slice(0, 300) }));
}
async function askAnthropic(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || r.status);
  return (j.content || []).map(c => c.text || "").join("");
}
async function askGemini(prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.9 } })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || r.status);
  return j?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

async function askOpenAI(base, key, model, prompt, extraHeaders = {}) {
  const r = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
    method: "POST", headers: { "authorization": "Bearer " + key, "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify({ model, temperature: 0.9, messages: [{ role: "user", content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || r.status);
  return j?.choices?.[0]?.message?.content || "";
}
function providers() {
  const e = process.env, list = [];
  if (e.GEMINI_API_KEY) list.push({ name: "gemini", run: askGemini });
  if (e.GROQ_API_KEY) list.push({ name: "groq", run: p => askOpenAI("https://api.groq.com/openai/v1", e.GROQ_API_KEY, e.GROQ_MODEL || "llama-3.3-70b-versatile", p) });
  if (e.OPENROUTER_API_KEY && e.OPENROUTER_MODEL) list.push({ name: "openrouter", run: p => askOpenAI("https://openrouter.ai/api/v1", e.OPENROUTER_API_KEY, e.OPENROUTER_MODEL, p) });
  if (e.AI_BASE_URL && e.AI_API_KEY && e.AI_MODEL) list.push({ name: "custom", run: p => askOpenAI(e.AI_BASE_URL, e.AI_API_KEY, e.AI_MODEL, p) });
  if (e.ANTHROPIC_API_KEY) list.push({ name: "anthropic", run: askAnthropic });
  return list;
}
const sampleN = (a, n) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

export default async (req) => {
  const list = providers();
  const store = getStore("kawaii-ai");
  if (req.method === "GET") return json({ enabled: list.length > 0, providers: list.map(p => p.name) });
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad-json" }, 400); }
  const g = Math.max(0, Math.min(12, parseInt(b.grade, 10) || 0));
  const poolKey = `pool/${b.subject}/g${g}/d${parseInt(b.diff, 10) || 0}/${b.career || "-"}/${b.subject === "camb" ? (b.cambLevel || "-") : "-"}`;
  const pool = (await store.get(poolKey, { type: "json" })) || [];
  const day = new Date().toISOString().slice(0, 10);
  const used = parseInt(await store.get("count/" + day), 10) || 0;
  const limit = parseInt(process.env.AI_DAILY_LIMIT, 10) || 300;
  const errors = [];
  if (list.length && used < limit) {
    const prompt = buildPrompt(b);
    for (const p of list) {
      try {
        const questions = parse(await p.run(prompt));
        if (!questions.length) throw new Error("empty");
        await store.set("count/" + day, String(used + 1));
        const seen = new Set(pool.map(x => x.q));
        const merged = pool.concat(questions.filter(x => !seen.has(x.q))).slice(-600);
        await store.setJSON(poolKey, merged);
        return json({ ok: true, questions, source: p.name });
      } catch (e) { errors.push(p.name + ": " + (e.message || e)); }
    }
  }
  if (pool.length) return json({ ok: true, questions: sampleN(pool, 8), source: "kho-cau-hoi", errors });
  return json({ ok: false, error: list.length ? "Tất cả nguồn AI đang lỗi hoặc hết lượt" : "AI chưa được cấu hình", errors }, 503);
};
export const config = { path: "/api/questions" };
