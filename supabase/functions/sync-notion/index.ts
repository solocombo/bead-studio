// 把 Notion 珠子資料庫同步到 Supabase。
// 部署：supabase functions deploy sync-notion --no-verify-jwt
// 呼叫：POST /functions/v1/sync-notion   header: x-sync-secret: <SYNC_SECRET>
//      加 ?full=1 會忽略「沒改過就跳過」，全部重抓
// 需要的 secrets：NOTION_TOKEN, NOTION_DATABASE_ID, SYNC_SECRET
import { createClient } from "npm:@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN")!;
const DATABASE_ID = Deno.env.get("NOTION_DATABASE_ID")!;
const SYNC_SECRET = Deno.env.get("SYNC_SECRET")!;
const BUCKET = "bead-photos";
const NOTION_VERSION = "2022-06-28";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

/* ---------- Notion 欄位名稱 → 網頁欄位（要跟 notion/schema.md 一致） ---------- */
const CAT: Record<string, string> = { "主珠": "bead", "隔片": "spacer", "隔珠": "ball", "墜子": "pendant", "扣頭": "clasp", "鍊條": "chain" };
const KIND: Record<string, string> = { "寶石": "gem", "珍珠": "pearl", "金屬": "metal", "隔片": "spacer" };
const VARIANT: Record<string, string> = { "龍蝦扣": "lobster", "T字扣": "toggle", "磁扣": "magnet", "水滴": "drop", "月亮": "moon", "珍珠": "pearl" };
const USE: Record<string, string> = { "手鍊": "bracelet", "項鍊": "necklace" };
const COLOR: Record<string, string> = {
  "白透": "clear", "灰": "grey", "黑": "black", "綠": "green", "黃金": "yellow", "粉": "pink", "紫": "purple", "藍": "blue",
};
const SECTIONS: Record<string, string> = { "價格說明": "price", "故事": "story", "寓意": "meaning" };

/* ---------- Notion API（平均每秒 3 次以內） ---------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function notion(path: string, init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    });
    if (r.status === 429) { await sleep(Number(r.headers.get("retry-after") ?? 1) * 1000); continue; }
    if (!r.ok) throw new Error(`Notion ${path} ${r.status}: ${await r.text()}`);
    await sleep(340);
    return r.json();
  }
  throw new Error(`Notion ${path}: rate limited`);
}

async function queryAll() {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion(`/databases/${DATABASE_ID}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/* ---------- 屬性讀取 ---------- */
const plain = (rt: any[] = []) => rt.map((t) => t.plain_text).join("").trim();
const rich = (rt: any[] = []) =>
  rt.map((t) => (t.annotations?.bold ? `**${t.plain_text}**` : t.plain_text)).join("");
function prop(page: any, name: string) {
  const p = page.properties?.[name];
  if (!p) return undefined;
  switch (p.type) {
    case "title": return plain(p.title);
    case "rich_text": return plain(p.rich_text);
    case "number": return p.number;
    case "select": return p.select?.name;
    case "multi_select": return p.multi_select.map((o: any) => o.name);
    case "checkbox": return p.checkbox;
    case "files": return p.files.map((f: any) => f.type === "file" ? f.file.url : f.external.url);
    default: return undefined;
  }
}

/* ---------- 頁面內文 → 依標題分段的 Markdown ---------- */
async function pageSections(pageId: string) {
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  let cursor: string | undefined;
  do {
    const res = await notion(`/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of res.results) {
      const t = b.type, v = b[t];
      if (t.startsWith("heading_")) { current = SECTIONS[plain(v.rich_text)] ?? null; continue; }
      if (!current) continue;
      const text = rich(v?.rich_text);
      if (t === "paragraph") (out[current] ??= []).push(text);
      else if (t === "bulleted_list_item" || t === "numbered_list_item") (out[current] ??= []).push(`- ${text}`);
      else if (t === "quote" || t === "callout") (out[current] ??= []).push(text);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return Object.fromEntries(Object.entries(out).map(([k, lines]) => [k, lines.join("\n").trim()]));
}

/* ---------- 照片：Notion 的檔案網址一小時就失效，複製到 Supabase Storage ---------- */
async function copyImages(id: string, urls: string[]) {
  const out: string[] = [];
  for (const [i, url] of urls.slice(0, 3).entries()) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`下載照片失敗 ${id} #${i + 1}: ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const type = r.headers.get("content-type") ?? "image/png";
    const ext = type.includes("webp") ? "webp" : type.includes("jpeg") ? "jpg" : "png";
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${id}/${i + 1}-${hash}.${ext}`;   // 內容沒變，路徑就一樣，不會重複上傳
    const up = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: type, upsert: false, cacheControl: "31536000",
    });
    if (up.error && !/exists|Duplicate/i.test(up.error.message)) throw up.error;
    out.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-sync-secret") !== SYNC_SECRET) return new Response("unauthorized", { status: 401 });
  const full = new URL(req.url).searchParams.get("full") === "1";
  const log: string[] = [];
  try {
    const pages = await queryAll();
    const { data: existing } = await sb.from("items").select("id,notion_page_id,notion_edited,images,info");
    const prev = new Map((existing ?? []).map((r: any) => [r.notion_page_id, r]));
    const seen: string[] = [];

    for (const page of pages) {
      const name = prop(page, "名稱");
      const id = prop(page, "代碼") || page.id.replace(/-/g, "").slice(0, 10);
      if (!name) { log.push(`略過沒有名稱的頁面 ${page.id}`); continue; }
      const cat = CAT[prop(page, "分類") ?? "主珠"] ?? "bead";
      const old = prev.get(page.id);
      const unchanged = !full && old && old.notion_edited &&
        new Date(old.notion_edited).getTime() === new Date(page.last_edited_time).getTime();

      let images = old?.images ?? [];
      let sections: Record<string, string> = {
        price: old?.info?.price ?? "", story: old?.info?.story ?? "", meaning: old?.info?.meaning ?? "",
      };
      if (!unchanged) {
        images = await copyImages(id, prop(page, "照片") ?? []);
        sections = { ...{ price: "", story: "", meaning: "" }, ...(await pageSections(page.id)) };
      }

      const months = (prop(page, "生日石") ?? []).map((m: string) => parseInt(m)).filter((n: number) => n >= 1 && n <= 12);
      const row = {
        id,
        notion_page_id: page.id,
        name,
        cat,
        kind: ["pendant", "clasp", "chain"].includes(cat) ? cat : KIND[prop(page, "外觀") ?? ""] ?? null,
        variant: VARIANT[prop(page, "樣式") ?? ""] ?? null,
        use_for: (() => { const u = (prop(page, "適用") ?? []).map((x: string) => USE[x]).filter(Boolean);
          return u.length ? u : ["pendant", "clasp", "chain"].includes(cat) ? ["necklace"] : ["bracelet", "necklace"]; })(),
        color: COLOR[prop(page, "色系") ?? ""] ?? null,
        d: prop(page, "直徑mm") ?? 8,
        w: prop(page, "佔寬mm") ?? null,
        price: Math.round(prop(page, "單價") ?? 0),
        images,
        info: {
          origin: prop(page, "產地") ?? "", grade: prop(page, "等級") ?? "",
          months, tags: prop(page, "標籤") ?? [], ...sections,
        },
        sort: prop(page, "排序") ?? 0,
        active: prop(page, "上架") ?? true,
        notion_edited: page.last_edited_time,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("items").upsert(row, { onConflict: "id" });
      if (error) throw error;
      seen.push(id);
      log.push(`${unchanged ? "未變更" : "已更新"} ${id} ${name}`);
    }

    // Notion 裡刪掉的頁面 → 下架（保留資料，舊訂單還查得到）
    if (seen.length) {
      const { error } = await sb.from("items").update({ active: false })
        .not("id", "in", `(${seen.map((s) => `"${s}"`).join(",")})`);
      if (error) throw error;
    }
    return Response.json({ ok: true, count: seen.length, log });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message ?? e), log }, { status: 500 });
  }
});
