-- 串珠盤：資料表與照片儲存空間
-- 在 Supabase 後台 SQL Editor 整份貼上執行，或用 `supabase db push`。

-- 珠子（由 Notion 同步寫入，網頁只透過 Edge Function 讀取）
create table if not exists public.items (
  id              text primary key,          -- Notion「代碼」，例如 ame8
  notion_page_id  text unique,
  name            text not null,
  cat             text not null check (cat in ('bead','spacer','ball')),
  kind            text check (kind in ('gem','pearl','metal','spacer')),
  color           text,
  d               numeric not null,          -- 直徑；隔片為高度（mm）
  w               numeric,                   -- 串上佔寬（mm），隔片才需要
  price           integer not null default 0,
  images          text[] not null default '{}',
  info            jsonb not null default '{}'::jsonb,  -- origin, grade, months, tags, price, story, meaning
  sort            integer not null default 0,
  active          boolean not null default true,
  notion_edited   timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists items_active_sort on public.items (active, sort);

-- 訂單（Edge Function 依資料庫單價重新計算總價後寫入）
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  created_at    timestamptz not null default now(),
  status        text not null default 'new',   -- new / confirmed / made / shipped / cancelled
  wrist_mm      integer,
  fit           text,
  length_mm     numeric,
  target_mm     numeric,
  count         integer not null,
  total         integer not null,             -- 伺服器計算
  client_total  integer,                      -- 網頁送來的金額，對帳用
  items         jsonb not null,               -- [{id, name, size, unit, qty, subtotal}]
  sequence      jsonb not null,               -- 串法順序 [{id, v}]
  source        text not null default 'web',  -- web = 正式版；ar-test = AR 測試版送出的（測試訂單）
  note          text
);
create index if not exists orders_created on public.orders (created_at desc);

-- 開啟 RLS 且不開放任何 policy：瀏覽器拿 anon key 也讀寫不到，只有 Edge Function（service role）可以。
alter table public.items  enable row level security;
alter table public.orders enable row level security;

-- 公開讀取的照片空間（同步時從 Notion 複製過來，網址永久有效）
insert into storage.buckets (id, name, public)
values ('bead-photos', 'bead-photos', true)
on conflict (id) do nothing;
