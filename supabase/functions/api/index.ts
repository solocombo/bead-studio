// 公開 API：網頁讀取珠子清單、送出訂單。
// 部署：supabase functions deploy api --no-verify-jwt
//   GET  /functions/v1/api/catalog
//   POST /functions/v1/api/orders
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// 上線後把 ALLOWED_ORIGIN 設成你的網站網址（例如 https://xxx.github.io），避免別的網站呼叫
const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });

type Item = {
  id: string; name: string; cat: string; kind: string | null; color: string | null;
  d: number; w: number | null; price: number; images: string[]; info: Record<string, unknown>; sort: number;
};

async function catalog() {
  const { data, error } = await sb.from("items")
    .select("id,name,cat,kind,color,d,w,price,images,info,sort")
    .eq("active", true).order("sort").order("name");
  if (error) return json({ error: error.message }, 500);
  const items = (data as Item[]).map((r) => ({ ...r, d: Number(r.d), w: r.w == null ? undefined : Number(r.w) }));
  // 網頁端快取 5 分鐘，減少流量
  return json(items, 200, { "Cache-Control": "public, max-age=300" });
}

async function createOrder(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "格式錯誤" }, 400); }
  const sequence = Array.isArray(body?.sequence) ? body.sequence : null;
  if (!sequence || sequence.length === 0 || sequence.length > 300) return json({ error: "珠子數量不正確" }, 400);

  // 不相信網頁送來的價格：依資料庫重新計算
  const ids = [...new Set(sequence.map((s: any) => String(s.id)))];
  const { data, error } = await sb.from("items").select("id,name,cat,d,w,price,active").in("id", ids);
  if (error) return json({ error: error.message }, 500);
  const byId = new Map((data ?? []).map((r: any) => [r.id, r]));
  const missing = ids.filter((id) => !byId.get(id)?.active);
  if (missing.length) return json({ error: `有已下架的珠子：${missing.join(", ")}` }, 409);

  const counts = new Map<string, number>();
  for (const s of sequence) counts.set(String(s.id), (counts.get(String(s.id)) ?? 0) + 1);
  const items = [...counts].map(([id, qty]) => {
    const r: any = byId.get(id);
    const size = r.cat === "spacer" ? `佔${Number(r.w ?? 2)}mm` : `${Number(r.d)}mm`;
    return { id, name: r.name, size, unit: r.price, qty, subtotal: r.price * qty };
  });
  const total = items.reduce((a, i) => a + i.subtotal, 0);
  const length = sequence.reduce((a: number, s: any) => {
    const r: any = byId.get(String(s.id)); return a + Number(r.cat === "spacer" ? (r.w ?? 2) : (r.w ?? r.d));
  }, 0);

  const code = String(body.code ?? "").slice(0, 12) || crypto.randomUUID().slice(0, 6).toUpperCase();
  const row = {
    code,
    wrist_mm: Number(body.wristMM) || null,
    fit: String(body.fit ?? "").slice(0, 10) || null,
    length_mm: Math.round(length * 10) / 10,
    target_mm: Number(body.targetMM) || null,
    count: sequence.length,
    total,
    client_total: Number(body.total) || null,
    items,
    sequence: sequence.map((s: any) => ({ id: String(s.id), v: Number(s.v) || 0 })),
    note: body.note ? String(body.note).slice(0, 500) : null,
    source: ["web", "ar-test"].includes(body.source) ? body.source : "web",
  };
  const ins = await sb.from("orders").insert(row).select("id,code,total").single();
  if (ins.error) return json({ error: ins.error.message }, 500);
  return json({ id: ins.data.code, total: ins.data.total });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const path = new URL(req.url).pathname.replace(/^.*\/api/, "") || "/";
  try {
    if (req.method === "GET" && path === "/catalog") return await catalog();
    if (req.method === "POST" && path === "/orders") return await createOrder(req);
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
