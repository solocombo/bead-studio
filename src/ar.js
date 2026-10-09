/* 串珠盤 AR 試戴外掛（測試版：第 2 階段）
   只在 ar.html 載入；正式版 index.html 不會載入這個檔案。
   只透過 window.BeadStudio 介面和主程式溝通（見 src/bead-studio.html 最後面的 plugin interface）。

   1. 進入前先做「手機檢查」：環境檢查 + 載入偵測模型 + 模擬約 2.5 秒的實際運算量，給出建議
   2. 開相機、每格跑手部偵測，算出手腕的位置／方向／大小，把目前的設計戴上去
      第 2 階段：手腕遮擋後半圈、限制傾斜、依相機畫面調整亮度

   設定（可寫在 web/config.js 的 window.BEAD_CONFIG）：arLib / arWasm / arModel */
(() => {
'use strict';
const CFG = Object.assign({
  arLib:  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
  arWasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  arModel:['models/hand_landmarker.task',
           'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'],
}, window.BEAD_CONFIG||{});
const TAU=Math.PI*2;
const $=id=>document.getElementById(id);
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const CSS = `
.arbtn{position:absolute;left:10px;bottom:62px;z-index:3;display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid rgba(220,200,150,.5);background:rgba(6,18,17,.75);color:#f3e8cc;font-family:var(--f-display);font-weight:600;letter-spacing:.06em;font-size:13px}
.arbtn svg{width:16px;height:16px}
/* AR: device check dialog */
.dlg{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding-inline:16px;background:rgba(8,14,13,.6)}
.dlg-card{width:100%;max-width:360px;background:var(--surface);color:var(--fg);border-radius:10px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;max-height:90%;overflow-y:auto}
.dlg-card h2{margin:0;font-family:var(--f-display);font-weight:600;font-size:19px;letter-spacing:.04em}
.verdict{display:flex;align-items:center;gap:10px}
.verdict .badge{flex:none;font-size:13px;font-weight:600;padding:4px 10px;border-radius:999px;background:var(--line);color:var(--fg)}
.verdict[data-v="good"] .badge{background:#d9ecd2;color:#2c5a22}
.verdict[data-v="ok"] .badge{background:#f3e6c4;color:#6e5212}
.verdict[data-v="bad"] .badge,.verdict[data-v="no"] .badge{background:#f4d6d1;color:#8a2c20}
.verdict p{margin:0;font-size:14px;line-height:1.6}
.checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13px}
.checks li{display:grid;grid-template-columns:18px 1fr auto;gap:8px;align-items:baseline}
.checks .k{color:var(--muted)} .checks .v{font-family:var(--f-num);font-size:12px;text-align:right}
.checks .i{font-weight:700;text-align:center}
.checks [data-s="ok"] .i{color:#3d7a2f} .checks [data-s="warn"] .i{color:#a87b12} .checks [data-s="fail"] .i{color:var(--danger)} .checks [data-s="run"] .i{color:var(--muted)}
.meter{height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.dlg-btns{display:flex;gap:8px;flex-wrap:wrap}
.dlg-btns button{flex:1 1 120px;padding:11px 10px;border-radius:4px;font-size:14px;border:1px solid var(--line);background:transparent}
.dlg-btns button.primary{background:var(--accent);border-color:var(--accent);color:var(--surface);font-weight:600}
.dlg .link{border:0;background:none;color:var(--muted);font-size:12px;text-decoration:underline;padding:0;align-self:flex-start}

/* AR: camera view */
.arview{position:fixed;inset:0;z-index:70;background:#000;color:#fff;overflow:hidden}
.arview video,.arview canvas{position:absolute;inset:0;width:100%;height:100%}
.arview video{object-fit:cover}
.arview.mirror video,.arview.mirror canvas{transform:scaleX(-1)}
.ar-hud{position:absolute;top:0;left:0;right:0;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;display:flex;justify-content:space-between;gap:8px;font-family:var(--f-num);font-size:12px;background:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,0))}
.ar-hud b{font-weight:500;color:#cfe8b8}
.ar-guide{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(70vw,320px);aspect-ratio:3/4;border:2px dashed rgba(255,255,255,.55);border-radius:18px;display:grid;place-items:end center;padding-bottom:14px;box-sizing:border-box;font-size:14px;text-align:center;pointer-events:none}
.ar-bar{position:absolute;left:0;right:0;bottom:0;padding:12px 16px calc(14px + env(safe-area-inset-bottom,0px));display:flex;justify-content:space-between;align-items:center;gap:8px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.6))}
.ar-bar button{padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.45);color:#fff;font-size:14px}
.ar-msg{position:absolute;left:16px;right:16px;top:40%;text-align:center;font-size:15px;line-height:1.6;white-space:pre-line;text-shadow:0 1px 3px #000}
.ar-side{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:8px}
.ar-side button{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.45);color:#fff;font-size:13px;padding:0}
.ar-side button[aria-pressed="true"]{background:rgba(216,178,94,.85);color:#111;border-color:transparent}
.ar-side .lbl{font-family:var(--f-num);font-size:11px;text-align:center;text-shadow:0 1px 2px #000}
.ar-shutter{width:64px;height:64px;border-radius:50%;border:4px solid #fff;background:rgba(255,255,255,.25);padding:0}
.ar-shutter:active{background:rgba(255,255,255,.6)}
.ar-shot{position:absolute;inset:0;z-index:5;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(16px + env(safe-area-inset-bottom,0px));box-sizing:border-box}
.ar-shot img{max-width:100%;max-height:75%;border-radius:8px;object-fit:contain}
.ar-shot button{padding:10px 20px;border-radius:999px;border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;font-size:15px}
`;
const MARKUP = `
<div class="dlg" id="arDlg" hidden role="dialog" aria-modal="true" aria-labelledby="arDlgTitle">
  <div class="dlg-card">
    <h2 id="arDlgTitle">檢查這支手機</h2>
    <div class="verdict" id="arVerdict" data-v="run"><span class="badge" id="arBadge">測試中</span><p id="arSummary">正在檢查這支手機。</p></div>
    <div class="meter" aria-hidden="true"><i id="arMeter"></i></div>
    <ul class="checks" id="arChecks"></ul>
    <div class="dlg-btns" id="arBtns"></div>
    <button class="link" id="arRetest" hidden>重新測試</button>
  </div>
</div>

<div class="arview" id="arView" hidden>
  <video id="arVideo" playsinline muted autoplay></video>
  <canvas id="arGl"></canvas>
  <canvas id="arCanvas"></canvas>
  <div class="ar-hud"><span id="arHudL">準備相機…</span><span id="arHudR"></span></div>
  <div class="ar-guide" id="arGuide">把手腕放進框內</div>
  <div class="ar-msg" id="arMsg" hidden></div>
  <div class="ar-side">
    <button id="arSkel" aria-pressed="false" title="顯示手部偵測點">骨架</button>
    <button id="arBig" aria-label="手鍊放大">＋</button>
    <span class="lbl" id="arScaleLbl">100%</span>
    <button id="arSmall" aria-label="手鍊縮小">－</button>
  </div>
  <div class="ar-bar">
    <button id="arClose">結束試戴</button>
    <button class="ar-shutter" id="arSnap" aria-label="拍照"></button>
    <button id="arFlip">切換鏡頭</button>
  </div>
  <div class="ar-shot" id="arShot" hidden>
    <img id="arShotImg" alt="試戴照片">
    <span style="font-size:13px;opacity:.85">長按圖片即可儲存</span>
    <button id="arShotClose">繼續試戴</button>
  </div>
</div>
`;
const BUTTON = `
<button class="arbtn" id="arBtn" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>AR 試戴</button>
`;

function boot(BS){
if(!BS||BS.version!==1){ console.warn('AR: BeadStudio 介面版本不符，停用 AR'); return; }
BS.orderSource='ar-test';
const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
document.body.insertAdjacentHTML('beforeend',MARKUP);
BS.stage.insertAdjacentHTML('beforeend',BUTTON);
BS.onModeChange(m=>{ $('arBtn').hidden=m!=='wear'; });
const CONFIG=CFG;

const AR={ lib:null, lm:null, delegate:'', stream:null, facing:'environment', running:false, lastTs:0 };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const LS_KEY='bead-ar-check-v1';
function lsGet(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'null'); }catch{ return null; } }
function lsSet(v){ try{ localStorage.setItem(LS_KEY,JSON.stringify(v)); }catch{} }

function inAppBrowser(){
  const ua=navigator.userAgent||'';
  if(/\bLine\//i.test(ua)) return 'LINE';
  if(/Instagram/i.test(ua)) return 'Instagram';
  if(/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if(/MicroMessenger/i.test(ua)) return '微信';
  if(/Threads/i.test(ua)) return 'Threads';
  return '';
}
function webglInfo(){
  try{ const c=document.createElement('canvas'), g=c.getContext('webgl2');
    if(!g) return {ok:false};
    const ext=g.getExtension('WEBGL_debug_renderer_info');
    return {ok:true,gpu:ext?g.getParameter(ext.UNMASKED_RENDERER_WEBGL):''}; }catch{ return {ok:false}; }
}
/* 第一次使用要下載約 17 MB（運算核心 9.4 MB＋手部模型 7.5 MB），手機網路可能要十幾秒。
   所以兩個大檔自己下載，才能顯示進度；之後瀏覽器會快取，第二次幾乎不用等。
   onProgress({stage:'download'|'init', loaded, total, text}) */
/* 下載大檔並回報進度。
   - 先查瀏覽器的 Cache Storage：下載過一次就存起來，之後開 AR 幾乎不用等
   - 伺服器若有壓縮（gzip/br），content-length 是壓縮後大小，會比實際讀到的少，所以不採用 */
const CACHE_NAME='bead-ar-assets-v1';
async function fetchWithProgress(url,onBytes,stallMs=20000){
  let cache=null;
  try{ cache=await caches.open(CACHE_NAME); const hit=await cache.match(url);
    if(hit){ const b=new Uint8Array(await hit.arrayBuffer()); onBytes(b.length,b.length,true); return b; } }catch{ cache=null; }
  const ctrl=new AbortController(); let timer=setTimeout(()=>ctrl.abort(),stallMs);
  const r=await fetch(url,{signal:ctrl.signal});
  if(!r.ok){ clearTimeout(timer); throw new Error(`下載失敗（${r.status}）`); }
  const total=r.headers.get('content-encoding')?0:(+r.headers.get('content-length')||0);
  let out;
  if(!r.body||!r.body.getReader){ out=new Uint8Array(await r.arrayBuffer()); }
  else{
    const reader=r.body.getReader(), parts=[]; let got=0;
    for(;;){
      const {done,value}=await reader.read(); if(done) break;
      parts.push(value); got+=value.length; onBytes(got,Math.max(total,got));
      clearTimeout(timer); timer=setTimeout(()=>ctrl.abort(),stallMs);   // 超過 20 秒沒有任何進度才放棄
    }
    out=new Uint8Array(got); let o=0; for(const p of parts){ out.set(p,o); o+=p.length; }
  }
  clearTimeout(timer); onBytes(out.length,out.length);
  if(cache){ try{ await cache.put(url,new Response(out,{headers:{'Content-Type':r.headers.get('content-type')||'application/octet-stream'}})); }catch{} }
  return out;
}
const withTimeout=(promise,ms,msg)=>Promise.race([promise,new Promise((_,rej)=>setTimeout(()=>rej(new Error(msg)),ms))]);
const MB=n=>(n/1048576).toFixed(1);
async function loadLandmarker(onProgress){
  if(AR.lm) return AR.lm;
  const say=p=>onProgress&&onProgress(p);
  say({stage:'download',loaded:0,total:0,text:'連線中'});
  if(!AR.lib) AR.lib=await withTimeout(import(CONFIG.arLib),30000,'AR 元件下載逾時');
  const {FilesetResolver,HandLandmarker}=AR.lib;
  const files=await FilesetResolver.forVisionTasks(CONFIG.arWasm);
  // 兩個大檔同時下載，合併計算進度（模型大小在下載前未知時先用 7.5 MB 估）
  // 大小未知（伺服器有壓縮）時用預估值；實際讀到的超過預估就跟著調大
  const prog={wasm:[0,9.4e6],model:[0,7.8e6]}, fromCache={};
  const tick=()=>{ const l=prog.wasm[0]+prog.model[0], t=Math.max(prog.wasm[0],prog.wasm[1])+Math.max(prog.model[0],prog.model[1]);
    say({stage:'download',loaded:l,total:t,text:fromCache.wasm&&fromCache.model?'讀取快取':`下載中 ${MB(l)} / ${MB(t)} MB`}); };
  const wasmJob=(async()=>{
    if(!files.wasmBinaryPath||AR.wasmUrl) return;
    const bytes=await fetchWithProgress(files.wasmBinaryPath,(g,t,c)=>{ if(c) fromCache.wasm=1; prog.wasm=[g,t||prog.wasm[1]]; tick(); });
    AR.wasmUrl=URL.createObjectURL(new Blob([bytes],{type:'application/wasm'}));
  })();
  const modelJob=(async()=>{
    if(AR.modelBuf) return;
    let lastErr;
    for(const url of [].concat(CONFIG.arModel)){
      try{ AR.modelBuf=await fetchWithProgress(url,(g,t,c)=>{ if(c) fromCache.model=1; prog.model=[g,t||prog.model[1]]; tick(); }); return; }
      catch(e){ lastErr=e; prog.model[0]=0; }
    }
    throw lastErr||new Error('找不到手部模型');
  })();
  await Promise.all([wasmJob,modelJob]);
  if(AR.wasmUrl) files.wasmBinaryPath=AR.wasmUrl;
  let lastErr;
  for(const delegate of ['GPU','CPU']){
    try{
      say({stage:'init',text:delegate==='GPU'?'啟動中（GPU）':'GPU 無法使用，改用 CPU'});
      AR.lm=await withTimeout(HandLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetBuffer:AR.modelBuf,delegate},runningMode:'VIDEO',numHands:1,
        minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5}),25000,`${delegate} 啟動逾時`);
      AR.delegate=delegate; return AR.lm;
    }catch(e){ lastErr=e; console.warn('AR init',delegate,e); }
  }
  throw lastErr||new Error('model');
}
const nextTs=()=>{ const t=Math.max(performance.now(),AR.lastTs+1); AR.lastTs=t; return t; };

/* 模擬運算：用一張會動的 640×480 假畫面跑手部偵測，同時用 3D 畫一圈 24 顆珠子，量每格要花多少時間。
   畫面裡沒有手時偵測器每格都會跑「找手掌」；真的有手時改成每格跑「關鍵點」，兩者運算量相近，
   所以偵測時間再乘 1.3 當作保守估計。 */
async function simulateLoad(onProgress){
  const W=640,H=480, fake=document.createElement('canvas'); fake.width=W; fake.height=H; const fx=fake.getContext('2d');
  const oc=document.createElement('canvas'); oc.width=oc.height=360;
  const T3=THREE, r=new T3.WebGLRenderer({canvas:oc,antialias:true,alpha:true}); r.setPixelRatio(1);
  const sc=new T3.Scene(), cam=new T3.PerspectiveCamera(30,1,1,2000); cam.position.set(0,60,260); cam.lookAt(0,0,0);
  sc.add(new T3.HemisphereLight(0xffffff,0x334444,.8)); const dl=new T3.DirectionalLight(0xffffff,.7); dl.position.set(-1,2,3); sc.add(dl);
  const ringG=new T3.Group(), geo=new T3.SphereGeometry(4,24,16), mat=new T3.MeshStandardMaterial({color:0x9a6cc0,roughness:.2});
  for(let i=0;i<24;i++){ const m=new T3.Mesh(geo,mat), a=i/24*TAU; m.position.set(Math.cos(a)*40,0,Math.sin(a)*26); ringG.add(m); }
  const occ=new T3.Mesh(new T3.CylinderGeometry(30,30,60,32),new T3.MeshBasicMaterial({colorWrite:false})); sc.add(occ); sc.add(ringG);
  const det=[], ren=[], tot=[], WARM=8, N=45, t0=performance.now();
  for(let i=0;i<WARM+N;i++){
    const k=i/10;
    const g=fx.createLinearGradient(0,0,W,H); g.addColorStop(0,`hsl(${(i*7)%360},35%,55%)`); g.addColorStop(1,'#222'); fx.fillStyle=g; fx.fillRect(0,0,W,H);
    fx.fillStyle='#d9a98a'; fx.beginPath(); fx.ellipse(W/2+Math.sin(k)*60,H/2,90,140,Math.sin(k*.7)*.4,0,TAU); fx.fill();
    const a=performance.now(); AR.lm.detectForVideo(fake,nextTs()); const b=performance.now();
    ringG.rotation.y=k; r.render(sc,cam); r.getContext().finish(); const c=performance.now();
    if(i>=WARM){ det.push(b-a); ren.push(c-b); tot.push((b-a)*1.3+(c-b)); }
    onProgress&&onProgress((i+1)/(WARM+N));
    await new Promise(requestAnimationFrame);
    if(performance.now()-t0>6000) break;
  }
  r.dispose(); geo.dispose(); mat.dispose();
  const med=a=>{ const x=[...a].sort((p,q)=>p-q); return x.length?x[Math.floor(x.length/2)]:Infinity; };
  const p90=a=>{ const x=[...a].sort((p,q)=>p-q); return x.length?x[Math.floor(x.length*.9)]:Infinity; };
  // 相機畫面本身和瀏覽器排版也要時間，再加 4ms
  const frameMs=med(tot)+4, worstMs=p90(tot)+4;
  return {detMs:med(det),renMs:med(ren),frameMs,worstMs,fps:Math.min(60,1000/frameMs)};
}

const ICON={ok:'✓',warn:'!',fail:'✕',run:'…'};
function renderChecks(list){
  $('arChecks').innerHTML=list.map(c=>`<li data-s="${c.s}"><span class="i">${ICON[c.s]}</span><span class="k">${esc(c.k)}</span><span class="v">${esc(c.v||'')}</span></li>`).join('');
}
function setVerdict(v,badge,text){ $('arVerdict').dataset.v=v; $('arBadge').textContent=badge; $('arSummary').textContent=text; }
function setButtons(btns){
  const box=$('arBtns'); box.innerHTML='';
  btns.forEach(([label,fn,primary])=>{ const b=document.createElement('button'); b.textContent=label; if(primary) b.className='primary'; b.onclick=fn; box.appendChild(b); });
  const p=box.querySelector('.primary')||box.querySelector('button'); p&&p.focus();
}
const closeDlg=()=>{ $('arDlg').hidden=true; $('arBtn').focus(); };

async function runCheck(){
  const checks=[]; const push=(k,s,v)=>{ checks.push({k,s,v}); renderChecks(checks); };
  $('arRetest').hidden=true; setButtons([['取消',closeDlg]]); $('arMeter').style.width='0%';
  setVerdict('run','測試中','正在檢查這支手機。');
  // 1. 環境
  const iab=inAppBrowser(), secure=window.isSecureContext, cam=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia), gl=webglInfo();
  push('安全連線（HTTPS）',secure?'ok':'fail',secure?'':'需要 https 網址');
  push('相機功能',cam?'ok':'fail',cam?'':'瀏覽器不支援');
  push('3D 繪圖（WebGL2）',gl.ok?'ok':'fail',gl.ok?'':'不支援');
  if(iab) push(`${iab} 內建瀏覽器`,'warn','可能無法開相機');
  const net=navigator.connection;
  if(net&&!AR.lm&&(net.saveData||/2g|3g/.test(net.effectiveType||''))) push('網路',net.saveData?'warn':'warn',net.saveData?'省數據模式':'網路較慢，下載會久一點');
  const mem=navigator.deviceMemory, cores=navigator.hardwareConcurrency;
  if(mem||cores) push('裝置規格',mem&&mem<=2?'warn':'ok',[cores?`${cores} 核心`:'',mem?`${mem} GB`:''].filter(Boolean).join('・'));
  const blocked=!secure||!cam||!gl.ok;
  // 2. 模型
  let res=null, loadErr=null;
  if(!blocked){
    const idx=checks.length; push('載入手部偵測模型','run','');
    const t0=performance.now(), cached=!!AR.lm;
    if(!cached) $('arSummary').textContent='第一次使用要下載約 17 MB 的 AR 元件，用行動網路可能要十幾秒。之後再開會快很多。';
    const clock=setInterval(()=>{ $('arBadge').textContent=`測試中 ${Math.round((performance.now()-t0)/1000)} 秒`; },500);
    try{
      await loadLandmarker(p=>{
        checks[idx].v=p.text; renderChecks(checks);
        $('arMeter').style.width=(p.stage==='download'?(p.total?60*p.loaded/p.total:2):65).toFixed(1)+'%';
      });
      checks[idx]={k:'載入手部偵測模型',s:'ok',v:`${((performance.now()-t0)/1000).toFixed(1)} 秒・${AR.delegate==='GPU'?'GPU':'CPU（較慢）'}`};
    }
    catch(e){ loadErr=e; checks[idx]={k:'載入手部偵測模型',s:'fail',v:/逾時|abort/i.test(String(e&&(e.message||e.name)))?'網路太慢或逾時':'載入失敗'}; console.warn('AR load',e); }
    finally{ clearInterval(clock); $('arBadge').textContent='測試中'; }
    renderChecks(checks);
  }
  // 3. 模擬運算
  if(!blocked&&!loadErr){
    const idx=checks.length; push('模擬試戴運算','run','');
    $('arSummary').textContent='正在模擬試戴的運算量，約 2～3 秒。';
    try{ res=await simulateLoad(f=>{ $('arMeter').style.width=(70+f*30).toFixed(1)+'%'; });
      checks[idx]={k:'模擬試戴運算',s:res.fps>=24?'ok':res.fps>=14?'warn':'fail',v:`約 ${Math.round(res.fps)} 格/秒`}; }
    catch(e){ loadErr=e; checks[idx]={k:'模擬試戴運算',s:'fail',v:'執行失敗'}; console.warn('AR bench',e); }
    renderChecks(checks);
  }
  $('arMeter').style.width='100%';
  // 4. 結論
  let v;
  if(blocked) v=['no','無法使用', !secure?'這個網址不是 https，瀏覽器不允許開相機。':!cam?'這個瀏覽器沒有相機功能。':'這支手機的瀏覽器不支援 3D 繪圖。'];
  else if(loadErr) v=['no','無法使用','AR 元件載入失敗，可能是網路不穩，或目前的環境擋住了下載（例如預覽模式）。可以稍後再試。'];
  else{
    let lv=res.fps>=24?2:res.fps>=14?1:0;
    if(mem&&mem<=2&&lv>0) lv--;               // 記憶體很小的手機，長時間使用容易發燙、被系統降速
    if(AR.delegate==='CPU'&&lv>1) lv=1;
    v=[['bad','不建議','這支手機跑起來會明顯卡頓，試戴效果不好。建議改用「戴上看」的 3D 預覽。'],
       ['ok','可以使用','跑得動，但畫面可能偶爾卡一下。使用幾分鐘後手機會變熱，是正常現象。'],
       ['good','建議使用','這支手機的效能足夠，試戴畫面會很流暢。']][lv];
  }
  if(iab&&v[0]!=='no') v[2]+=`\n你正在用 ${iab} 的內建瀏覽器，如果打不開相機，請點右上角選單，選「用瀏覽器開啟」。`;
  setVerdict(...v);
  $('arSummary').style.whiteSpace='pre-line';
  const back=['使用 3D 戴上看',closeDlg];
  if(v[0]==='good'||v[0]==='ok') setButtons([['先不要',closeDlg],['開始試戴',startAR,true]]);
  else if(v[0]==='bad') setButtons([['仍要試試',startAR],[back[0],back[1],true]]);
  else setButtons([[back[0],back[1],true]]);
  $('arRetest').hidden=false;
  if(res) lsSet({at:Date.now(),ua:navigator.userAgent,v,checks,fps:res.fps});
}
function openCheck(){
  $('arDlg').hidden=false;
  const prev=lsGet();
  if(prev&&prev.ua===navigator.userAgent&&Date.now()-prev.at<7*864e5){
    renderChecks(prev.checks); setVerdict(...prev.v); $('arSummary').style.whiteSpace='pre-line'; $('arMeter').style.width='100%';
    const back=['使用 3D 戴上看',closeDlg];
    if(prev.v[0]==='good'||prev.v[0]==='ok') setButtons([['先不要',closeDlg],['開始試戴',startAR,true]]);
    else setButtons([['仍要試試',startAR],[back[0],back[1],true]]);
    $('arRetest').hidden=false; $('arDlgTitle').textContent='這支手機的檢查結果';
  } else { $('arDlgTitle').textContent='檢查這支手機'; runCheck(); }
}
$('arBtn').onclick=openCheck;
$('arRetest').onclick=()=>{ $('arDlgTitle').textContent='檢查這支手機'; runCheck(); };
$('arDlg').addEventListener('click',e=>{ if(e.target===$('arDlg')) closeDlg(); });
addEventListener('keydown',e=>{ if(e.key==='Escape'&&!$('arDlg').hidden) closeDlg(); });

/* ---------- 相機 + 手部關鍵點 ---------- */
const HAND_LINKS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const arVideo=$('arVideo'), arCv=$('arCanvas'), arCtx=arCv.getContext('2d'), arGl=$('arGl');
function arMsg(t){ $('arMsg').hidden=!t; $('arMsg').textContent=t||''; }

/* ---------- 防抖：One Euro Filter（慢慢動時強力平滑，快速移動時減少延遲） ---------- */
class OneEuro{
  constructor(minCutoff=1.2,beta=.02,dCutoff=1){ Object.assign(this,{minCutoff,beta,dCutoff,x:null,dx:0,t:0}); }
  static a(cut,dt){ const r=2*Math.PI*cut*dt; return r/(r+1); }
  filter(v,t){
    if(this.x===null){ this.x=v; this.t=t; return v; }
    const dt=Math.max(1e-3,(t-this.t)/1000); this.t=t;
    const dv=(v-this.x)/dt; this.dx+=OneEuro.a(this.dCutoff,dt)*(dv-this.dx);
    const cut=this.minCutoff+this.beta*Math.abs(this.dx);
    this.x+=OneEuro.a(cut,dt)*(v-this.x); return this.x;
  }
  reset(){ this.x=null; this.dx=0; }
}
const filters={}; const F=(k,v,t,mc,b)=>(filters[k]||(filters[k]=new OneEuro(mc,b))).filter(v,t);
const resetFilters=()=>Object.values(filters).forEach(f=>f.reset());

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add=(a,b,k=1)=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{ const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; };
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const W3=lm=>[lm.x,lm.y,lm.z];

/* 手腕姿態（第 1.1 版）
   MediaPipe 的 worldLandmarks（公尺）只拿來提供「骨頭的真實長度」和「前後方向」；
   畫面上的方向一律用 2D 偵測點，比較準。相機用針孔模型（真實透視）。

   - 比例：手掌上幾段固定長度（手腕、各指根）在畫面上的長度 ÷ 真實長度。
           骨頭斜向鏡頭時畫面上會變短，所以取「最不被壓縮」的那段（第二大值，避免單一雜訊）
   - 深度：知道比例和鏡頭焦距，就能推出手腕離鏡頭多遠
   - 手臂方向 a：中指根 → 手腕。畫面上看到的長度比真實長度短多少，就代表往前或往後傾斜多少
   - 掌寬方向 u：小指根 → 食指根，同樣用縮短量判斷手是正面還是側面
   座標：相機座標（公尺），x 右、y 下、z 朝前（離鏡頭越遠越大）。 */
const HFOV=66*Math.PI/180;      // 手機主鏡頭長邊的水平視角，常見 63°～70°
const TILT=.45;                 // 手腕彎曲時手掌方向和前臂不同，傾斜量打折，避免手鍊歪太多（實測 .75 太多）
const MAX_TILT=40*Math.PI/180;  // 手臂前後傾斜最多算到 40°
// MediaPipe world z：預設數值越大離鏡頭越遠。若實測手鍊前後顛倒，網址加 #flipz 即可反轉來比對
const Z_SIGN=/flipz/.test(location.hash)?-1:1;
const PALM=[0,5,9,13,17];
function wristPose(img,world,cam){
  const P=PALM.map(i=>cam.toPx(img[i])), Wd=PALM.map(i=>W3(world[i]));
  const ratios=[];
  for(let i=0;i<5;i++) for(let j=i+1;j<5;j++){
    const lw=len(sub(Wd[i],Wd[j])); if(lw<.01) continue;
    ratios.push(Math.hypot(P[i][0]-P[j][0],P[i][1]-P[j][1])/lw);
  }
  ratios.sort((x,y)=>y-x);
  const k=ratios[1]||ratios[0];                         // px per meter at the hand's depth
  const Z=cam.f/k;
  const at=(px)=>[(px[0]-cam.ppx)*Z/cam.f,(px[1]-cam.ppy)*Z/cam.f,Z];
  // 3D vector from two landmarks: in-plane part from the image, depth part from the true length
  const vec3=(i,j)=>{
    const pi=cam.toPx(img[i]), pj=cam.toPx(img[j]), dx=(pi[0]-pj[0])/k, dy=(pi[1]-pj[1])/k;
    const L=len(sub(W3(world[i]),W3(world[j]))), dz=Math.sqrt(Math.max(0,L*L-dx*dx-dy*dy));
    return [dx,dy,dz*Math.sign((world[i].z-world[j].z)*Z_SIGN||1)];
  };
  let h=vec3(0,9); const hxy=Math.hypot(h[0],h[1]);
  h=[h[0],h[1],Math.sign(h[2])*Math.min(Math.abs(h[2])*TILT,hxy*Math.tan(MAX_TILT))];
  const a=norm(h);
  let u=vec3(5,17); u=norm(add(u,a,-dot(u,a)));
  const v=cross(a,u);
  const c=add(at(cam.toPx(img[0])),a,.010);            // 10 mm toward the elbow
  return {c,a,u,v};
}
function smoothPose(p,t){
  const c=[0,1,2].map(i=>F('c'+i,p.c[i],t,i===2?.6:1.5,i===2?.05:.4));
  const a=norm([0,1,2].map(i=>F('a'+i,p.a[i],t,1.2,.4)));
  let u=norm([0,1,2].map(i=>F('u'+i,p.u[i],t,1.2,.4)));
  u=norm(add(u,a,-dot(u,a)));
  return {c,a,u,v:cross(a,u)};
}

/* ---------- 3D 手鍊（正交投影，單位＝螢幕像素） ---------- */
const G={ready:false};
function initGl(){
  if(G.ready) return; const T=THREE;
  G.r=new T.WebGLRenderer({canvas:arGl,alpha:true,antialias:true,preserveDrawingBuffer:true});
  G.r.setClearColor(0,0); G.scene=new T.Scene(); G.cam=new T.OrthographicCamera(0,1,0,-1,-1e5,1e5); G.cam.position.z=0;
  G.group=new T.Group(); G.scene.add(G.group); G.tex=new Map(); G.items=[]; G.key=''; G.ready=true;
  // 手腕遮擋：看不見、只寫入深度的多邊形（手腕圓柱在畫面上的輪廓），放在手腕中心的深度。
  // 比它遠的珠子（後半圈）落在手臂輪廓內就被擋住；露出手臂邊緣外的部分照樣看得到。
  G.occN=64; const og=new T.BufferGeometry();
  og.setAttribute('position',new T.BufferAttribute(new Float32Array((G.occN+2)*3),3));
  const idx=[]; for(let i=1;i<=G.occN;i++) idx.push(0,i,i+1); og.setIndex(idx);
  G.occ=new T.Mesh(og,new T.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:T.DoubleSide}));
  G.occ.renderOrder=-1; G.occ.frustumCulled=false; G.scene.add(G.occ);
  G.light=new T.Color(1,1,1);
}
function texFor(id,v){
  const key=id+'#'+v; let t=G.tex.get(key); if(t) return t;
  const im=BS.beadImage(id,v); if(!im) return null;
  const tex=new THREE.CanvasTexture(im.canvas); tex.encoding=THREE.sRGBEncoding;
  t={tex,mm:im.mm}; G.tex.set(key,t); return t;
}
const per=(A,B)=>Math.PI*(3*(A+B)-Math.sqrt((3*A+B)*(A+3*B)));
/* 跟「戴上看」相同的排法：珠子沿著貼合手腕的橢圓排，比手腕短就把露繩分散在珠子之間。回傳每顆珠子在手腕座標（mm）的位置。 */
function layoutBracelet(des){
  const beads=des.beads; if(!beads.length) return null;
  const a=des.wristMM/5.243, b=a*.65, dm=Math.max(...beads.map(x=>x.d));
  const A0=a+dm*.3, B0=b+dm*.3, q=B0/A0, W=beads.reduce((s,x)=>s+x.w,0);
  const A=Math.max(W/per(1,q),A0), B=A*q, Lc=per(A,B), exposed=Math.max(0,Lc-W);
  const sum=beads.reduce((s,x)=>s+x.gw,0), gap=x=>exposed<=0?0:sum>0?exposed*x.gw/sum:exposed/beads.length;
  const N=720, cum=[0], P=[];
  for(let i=0;i<=N;i++){ const t=i/N*TAU; P.push([A*Math.sin(t),B*Math.cos(t)]); if(i) cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1])); }
  const at=s=>{ s=((s%Lc)+Lc)%Lc*cum[N]/Lc; let lo=0,hi=N; while(hi-lo>1){ const m=(lo+hi)>>1; if(cum[m]<=s) lo=m; else hi=m; }
    const f=(s-cum[lo])/((cum[hi]-cum[lo])||1); return [P[lo][0]+(P[hi][0]-P[lo][0])*f,P[lo][1]+(P[hi][1]-P[lo][1])*f]; };
  let c=-beads[0].w/2;
  const out=beads.map(x=>{ const mid=c+x.w/2; c+=x.w+gap(x); const p=at(mid), p2=at(mid+.5); return {...x,pu:p[0],pv:p[1],tu:p2[0]-p[0],tv:p2[1]-p[1]}; });
  const cord=[]; for(let i=0;i<=120;i++) cord.push(at(i/120*Lc));
  return {beads:out,cord,exposed};
}
function buildBracelet(){
  const des=BS.design(), key=des.wristMM+'|'+des.beads.map(b=>b.id+':'+b.v+':'+b.gw.toFixed(3)).join(',');
  if(key===G.key) return; G.key=key;
  G.group.clear(); G.items=[]; G.layout=layoutBracelet(des);
  if(!G.layout) return;
  for(const b of G.layout.beads){
    const t=texFor(b.id,b.v); if(!t) continue;
    const m=new THREE.SpriteMaterial({map:t.tex,transparent:true,depthWrite:false});
    const s=new THREE.Sprite(m); s.userData={b,mm:t.mm}; G.group.add(s); G.items.push(s);
  }
  const g=new THREE.BufferGeometry().setFromPoints(G.layout.cord.map(()=>new THREE.Vector3()));
  G.cord=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xd8cfbd,transparent:true,opacity:.8})); G.group.add(G.cord);
}
/* 把手鍊放到手腕上：手腕座標 (u,v) mm → 相機座標（公尺）→ 透視投影到螢幕像素。
   還沒做遮擋：朝向手腕背面（遠離鏡頭那側）的珠子先畫成半透明。 */
function hull(pts){                                   // 2D convex hull (monotone chain)
  pts=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]), lo=[], up=[];
  for(const p of pts){ while(lo.length>1&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0) lo.pop(); lo.push(p); }
  for(const p of pts.reverse()){ while(up.length>1&&cr(up[up.length-2],up[up.length-1],p)<=0) up.pop(); up.push(p); }
  return lo.slice(0,-1).concat(up.slice(0,-1));
}
function placeBracelet(pose,cam,cw,ch,scaleAdj,wristMM){
  G.cam.left=0; G.cam.right=cw; G.cam.top=0; G.cam.bottom=-ch; G.cam.updateProjectionMatrix();
  const toCam=(pu,pv,pa=0)=>{ const r=add(add([0,0,0],pose.u,pu*scaleAdj/1000),pose.v,pv*scaleAdj/1000); return [add(add(pose.c,r),pose.a,pa*scaleAdj/1000),r]; };
  const proj=P=>[cam.ppx+cam.f*P[0]/P[2], cam.ppy+cam.f*P[1]/P[2]];
  const L=G.light, dim=new THREE.Color(L.r*.72,L.g*.72,L.b*.72);
  for(const s of G.items){
    const {b,mm}=s.userData, [P,r]=toCam(b.pu,b.pv), q=proj(P);
    const behind=dot(r,P)>0;                                       // surface normal points away from the camera
    const size=mm*scaleAdj/1000*cam.f/P[2];
    s.position.set(q[0],-q[1],-P[2]*1000); s.scale.set(size,size,1);
    s.material.opacity=1; s.material.color.copy(behind?dim:L);     // 後半圈稍暗，露出手臂邊緣時有前後感
    if(b.kind==='spacer'){ const q2=proj(toCam(b.pu+b.tu,b.pv+b.tv)[0]); s.material.rotation=Math.atan2(-(q2[1]-q[1]),q2[0]-q[0]); }
  }
  const pos=G.cord.geometry.attributes.position;
  G.layout.cord.forEach(([pu,pv],i)=>{ const [P]=toCam(pu,pv), q=proj(P); pos.setXYZ(i,q[0],-q[1],-P[2]*1000-1); });
  pos.needsUpdate=true;
  // 手腕輪廓：手腕截面（略小於實際皮膚，避免擋到貼在邊緣的珠子）沿手臂方向從前臂 60 mm 到手掌側 20 mm
  const A=wristMM/5.243*.95, B=A*.65, pts=[];
  for(const pa of [-20,-5,15,35,60]) for(let i=0;i<24;i++){ const t=i/24*TAU; pts.push(proj(toCam(A*Math.cos(t),B*Math.sin(t),pa)[0])); }
  const hl=hull(pts); G.occHull=hl;
  const op=G.occ.geometry.attributes.position, zc=-pose.c[2]*1000;
  let mx=0,my=0; hl.forEach(p=>{ mx+=p[0]/hl.length; my+=p[1]/hl.length; });
  op.setXYZ(0,mx,-my,zc);
  for(let i=0;i<=G.occN;i++){ const p=hl[Math.min(hl.length-1,Math.floor(i/G.occN*hl.length))%hl.length]||[mx,my]; op.setXYZ(i+1,p[0],-p[1],zc); }
  const last=hl[0]; op.setXYZ(G.occN+1,last[0],-last[1],zc);
  op.needsUpdate=true;
}
/* 亮度：每半秒取相機畫面的平均亮度和色偏，乘到珠子上，暗的房間珠子不會亮得突兀 */
const lumCv=document.createElement('canvas'); lumCv.width=lumCv.height=16; const lumCtx=lumCv.getContext('2d',{willReadFrequently:true});
function sampleLight(now){
  if(AR.lastLum&&now-AR.lastLum<500) return; AR.lastLum=now;
  try{
    lumCtx.drawImage(arVideo,0,0,16,16); const d=lumCtx.getImageData(0,0,16,16).data;
    let r=0,g=0,b=0; for(let i=0;i<d.length;i+=4){ r+=d[i]; g+=d[i+1]; b+=d[i+2]; } const n=d.length/4; r/=n; g/=n; b/=n;
    const y=(.299*r+.587*g+.114*b)/255, m=Math.max(r,g,b,1);
    const k=Math.max(.55,Math.min(1.08,.5+y*.9));                  // 亮度 0.5 左右（一般室內）→ 約 0.95
    const tint=c=>.8+.2*c/m;                                       // 帶一點環境色偏
    const T=[k*tint(r),k*tint(g),k*tint(b)];
    G.light.setRGB(G.light.r*.6+T[0]*.4,G.light.g*.6+T[1]*.4,G.light.b*.6+T[2]*.4);   // 慢慢變，不閃
  }catch{}
}

async function openCamera(){
  if(AR.stream) AR.stream.getTracks().forEach(t=>t.stop());
  AR.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:AR.facing},width:{ideal:1280},height:{ideal:720}}});
  arVideo.srcObject=AR.stream; await arVideo.play();
  const set=AR.stream.getVideoTracks()[0].getSettings();
  const front=set.facingMode?set.facingMode==='user':AR.facing==='user';
  $('arView').classList.toggle('mirror',front); resetFilters();
}
async function startAR(){
  $('arDlg').hidden=true; $('arView').hidden=false; $('arShot').hidden=true; BS.setPaused(true); arMsg('');
  $('arHudL').textContent='開啟相機…'; $('arHudR').textContent='';
  const token=AR.session=(AR.session||0)+1;
  // 先開相機，讓使用者馬上看到畫面；AR 元件同時在背景載入
  const cam=openCamera().then(()=>null,e=>e);
  const loading=!AR.lm;
  if(loading){ $('arGuide').hidden=true; arMsg('載入 AR 元件中…'); }
  let err=null;
  try{
    await loadLandmarker(p=>{
      if(token!==AR.session) return;
      const pct=p.stage==='download'&&p.total?Math.min(99,Math.round(100*p.loaded/p.total)):p.stage==='init'?99:0;
      $('arHudL').textContent=p.text==='連線中'?'準備 AR 元件…':p.text;
      if(loading) arMsg(p.stage==='init'?'即將完成…':`載入 AR 元件 ${pct}%\n第一次使用要下載約 17 MB，之後就不用再等`);
    });
    initGl(); buildBracelet();
  }catch(e){ err=e; }
  const camErr=await cam;
  if(token!==AR.session||$('arView').hidden){            // 使用者已經關掉了：相機若剛打開也要關
    if($('arView').hidden&&AR.stream){ AR.stream.getTracks().forEach(t=>t.stop()); AR.stream=null; }
    return;
  }
  const e=camErr||err;
  if(e){
    console.warn('AR start',e);
    const n=e&&e.name;
    arMsg(n==='NotAllowedError'?'沒有相機權限。請到瀏覽器設定允許這個網站使用相機，再重新開啟試戴。':
          n==='NotFoundError'?'找不到可用的相機。':
          n==='NotReadableError'?'相機被其他 App 佔用中，請關閉其他使用相機的 App 再試一次。':
          !camErr?'AR 元件載入失敗：'+(e&&e.message||e)+'\n請確認網路後重新開啟試戴。':
          '無法開啟相機：'+(e&&e.message||e));
    return;
  }
  arMsg(''); $('arGuide').hidden=false;
  if(!G.layout) arMsg('盤中還沒有珠子。先回去設計一條，再來試戴。');
  AR.running=true; AR.fps=[]; AR.lastSeen=0; requestAnimationFrame(arLoop);
}
function stopAR(){
  AR.running=false; AR.session=(AR.session||0)+1;
  if(AR.stream){ AR.stream.getTracks().forEach(t=>t.stop()); AR.stream=null; }
  arVideo.srcObject=null; $('arView').hidden=true; BS.setPaused(false); $('arBtn').focus();
}
AR.skel=false; AR.scale=1;
function arLoop(now){
  if(!AR.running) return;
  const vw=arVideo.videoWidth, vh=arVideo.videoHeight;
  if(vw&&arVideo.readyState>=2){
    const cw=arCv.clientWidth, ch=arCv.clientHeight, d=Math.min(devicePixelRatio||1,2);
    if(arCv.width!==Math.round(cw*d)||arCv.height!==Math.round(ch*d)){ arCv.width=Math.round(cw*d); arCv.height=Math.round(ch*d); G.r.setPixelRatio(d); G.r.setSize(cw,ch,false); }
    const t0=performance.now(), res=AR.lm.detectForVideo(arVideo,nextTs()), dt=performance.now()-t0;
    // video is drawn with object-fit: cover → map normalized landmarks the same way (CSS px)
    const sc=Math.max(cw/vw,ch/vh), ox=(cw-vw*sc)/2, oy=(ch-vh*sc)/2;
    const toPx=l=>[ox+l.x*vw*sc, oy+l.y*vh*sc];
    // pinhole camera in CSS px: principal point = video centre, focal length from a typical phone FOV
    const cam={toPx, ppx:ox+vw*sc/2, ppy:oy+vh*sc/2, f:Math.max(vw,vh)*sc/(2*Math.tan(HFOV/2))};
    arCtx.clearRect(0,0,arCv.width,arCv.height);
    const hand=res.landmarks&&res.landmarks[0], world=res.worldLandmarks&&res.worldLandmarks[0];
    $('arGuide').hidden=!!hand;
    if(hand&&world){
      AR.lastSeen=now;
      if(G.layout){ sampleLight(now); AR.pose=smoothPose(wristPose(hand,world,cam),now); placeBracelet(AR.pose,cam,cw,ch,AR.scale,BS.design().wristMM); G.group.visible=G.occ.visible=true; }
      if(AR.skel){
        arCtx.lineWidth=3*d; arCtx.strokeStyle='rgba(216,178,94,.9)'; arCtx.beginPath();
        for(const [a,b] of HAND_LINKS){ const p=toPx(hand[a]), q=toPx(hand[b]); arCtx.moveTo(p[0]*d,p[1]*d); arCtx.lineTo(q[0]*d,q[1]*d); }
        arCtx.stroke();
        hand.forEach((l,i)=>{ const [x,y]=toPx(l); arCtx.fillStyle=i===0?'#ff6b5a':'#fff'; arCtx.beginPath(); arCtx.arc(x*d,y*d,(i===0?7:4)*d,0,TAU); arCtx.fill(); });
        if(G.occHull){ arCtx.strokeStyle='rgba(120,200,255,.8)'; arCtx.lineWidth=1.5*d; arCtx.setLineDash([6*d,4*d]); arCtx.beginPath();   // 遮擋範圍（手腕輪廓）
          G.occHull.forEach((p,i)=>i?arCtx.lineTo(p[0]*d,p[1]*d):arCtx.moveTo(p[0]*d,p[1]*d)); arCtx.closePath(); arCtx.stroke(); arCtx.setLineDash([]); }
      }
      $('arHudR').textContent='';
    } else {
      $('arHudR').textContent='尋找手部…';
      if(now-AR.lastSeen>350){ G.group.visible=G.occ.visible=false; resetFilters(); }   // 短暫跟丟時先保留，避免閃爍
    }
    G.r.render(G.scene,G.cam);
    AR.fps.push(now); while(AR.fps.length&&now-AR.fps[0]>1000) AR.fps.shift();
    $('arHudL').innerHTML=`<b>${AR.fps.length}</b> 格/秒・偵測 ${dt.toFixed(0)} ms・${AR.delegate}`;
  }
  requestAnimationFrame(arLoop);
}
function setScale(x){ AR.scale=Math.max(.7,Math.min(1.4,Math.round(x*20)/20)); $('arScaleLbl').textContent=Math.round(AR.scale*100)+'%'; }
$('arBig').onclick=()=>setScale(AR.scale+.05);
$('arSmall').onclick=()=>setScale(AR.scale-.05);
$('arSkel').onclick=()=>{ AR.skel=!AR.skel; $('arSkel').setAttribute('aria-pressed',AR.skel); };
/* 拍照：相機畫面＋手鍊（＋骨架）合成一張，跟螢幕上看到的一樣（前鏡頭時鏡像） */
$('arSnap').onclick=()=>{
  if(!arVideo.videoWidth) return;
  const cw=arCv.clientWidth, ch=arCv.clientHeight, d=Math.min(devicePixelRatio||1,2), vw=arVideo.videoWidth, vh=arVideo.videoHeight;
  const c=document.createElement('canvas'); c.width=Math.round(cw*d); c.height=Math.round(ch*d); const x=c.getContext('2d');
  if($('arView').classList.contains('mirror')){ x.translate(c.width,0); x.scale(-1,1); }
  const sc=Math.max(cw/vw,ch/vh)*d; x.drawImage(arVideo,(c.width-vw*sc)/2,(c.height-vh*sc)/2,vw*sc,vh*sc);
  G.r.render(G.scene,G.cam); x.drawImage(arGl,0,0,c.width,c.height);
  if(AR.skel) x.drawImage(arCv,0,0,c.width,c.height);
  $('arShotImg').src=c.toDataURL('image/jpeg',.9); $('arShot').hidden=false;
};
$('arShotClose').onclick=()=>{ $('arShot').hidden=true; };
$('arClose').onclick=stopAR;
$('arFlip').onclick=async()=>{ AR.facing=AR.facing==='user'?'environment':'user'; try{ await openCamera(); }catch(e){ arMsg('無法切換鏡頭：'+(e.message||e)); } };
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&AR.running) stopAR(); });


}

if(window.BeadStudio) boot(window.BeadStudio);
else window.addEventListener('beadstudio:ready',()=>boot(window.BeadStudio),{once:true});
})();
