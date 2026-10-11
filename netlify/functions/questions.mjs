// Sinh câu hỏi trắc nghiệm bằng AI qua server (khóa API giấu trên Netlify)
// Đặt 1 hoặc nhiều khóa (game thử lần lượt, nguồn nào hết lượt thì chuyển sang nguồn sau):
//   GEMINI_API_KEY      Google AI Studio – có gói miễn phí   (GEMINI_MODEL, mặc định gemini-2.5-flash)
//   GROQ_API_KEY        Groq – có gói miễn phí                (GROQ_MODEL, mặc định llama-3.3-70b-versatile)
//   OPENROUTER_API_KEY  OpenRouter – có model ":free"          (OPENROUTER_MODEL)
//   AI_BASE_URL + AI_API_KEY + AI_MODEL  bất kỳ dịch vụ tương thích OpenAI
//   ANTHROPIC_API_KEY   Claude (trả phí)                       (ANTHROPIC_MODEL, mặc định claude-haiku-5-5)
// AI_DAILY_LIMIT: số lần gọi AI tối đa mỗi ngày (mặc định 300). Hết lượt thì dùng kho câu hỏi đã lưu.
// GET  /api/questions          → {enabled, providers}
// GET  /api/questions?test=1   → tự kiểm tra từng khóa AI, báo lỗi cụ thể (dành cho người quản lý)
// POST /api/questions {subject, grade, diff, career, cambLevel} → {ok, questions, source}

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
class AIError extends Error { constructor(msg, kind, status) { super(msg); this.kind = kind; this.status = status || 0; } }
// kind: "key" (khóa sai), "quota" (hết lượt), "model" (model không tồn tại), "other"
function classify(status, msg) {
  const m = String(msg || "").toLowerCase();
  if (status === 401 || status === 403 || /api key|apikey|unauthor|permission|invalid.*key/.test(m)) return "key";
  if (status === 429 || /quota|rate limit|exhausted/.test(m)) return "quota";
  if (status === 404 || /not found|decommission|does not exist|not supported|unknown model|no longer/.test(m)) return "model";
  return "other";
}
let DEADLINE = 0; // thời điểm phải xong (Netlify cắt hàm sau ~10 giây)
async function callJSON(url, opts) {
  const left = DEADLINE ? DEADLINE - Date.now() : 8000;
  if (left < 1500) throw new AIError("Hết thời gian chờ (server chỉ được chạy khoảng 10 giây)", "timeout", 0);
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), Math.min(8000, left));
  let r;
  try { r = await fetch(url, { ...opts, signal: c.signal }); }
  catch (e) { clearTimeout(tm); throw new AIError(e.name === "AbortError" ? "Dịch vụ AI trả lời quá chậm (quá thời gian chờ)" : String(e.message || e), e.name === "AbortError" ? "timeout" : "network", 0); }
  clearTimeout(tm);
  let j = {}; try { j = await r.json(); } catch { }
  if (!r.ok) { const msg = j?.error?.message || j?.message || ("HTTP " + r.status); throw new AIError(msg, classify(r.status, msg), r.status); }
  return j;
}
async function askAnthropic(prompt, model) {
  const j = await callJSON("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
  });
  return (j.content || []).map(c => c.text || "").join("");
}
async function askGemini(prompt, model) {
  const j = await callJSON(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.9, ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } })
  });
  return j?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}
function openAI(base, key) {
  return async (prompt, model) => {
    const j = await callJSON(base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST", headers: { "authorization": "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.9, messages: [{ role: "user", content: prompt }] })
    });
    return j?.choices?.[0]?.message?.content || "";
  };
}
const uniq = a => [...new Set(a.filter(Boolean))];
function providers() {
  const e = process.env, list = [];
  if (e.GEMINI_API_KEY) list.push({ name: "gemini", run: askGemini, models: uniq([e.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.0-flash"]) });
  if (e.GROQ_API_KEY) list.push({ name: "groq", run: openAI("https://api.groq.com/openai/v1", e.GROQ_API_KEY), models: uniq([e.GROQ_MODEL, "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant", "openai/gpt-oss-20b"]) });
  if (e.OPENROUTER_API_KEY && e.OPENROUTER_MODEL) list.push({ name: "openrouter", run: openAI("https://openrouter.ai/api/v1", e.OPENROUTER_API_KEY), models: [e.OPENROUTER_MODEL] });
  if (e.AI_BASE_URL && e.AI_API_KEY && e.AI_MODEL) list.push({ name: "custom", run: openAI(e.AI_BASE_URL, e.AI_API_KEY), models: [e.AI_MODEL] });
  if (e.ANTHROPIC_API_KEY) list.push({ name: "anthropic", run: askAnthropic, models: uniq([e.ANTHROPIC_MODEL, "claude-haiku-5-5"]) });
  return list;
}
/* thử lần lượt các model của 1 nhà cung cấp; khóa sai / hết lượt thì dừng luôn */
async function runProvider(p, prompt, attempts = []) {
  let last;
  for (const m of p.models) {
    try { const text = await p.run(prompt, m); attempts.push({ model: m, ok: true }); return { text, model: m }; }
    catch (e) {
      if (!(e instanceof AIError)) e = new AIError(String(e.message || e), "network", 0);
      attempts.push({ model: m, ok: false, status: e.status, error: String(e.message).slice(0, 200) });
      last = e; if (e.kind === "key" || e.kind === "quota") break;
    }
  }
  throw last || new AIError("no model", "other");
}
async function getBlobStore() { try { const m = await import("@netlify/blobs"); return m.getStore("kawaii-ai"); } catch { return null; } }
async function sget(store, k, type) { if (!store) return null; try { return await store.get(k, type ? { type } : undefined); } catch { return null; } }
async function sset(store, k, v, json) { if (!store) return; try { json ? await store.setJSON(k, v) : await store.set(k, v); } catch { } }
const sampleN = (a, n) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

const KIND_VI = { key: "Khóa API sai hoặc chưa được cấp quyền", quota: "Đã hết lượt miễn phí, thử lại sau", model: "Model không còn tồn tại", network: "Server không kết nối được tới dịch vụ AI", timeout: "Quá thời gian chờ", other: "Lỗi khác" };

export default async (req) => {
  const list = providers();
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("test")) {
    DEADLINE = Date.now() + 9000;
    const e = process.env, mask = k => e[k] ? `có (dài ${e[k].length} ký tự, bắt đầu “${e[k].slice(0, 4)}…”)` : "chưa có";
    const out = { node: process.version, keys: { GEMINI_API_KEY: mask("GEMINI_API_KEY"), GROQ_API_KEY: mask("GROQ_API_KEY"), OPENROUTER_API_KEY: mask("OPENROUTER_API_KEY"), ANTHROPIC_API_KEY: mask("ANTHROPIC_API_KEY") }, blobs: !!(await getBlobStore()), results: [] };
    if (!list.length) out.results.push({ provider: "(không có)", ok: false, loi: "Server không đọc được khóa nào. Kiểm tra tên biến môi trường và deploy lại." });
    const listUrl = { gemini: ["https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": e.GEMINI_API_KEY }],
                      groq: ["https://api.groq.com/openai/v1/models", { authorization: "Bearer " + e.GROQ_API_KEY }] };
    const prompt = buildPrompt({ subject: "math", grade: 4, diff: 0 }).replace("Tạo 5 câu", "Tạo 1 câu");
    out.results = out.results.concat(await Promise.all(list.map(async p => {
      const t0 = Date.now(), res = { provider: p.name, ok: false };
      if (listUrl[p.name]) {
        try {
          const j = await callJSON(listUrl[p.name][0], { headers: listUrl[p.name][1] });
          const names = (j.models || j.data || []).map(m => String(m.name || m.id).replace(/^models\//, ""));
          res.key = "✅ Khóa hợp lệ"; res.modelsOk = p.models.filter(m => names.includes(m));
          if (res.modelsOk.length) p.models = res.modelsOk;
        } catch (err) { res.key = "❌ " + (KIND_VI[err.kind] || err.kind); res.status = err.status; res.error = String(err.message).slice(0, 300); res.loi = KIND_VI[err.kind]; res.ms = Date.now() - t0; return res; }
      }
      const attempts = []; p.models = p.models.slice(0, 2);
      try { const r = await runProvider(p, prompt, attempts); const qs = parse(r.text);
        Object.assign(res, { ok: qs.length > 0, model: r.model, sample: qs[0]?.q || r.text.slice(0, 160), loi: qs.length ? "" : "AI trả lời sai định dạng" }); }
      catch (err) { Object.assign(res, { status: err.status, error: String(err.message).slice(0, 300), loi: KIND_VI[err.kind] || err.kind }); }
      res.attempts = attempts; res.ms = Date.now() - t0; return res;
    })));
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  if (req.method === "GET") return json({ enabled: list.length > 0, providers: list.map(p => p.name) });
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad-json" }, 400); }
  const store = await getBlobStore();
  const g = Math.max(0, Math.min(12, parseInt(b.grade, 10) || 0));
  const poolKey = `pool/${b.subject}/g${g}/d${parseInt(b.diff, 10) || 0}/${b.career || "-"}/${b.subject === "camb" ? (b.cambLevel || "-") : "-"}`;
  const pool = (await sget(store, poolKey, "json")) || [];
  const day = new Date().toISOString().slice(0, 10);
  const used = parseInt(await sget(store, "count/" + day), 10) || 0;
  const limit = parseInt(process.env.AI_DAILY_LIMIT, 10) || 300;
  const errors = [];
  if (list.length && used < limit) {
    DEADLINE = Date.now() + 9000;
    const prompt = buildPrompt(b);
    for (const p of list) {
      try {
        const r = await runProvider(p, prompt);
        const questions = parse(r.text);
        if (!questions.length) throw new AIError("AI trả về sai định dạng", "other");
        await sset(store, "count/" + day, String(used + 1));
        const seen = new Set(pool.map(x => x.q));
        await sset(store, poolKey, pool.concat(questions.filter(x => !seen.has(x.q))).slice(-600), true);
        return json({ ok: true, questions, source: p.name + "/" + r.model });
      } catch (e) { errors.push(`${p.name}: ${KIND_VI[e.kind] || ""}${e.status ? " [HTTP " + e.status + "]" : ""} (${String(e.message).slice(0, 160)})`); }
    }
  }
  if (pool.length) return json({ ok: true, questions: sampleN(pool, 8), source: "kho-cau-hoi", errors });
  return json({ ok: false, error: list.length ? "Tất cả nguồn AI đang lỗi hoặc hết lượt" : "AI chưa được cấu hình", errors }, 503);
};
export const config = { path: "/api/questions" };
