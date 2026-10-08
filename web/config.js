// 部署設定：填入 Supabase Edge Function 的網址後，網頁會改從後端讀取珠子資料（Notion 同步）並可送出訂單。
// 例：apiBase: 'https://abcdefghijkl.supabase.co/functions/v1/api'
// 留 null 則使用網頁內建的範例資料。這裡不要放任何金鑰。
window.BEAD_CONFIG = {
  apiBase: null,
};
