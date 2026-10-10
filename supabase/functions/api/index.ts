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
    .select("id,name,cat,kind,color,d,w,price,images,info,sort,use_for")
    .eq("active", true).order("sort").order("name");
  if (error) return json({ error: error.message }, 500);
  const items = (data as Item[]).map((r) => ({ ...r, d: Number(r.d), w: r.w == null ? undefined : Number(r.w) }));
  // 網頁端快取 5 分鐘，減少流量
  return json(items, 200, { "Cache-Control": "public, max-age=300" });
}

async function createOrder(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "格式錯誤" }, 400); }
  const type = body?.type === "necklace" ? "necklace" : "bracelet";
  const sequence = Array.isArray(body?.sequence) ? body.sequence : [];
  const claspId = type === "necklace" && body?.clasp?.id ? String(body.clasp.id) : null;
  const chainId = type === "necklace" && body?.chain?.id ? String(body.chain.id) : null;
  if (sequence.length > 400) return json({ error: "珠子數量不正確" }, 400);
  if (sequence.length === 0 && !chainId) return json({ error: "設計是空的" }, 400);

  // 不相信網頁送來的價格：依資料庫重新計算
  const ids = [...new Set([...sequence.map((s: any) => String(s.id)), ...(claspId ? [claspId] : []), ...(chainId ? [chainId] : [])])];
  const { data, error } = await sb.from("items").select("id,name,cat,d,w,price,active").in("id", ids);
  if (error) return json({ error: error.message }, 500);
  const byId = new Map((data ?? []).map((r: any) => [r.id, r]));
  const missing = ids.filter((id) => !byId.get(id)?.active);
  if (missing.length) return json({ error: `有已下架的素材：${missing.join(", ")}` }, 409);
  const parts = new Set(["clasp", "chain"]);
  if (sequence.some((s: any) => parts.has(byId.get(String(s.id))?.cat))) return json({ error: "扣頭與鍊條不能放在串珠順序裡" }, 400);
  if (claspId && byId.get(claspId)?.cat !== "clasp") return json({ error: "扣頭不正確" }, 400);
  if (chainId && byId.get(chainId)?.cat !== "chain") return json({ error: "鍊條不正確" }, 400);

  const sizeOf = (r: any) => r.cat === "spacer" ? `佔${Number(r.w ?? 2)}mm` : r.cat === "clasp" ? `長${Number(r.w ?? 0)}mm`
    : r.cat === "pendant" ? `高${Number(r.d)}mm` : `${Number(r.d)}mm`;
  const widthOf = (r: any) => Number(r.w ?? r.d);
  const counts = new Map<string, number>();
  for (const s of sequence) counts.set(String(s.id), (counts.get(String(s.id)) ?? 0) + 1);
  const items: any[] = [...counts].map(([id, qty]) => {
    const r: any = byId.get(id);
    return { id, name: r.name, size: sizeOf(r), unit: r.price, qty, subtotal: r.price * qty };
  });
  const beads = sequence.reduce((a: number, s: any) => a + widthOf(byId.get(String(s.id))), 0);
  let length = beads, lengthCM: number | null = null;
  if (type === "necklace") {
    lengthCM = Math.max(30, Math.min(120, Number(body.lengthCM) || 45));
    const clasp: any = claspId ? byId.get(claspId) : null;
    if (clasp) { items.push({ id: clasp.id, name: clasp.name, size: sizeOf(clasp), unit: clasp.price, qty: 1, subtotal: clasp.price }); length += widthOf(clasp); }
    if (chainId) {
      const ch: any = byId.get(chainId), mm = Math.max(0, lengthCM * 10 - length), cm = Math.ceil(mm / 10);
      if (cm > 0) items.push({ id: ch.id, name: ch.name, size: "依長度計價", unit: ch.price, qty: cm, unitLabel: `NT$${ch.price}/cm`, qtyLabel: `${cm} cm`, subtotal: ch.price * cm });
      length += mm;
    }
  }
  const total = items.reduce((a, i) => a + i.subtotal, 0);

  const code = String(body.code ?? "").slice(0, 12) || crypto.randomUUID().slice(0, 6).toUpperCase();
  const row = {
    code,
    type,
    wrist_mm: type === "bracelet" ? Number(body.wristMM) || null : null,
    fit: type === "bracelet" ? String(body.fit ?? "").slice(0, 10) || null : null,
    length_cm: lengthCM,
    clasp_id: claspId,
    chain_id: chainId,
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
