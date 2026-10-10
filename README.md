# 串珠盤 Bead Studio

手串設計模擬器：散盤自由擺放、圓形刻度串珠盤排序、3D 戴上預覽、一鍵輸出設計單。
珠子資料在 **Notion** 編輯，同步到 **Supabase**，網頁放在 **GitHub Pages**。全部用免費方案。

```
Notion 資料庫（你編輯珠子、照片、介紹）
   │  sync-notion（每天自動 / 手動觸發）
   ▼
Supabase：items、orders 資料表 ＋ bead-photos 照片空間
   │  api（GET /catalog、POST /orders）
   ▼
GitHub Pages：web/index.html
```

## 檔案結構

| 路徑 | 內容 |
|---|---|
| `src/bead-studio.html` | **網頁原始檔，平常只改這份** |
| `src/ar.js` | AR 試戴外掛（測試中），只透過 `window.BeadStudio` 介面和主程式溝通 |
| `scripts/build.py` | 由 `src/` 產生 `web/` 的網頁 |
| `web/index.html` | 正式版（自動產生，不要手改） |
| `web/ar.html`、`web/ar.js` | AR 測試版＝正式版＋ar.js（自動產生，不要手改） |
| `web/config.js` | 部署設定：填入 API 網址。**不放金鑰** |
| `supabase/migrations/` | 資料表與照片空間的 SQL |
| `supabase/functions/api/` | 公開 API：讀珠子清單、送出訂單（伺服器重新計價） |
| `supabase/functions/sync-notion/` | Notion → Supabase 同步，照片複製到 Storage |
| `notion/schema.md` | Notion 資料庫欄位規格 |
| `.github/workflows/` | 自動建置＋部署網頁、每日同步 Notion |

## 沒接後端也能用

直接打開 `web/index.html` 就會用內建的範例珠子運作。`web/config.js` 的 `apiBase` 留 `null` 即可。

## 部署步驟

### 1. Notion

依 [`notion/schema.md`](notion/schema.md) 建資料庫、建 integration、把資料庫連結給 integration，記下：

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`

### 2. Supabase

1. 在 <https://supabase.com> 建立專案，記下 Project ref（網址裡那串英數字）。
2. 後台 **SQL Editor** → 貼上 `supabase/migrations/20261009000000_init.sql` 全文執行。
3. 安裝 Supabase CLI 後，在 repo 根目錄執行：

```bash
supabase login
supabase link --project-ref <你的 project ref>

cp .env.example .env          # 填入 Notion token、資料庫 ID、自訂 SYNC_SECRET、網站網址
supabase secrets set --env-file .env

supabase functions deploy api --no-verify-jwt
supabase functions deploy sync-notion --no-verify-jwt
```

4. 第一次同步：

```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/sync-notion" -H "x-sync-secret: <SYNC_SECRET>"
```

回傳 `{"ok":true,"count":…}` 就成功了。

### 3. 網頁

1. 編輯 `web/config.js`：

```js
window.BEAD_CONFIG = { apiBase: 'https://<ref>.supabase.co/functions/v1/api' };
```

2. GitHub repo → **Settings → Pages → Source** 選 **GitHub Actions**。推到 `main` 就會自動部署，網址是 `https://<帳號>.github.io/<repo>/`。
3. 回到 `.env` 把 `ALLOWED_ORIGIN` 設成 `https://<帳號>.github.io`，再跑一次 `supabase secrets set --env-file .env`。

### 4. 每日自動同步

GitHub repo → **Settings → Secrets and variables → Actions** 新增：

- `SUPABASE_FUNCTIONS_URL` = `https://<ref>.supabase.co/functions/v1`
- `SYNC_SECRET` = 同上

之後每天台灣時間 03:00 自動同步；改完 Notion 想馬上更新，到 **Actions → Sync Notion catalog → Run workflow**。

## 手鍊／項鍊

頂部切換「手鍊／項鍊」，兩邊各自保留一份設計。

- 項鍊：選總長度（40–80 cm，顯示頸鍊／公主／馬汀尼／歌劇長度），扣頭與鍊條在素材區點選（再點一次取消）。
- 選了鍊條：珠子排在正中央，兩側不足的長度由鍊條補滿，依公分計價；沒選鍊條：珠子＋扣頭要湊到目標長度。
- 墜子放在串珠順序的哪裡，就掛在哪裡（通常放正中央）。
- 項鍊盤是 U 形，刻度從正中央往兩側量；雙指或滾輪放大、拖曳空白處平移、點兩下還原。
- 項鍊的「戴上看」是無臉半身人模，左下「人模設定」可選：性別、髮型（女：長直髮／鮑伯短髮／綁起來；男：短髮／中長髮）、髮色、領口（圓領／V 領／襯衫／不穿）、衣服顏色、頸圍（29–42 cm）。膚色沿用手鍊的四色。
- 項鍊會依重力自然下垂、靠在衣服或皮膚上（簡化的物理模擬，約 4–6 秒內靜止）；同樣長度，頸圍越粗戴起來越高。
- 人模是程式即時生成的，換性別、領口或髮型要重建約 0.3–0.5 秒（電腦），手機約 1–2 秒。
- 項鍊也有 AR 試戴（見下方「AR 試戴」）。
- 範例扣頭、鍊條、墜子的價格與尺寸都是假資料，上線前在 Notion 改成實際數字。

## AR 試戴（測試版）

AR 是**外掛**：`web/ar.html` 由建置程式自動產生，內容＝正式版＋`ar.js`。所以正式版改了什麼，AR 測試版自動同步；`web/index.html` 不會載入任何 AR 程式碼。

- 網址：`https://<帳號>.github.io/<repo>/ar.html`（加了 noindex，搜尋引擎不收錄）
- 「戴上看」左下角的 **AR 試戴** 會先做手機檢查：HTTPS、相機、WebGL2、App 內建瀏覽器，再載入手部模型、模擬約 2.5 秒的實際運算量，給出「建議使用／可以使用／不建議／無法使用」。結果在這支手機上記住 7 天，可按「重新測試」。
- 手鍊目前是第 2 階段：把目前的設計即時戴在手腕上，手腕會擋住後半圈；可拍照、開關骨架、微調大小（70%～140%）。
- 對齊方式：方向用畫面上的 2D 偵測點，骨頭真實長度來自 MediaPipe 3D 座標；針孔相機透視（視角假設 66°）。
- 前臂偵測（2.1）：從手掌取膚色，在手腕往前臂那側找相連的同色區域，用它的方向和粗細對齊手鍊；可信度不足時（背景和膚色太像、穿長袖）退回用手掌推算。開「骨架」可看到紫色的前臂方向與粗細、右上角的可信度。
- 限制：手臂前後傾斜仍從手掌推算（已限制最多 40°）。若前後顛倒，網址加 `#flipz` 比對。
- 手部偵測用 Google MediaPipe Hand Landmarker，全部在手機上運算，影像不會上傳。模型檔在部署時由 GitHub Actions 下載到 `web/models/`。

### 項鍊 AR（第 1 版）

- 在項鍊的「戴上看」按 **AR 試戴**，預設用前鏡頭自拍。手機檢查結果和手鍊分開記（模型不同，第一次約 15 MB）。
- 偵測：MediaPipe Pose Landmarker（lite）抓雙肩、眼睛、嘴巴、耳朵。
- 項鍊形狀直接用「戴上看」人模的下垂模擬結果，所以 **人模設定的性別、頸圍、領口會影響 AR**（例：設成襯衫，項鍊會架在立領上）。
- 對齊：人模的肩關節中點對到畫面上的雙肩中點；左右轉身、歪斜跟著肩膀；距離用肩寬推算（偵測值和男女平均各半）。
- ▲▼ 每次上下移 5 mm（±60 mm），＋－ 縮放 70%～140%。開「骨架」可看到偵測點、推算的下巴與臉部遮擋範圍（藍虛線）、人模脖子位置（紫）。
- 遮擋：後頸那段依人模身體擋掉；低頭時下巴會蓋住項鍊。頭髮蓋在項鍊上的情況還沒處理。
- 相機只能在 https 網址使用；Claude artifact 預覽沒有相機權限，請用部署後的網址在手機上測試。
- 從 AR 測試版送出的訂單，`orders.source` 會是 `ar-test`，方便辨認和刪除。

**AR 正式上線時**：在 `scripts/build.py` 讓 `index.html` 也載入 `ar.js` 即可，主程式不用改。

### 外掛介面 `window.BeadStudio`

主程式只對外開放這幾個東西，改主程式時保持它們不變，外掛就不會壞：

| 成員 | 用途 |
|---|---|
| `version` | 介面版本（目前 1），外掛會檢查 |
| `stage` | 工作區元素，外掛可以在裡面加按鈕 |
| `mode` | 目前檢視：`dish`／`board`／`wear` |
| `onModeChange(fn)` | 切換檢視時通知 |
| `setPaused(bool)` | 暫停／恢復畫面繪製與物理模擬 |
| `orderSource` | 寫進訂單的來源標記 |
| `design()` | 目前的設計：手圍、依串法順序的珠子（尺寸 mm、照片編號、露繩權重） |
| `beadImage(id, v)` | 珠子圖片（照片或繪製），回傳 canvas 與它涵蓋的實際寬度 mm |
| `necklace()` | 項鍊在人模上下垂後的形狀：每個節點的位置 mm、種類、珠子編號，人模身體的距離函數 `sdf`、肩關節位置；手鍊或空設計回傳 `null`（選用，舊外掛不需要） |

主程式載入完成時會發出 `beadstudio:ready` 事件。

## 修改網頁

改 `src/bead-studio.html` 或 `src/ar.js` 後執行：

```bash
python3 scripts/build.py
```

推到 GitHub 時 Actions 也會自動重新建置，所以忘了跑也會是最新的；本機跑一次是為了能直接打開 `web/index.html` 預覽。

## 安全與免費額度

- Notion token、Supabase service role key 只存在 Supabase secrets，**不會出現在網頁或 GitHub**。
- 資料表開啟 RLS 且沒有開放規則：只有 Edge Function 能讀寫。
- 訂單金額由伺服器依資料庫單價重新計算，`client_total` 只做對帳。
- Supabase 免費專案 7 天沒有活動會暫停；每日同步排程會順便保持活躍。
- Notion API 平均每秒 3 次請求，同步程式已自動控速。
- Notion 檔案網址一小時就會失效，所以照片一律複製到 Supabase Storage。

## 訂單去哪看

Supabase 後台 **Table Editor → orders**。`status` 欄可以手動改成 `confirmed`／`made`／`shipped`。
