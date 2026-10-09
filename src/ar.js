/* 串珠盤 AR 試戴外掛（測試版：第 0 階段）
   只在 ar.html 載入；正式版 index.html 不會載入這個檔案。
   只透過 window.BeadStudio 介面和主程式溝通（見 src/bead-studio.html 最後面的 plugin interface）。

   1. 進入前先做「手機檢查」：環境檢查 + 載入偵測模型 + 模擬約 2.5 秒的實際運算量，給出建議
   2. 開相機、每格跑手部偵測，把 21 個關鍵點畫在畫面上（還沒有戴手鍊）

   設定（可寫在 web/config.js 的 window.BEAD_CONFIG）：arLib / arWasm / arModel */
(() => {
  "use strict";
  const CFG = Object.assign(
    {
      arLib:
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
      arWasm:
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
      arModel: [
        "models/hand_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      ],
    },
    window.BEAD_CONFIG || {},
  );
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);
  const esc = (t) =>
    String(t).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

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
.ar-msg{position:absolute;left:16px;right:16px;top:40%;text-align:center;font-size:15px;line-height:1.6}
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
  <canvas id="arCanvas"></canvas>
  <div class="ar-hud"><span id="arHudL">準備相機…</span><span id="arHudR"></span></div>
  <div class="ar-guide" id="arGuide">把手腕放進框內</div>
  <div class="ar-msg" id="arMsg" hidden></div>
  <div class="ar-bar">
    <button id="arClose">結束試戴</button>
    <span style="font-size:12px;opacity:.8">測試版：顯示手部偵測點</span>
    <button id="arFlip">切換鏡頭</button>
  </div>
</div>
`;
  const BUTTON = `
<button class="arbtn" id="arBtn" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>AR 試戴</button>
`;

  function boot(BS) {
    if (!BS || BS.version !== 1) {
      console.warn("AR: BeadStudio 介面版本不符，停用 AR");
      return;
    }
    BS.orderSource = "ar-test";
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    document.body.insertAdjacentHTML("beforeend", MARKUP);
    BS.stage.insertAdjacentHTML("beforeend", BUTTON);
    BS.onModeChange((m) => {
      $("arBtn").hidden = m !== "wear";
    });
    const CONFIG = CFG;

    const AR = {
      lib: null,
      lm: null,
      delegate: "",
      stream: null,
      facing: "environment",
      running: false,
      lastTs: 0,
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const LS_KEY = "bead-ar-check-v1";
    function lsGet() {
      try {
        return JSON.parse(localStorage.getItem(LS_KEY) || "null");
      } catch {
        return null;
      }
    }
    function lsSet(v) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(v));
      } catch {}
    }

    function inAppBrowser() {
      const ua = navigator.userAgent || "";
      if (/\bLine\//i.test(ua)) return "LINE";
      if (/Instagram/i.test(ua)) return "Instagram";
      if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
      if (/MicroMessenger/i.test(ua)) return "微信";
      if (/Threads/i.test(ua)) return "Threads";
      return "";
    }
    function webglInfo() {
      try {
        const c = document.createElement("canvas"),
          g = c.getContext("webgl2");
        if (!g) return { ok: false };
        const ext = g.getExtension("WEBGL_debug_renderer_info");
        return {
          ok: true,
          gpu: ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "",
        };
      } catch {
        return { ok: false };
      }
    }
    /* 第一次使用要下載約 17 MB（運算核心 9.4 MB＋手部模型 7.5 MB），手機網路可能要十幾秒。
   所以兩個大檔自己下載，才能顯示進度；之後瀏覽器會快取，第二次幾乎不用等。
   onProgress({stage:'download'|'init', loaded, total, text}) */
    async function fetchWithProgress(url, onBytes, stallMs = 20000) {
      const ctrl = new AbortController();
      let timer = setTimeout(() => ctrl.abort(), stallMs);
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) {
        clearTimeout(timer);
        throw new Error(`下載失敗（${r.status}）`);
      }
      const total = +r.headers.get("content-length") || 0;
      if (!r.body || !r.body.getReader) {
        clearTimeout(timer);
        const b = new Uint8Array(await r.arrayBuffer());
        onBytes(b.length, b.length);
        return b;
      }
      const reader = r.body.getReader(),
        parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        onBytes(got, total);
        clearTimeout(timer);
        timer = setTimeout(() => ctrl.abort(), stallMs); // 超過 20 秒沒有任何進度才放棄
      }
      clearTimeout(timer);
      const out = new Uint8Array(got);
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      return out;
    }
    const withTimeout = (promise, ms, msg) =>
      Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
      ]);
    const MB = (n) => (n / 1048576).toFixed(1);
    async function loadLandmarker(onProgress) {
      if (AR.lm) return AR.lm;
      const say = (p) => onProgress && onProgress(p);
      say({ stage: "download", loaded: 0, total: 0, text: "連線中" });
      if (!AR.lib)
        AR.lib = await withTimeout(
          import(CONFIG.arLib),
          30000,
          "AR 元件下載逾時",
        );
      const { FilesetResolver, HandLandmarker } = AR.lib;
      const files = await FilesetResolver.forVisionTasks(CONFIG.arWasm);
      // 兩個大檔同時下載，合併計算進度（模型大小在下載前未知時先用 7.5 MB 估）
      const prog = { wasm: [0, 9.4e6], model: [0, 7.8e6] };
      const tick = () => {
        const l = prog.wasm[0] + prog.model[0],
          t = prog.wasm[1] + prog.model[1];
        say({
          stage: "download",
          loaded: l,
          total: t,
          text: `下載中 ${MB(l)} / ${MB(t)} MB`,
        });
      };
      const wasmJob = (async () => {
        if (!files.wasmBinaryPath || AR.wasmUrl) return;
        const bytes = await fetchWithProgress(files.wasmBinaryPath, (g, t) => {
          prog.wasm = [g, t || prog.wasm[1]];
          tick();
        });
        AR.wasmUrl = URL.createObjectURL(
          new Blob([bytes], { type: "application/wasm" }),
        );
      })();
      const modelJob = (async () => {
        if (AR.modelBuf) return;
        let lastErr;
        for (const url of [].concat(CONFIG.arModel)) {
          try {
            AR.modelBuf = await fetchWithProgress(url, (g, t) => {
              prog.model = [g, t || prog.model[1]];
              tick();
            });
            return;
          } catch (e) {
            lastErr = e;
            prog.model[0] = 0;
          }
        }
        throw lastErr || new Error("找不到手部模型");
      })();
      await Promise.all([wasmJob, modelJob]);
      if (AR.wasmUrl) files.wasmBinaryPath = AR.wasmUrl;
      let lastErr;
      for (const delegate of ["GPU", "CPU"]) {
        try {
          say({
            stage: "init",
            text:
              delegate === "GPU" ? "啟動中（GPU）" : "GPU 無法使用，改用 CPU",
          });
          AR.lm = await withTimeout(
            HandLandmarker.createFromOptions(files, {
              baseOptions: { modelAssetBuffer: AR.modelBuf, delegate },
              runningMode: "VIDEO",
              numHands: 1,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            }),
            25000,
            `${delegate} 啟動逾時`,
          );
          AR.delegate = delegate;
          return AR.lm;
        } catch (e) {
          lastErr = e;
          console.warn("AR init", delegate, e);
        }
      }
      throw lastErr || new Error("model");
    }
    const nextTs = () => {
      const t = Math.max(performance.now(), AR.lastTs + 1);
      AR.lastTs = t;
      return t;
    };

    /* 模擬運算：用一張會動的 640×480 假畫面跑手部偵測，同時用 3D 畫一圈 24 顆珠子，量每格要花多少時間。
   畫面裡沒有手時偵測器每格都會跑「找手掌」；真的有手時改成每格跑「關鍵點」，兩者運算量相近，
   所以偵測時間再乘 1.3 當作保守估計。 */
    async function simulateLoad(onProgress) {
      const W = 640,
        H = 480,
        fake = document.createElement("canvas");
      fake.width = W;
      fake.height = H;
      const fx = fake.getContext("2d");
      const oc = document.createElement("canvas");
      oc.width = oc.height = 360;
      const T3 = THREE,
        r = new T3.WebGLRenderer({ canvas: oc, antialias: true, alpha: true });
      r.setPixelRatio(1);
      const sc = new T3.Scene(),
        cam = new T3.PerspectiveCamera(30, 1, 1, 2000);
      cam.position.set(0, 60, 260);
      cam.lookAt(0, 0, 0);
      sc.add(new T3.HemisphereLight(0xffffff, 0x334444, 0.8));
      const dl = new T3.DirectionalLight(0xffffff, 0.7);
      dl.position.set(-1, 2, 3);
      sc.add(dl);
      const ringG = new T3.Group(),
        geo = new T3.SphereGeometry(4, 24, 16),
        mat = new T3.MeshStandardMaterial({ color: 0x9a6cc0, roughness: 0.2 });
      for (let i = 0; i < 24; i++) {
        const m = new T3.Mesh(geo, mat),
          a = (i / 24) * TAU;
        m.position.set(Math.cos(a) * 40, 0, Math.sin(a) * 26);
        ringG.add(m);
      }
      const occ = new T3.Mesh(
        new T3.CylinderGeometry(30, 30, 60, 32),
        new T3.MeshBasicMaterial({ colorWrite: false }),
      );
      sc.add(occ);
      sc.add(ringG);
      const det = [],
        ren = [],
        tot = [],
        WARM = 8,
        N = 45,
        t0 = performance.now();
      for (let i = 0; i < WARM + N; i++) {
        const k = i / 10;
        const g = fx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, `hsl(${(i * 7) % 360},35%,55%)`);
        g.addColorStop(1, "#222");
        fx.fillStyle = g;
        fx.fillRect(0, 0, W, H);
        fx.fillStyle = "#d9a98a";
        fx.beginPath();
        fx.ellipse(
          W / 2 + Math.sin(k) * 60,
          H / 2,
          90,
          140,
          Math.sin(k * 0.7) * 0.4,
          0,
          TAU,
        );
        fx.fill();
        const a = performance.now();
        AR.lm.detectForVideo(fake, nextTs());
        const b = performance.now();
        ringG.rotation.y = k;
        r.render(sc, cam);
        r.getContext().finish();
        const c = performance.now();
        if (i >= WARM) {
          det.push(b - a);
          ren.push(c - b);
          tot.push((b - a) * 1.3 + (c - b));
        }
        onProgress && onProgress((i + 1) / (WARM + N));
        await new Promise(requestAnimationFrame);
        if (performance.now() - t0 > 6000) break;
      }
      r.dispose();
      geo.dispose();
      mat.dispose();
      const med = (a) => {
        const x = [...a].sort((p, q) => p - q);
        return x.length ? x[Math.floor(x.length / 2)] : Infinity;
      };
      const p90 = (a) => {
        const x = [...a].sort((p, q) => p - q);
        return x.length ? x[Math.floor(x.length * 0.9)] : Infinity;
      };
      // 相機畫面本身和瀏覽器排版也要時間，再加 4ms
      const frameMs = med(tot) + 4,
        worstMs = p90(tot) + 4;
      return {
        detMs: med(det),
        renMs: med(ren),
        frameMs,
        worstMs,
        fps: Math.min(60, 1000 / frameMs),
      };
    }

    const ICON = { ok: "✓", warn: "!", fail: "✕", run: "…" };
    function renderChecks(list) {
      $("arChecks").innerHTML = list
        .map(
          (c) =>
            `<li data-s="${c.s}"><span class="i">${ICON[c.s]}</span><span class="k">${esc(c.k)}</span><span class="v">${esc(c.v || "")}</span></li>`,
        )
        .join("");
    }
    function setVerdict(v, badge, text) {
      $("arVerdict").dataset.v = v;
      $("arBadge").textContent = badge;
      $("arSummary").textContent = text;
    }
    function setButtons(btns) {
      const box = $("arBtns");
      box.innerHTML = "";
      btns.forEach(([label, fn, primary]) => {
        const b = document.createElement("button");
        b.textContent = label;
        if (primary) b.className = "primary";
        b.onclick = fn;
        box.appendChild(b);
      });
      const p = box.querySelector(".primary") || box.querySelector("button");
      p && p.focus();
    }
    const closeDlg = () => {
      $("arDlg").hidden = true;
      $("arBtn").focus();
    };

    async function runCheck() {
      const checks = [];
      const push = (k, s, v) => {
        checks.push({ k, s, v });
        renderChecks(checks);
      };
      $("arRetest").hidden = true;
      setButtons([["取消", closeDlg]]);
      $("arMeter").style.width = "0%";
      setVerdict("run", "測試中", "正在檢查這支手機。");
      // 1. 環境
      const iab = inAppBrowser(),
        secure = window.isSecureContext,
        cam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        gl = webglInfo();
      push(
        "安全連線（HTTPS）",
        secure ? "ok" : "fail",
        secure ? "" : "需要 https 網址",
      );
      push("相機功能", cam ? "ok" : "fail", cam ? "" : "瀏覽器不支援");
      push("3D 繪圖（WebGL2）", gl.ok ? "ok" : "fail", gl.ok ? "" : "不支援");
      if (iab) push(`${iab} 內建瀏覽器`, "warn", "可能無法開相機");
      const net = navigator.connection;
      if (
        net &&
        !AR.lm &&
        (net.saveData || /2g|3g/.test(net.effectiveType || ""))
      )
        push(
          "網路",
          net.saveData ? "warn" : "warn",
          net.saveData ? "省數據模式" : "網路較慢，下載會久一點",
        );
      const mem = navigator.deviceMemory,
        cores = navigator.hardwareConcurrency;
      if (mem || cores)
        push(
          "裝置規格",
          mem && mem <= 2 ? "warn" : "ok",
          [cores ? `${cores} 核心` : "", mem ? `${mem} GB` : ""]
            .filter(Boolean)
            .join("・"),
        );
      const blocked = !secure || !cam || !gl.ok;
      // 2. 模型
      let res = null,
        loadErr = null;
      if (!blocked) {
        const idx = checks.length;
        push("載入手部偵測模型", "run", "");
        const t0 = performance.now(),
          cached = !!AR.lm;
        if (!cached)
          $("arSummary").textContent =
            "第一次使用要下載約 17 MB 的 AR 元件，用行動網路可能要十幾秒。之後再開會快很多。";
        const clock = setInterval(() => {
          $("arBadge").textContent =
            `測試中 ${Math.round((performance.now() - t0) / 1000)} 秒`;
        }, 500);
        try {
          await loadLandmarker((p) => {
            checks[idx].v = p.text;
            renderChecks(checks);
            $("arMeter").style.width =
              (p.stage === "download"
                ? p.total
                  ? (60 * p.loaded) / p.total
                  : 2
                : 65
              ).toFixed(1) + "%";
          });
          checks[idx] = {
            k: "載入手部偵測模型",
            s: "ok",
            v: `${((performance.now() - t0) / 1000).toFixed(1)} 秒・${AR.delegate === "GPU" ? "GPU" : "CPU（較慢）"}`,
          };
        } catch (e) {
          loadErr = e;
          checks[idx] = {
            k: "載入手部偵測模型",
            s: "fail",
            v: /逾時|abort/i.test(String(e && (e.message || e.name)))
              ? "網路太慢或逾時"
              : "載入失敗",
          };
          console.warn("AR load", e);
        } finally {
          clearInterval(clock);
          $("arBadge").textContent = "測試中";
        }
        renderChecks(checks);
      }
      // 3. 模擬運算
      if (!blocked && !loadErr) {
        const idx = checks.length;
        push("模擬試戴運算", "run", "");
        $("arSummary").textContent = "正在模擬試戴的運算量，約 2～3 秒。";
        try {
          res = await simulateLoad((f) => {
            $("arMeter").style.width = (70 + f * 30).toFixed(1) + "%";
          });
          checks[idx] = {
            k: "模擬試戴運算",
            s: res.fps >= 24 ? "ok" : res.fps >= 14 ? "warn" : "fail",
            v: `約 ${Math.round(res.fps)} 格/秒`,
          };
        } catch (e) {
          loadErr = e;
          checks[idx] = { k: "模擬試戴運算", s: "fail", v: "執行失敗" };
          console.warn("AR bench", e);
        }
        renderChecks(checks);
      }
      $("arMeter").style.width = "100%";
      // 4. 結論
      let v;
      if (blocked)
        v = [
          "no",
          "無法使用",
          !secure
            ? "這個網址不是 https，瀏覽器不允許開相機。"
            : !cam
              ? "這個瀏覽器沒有相機功能。"
              : "這支手機的瀏覽器不支援 3D 繪圖。",
        ];
      else if (loadErr)
        v = [
          "no",
          "無法使用",
          "AR 元件載入失敗，可能是網路不穩，或目前的環境擋住了下載（例如預覽模式）。可以稍後再試。",
        ];
      else {
        let lv = res.fps >= 24 ? 2 : res.fps >= 14 ? 1 : 0;
        if (mem && mem <= 2 && lv > 0) lv--; // 記憶體很小的手機，長時間使用容易發燙、被系統降速
        if (AR.delegate === "CPU" && lv > 1) lv = 1;
        v = [
          [
            "bad",
            "不建議",
            "這支手機跑起來會明顯卡頓，試戴效果不好。建議改用「戴上看」的 3D 預覽。",
          ],
          [
            "ok",
            "可以使用",
            "跑得動，但畫面可能偶爾卡一下。使用幾分鐘後手機會變熱，是正常現象。",
          ],
          ["good", "建議使用", "這支手機的效能足夠，試戴畫面會很流暢。"],
        ][lv];
      }
      if (iab && v[0] !== "no")
        v[2] += `\n你正在用 ${iab} 的內建瀏覽器，如果打不開相機，請點右上角選單，選「用瀏覽器開啟」。`;
      setVerdict(...v);
      $("arSummary").style.whiteSpace = "pre-line";
      const back = ["使用 3D 戴上看", closeDlg];
      if (v[0] === "good" || v[0] === "ok")
        setButtons([
          ["先不要", closeDlg],
          ["開始試戴", startAR, true],
        ]);
      else if (v[0] === "bad")
        setButtons([
          ["仍要試試", startAR],
          [back[0], back[1], true],
        ]);
      else setButtons([[back[0], back[1], true]]);
      $("arRetest").hidden = false;
      if (res)
        lsSet({
          at: Date.now(),
          ua: navigator.userAgent,
          v,
          checks,
          fps: res.fps,
        });
    }
    function openCheck() {
      $("arDlg").hidden = false;
      const prev = lsGet();
      if (
        prev &&
        prev.ua === navigator.userAgent &&
        Date.now() - prev.at < 7 * 864e5
      ) {
        renderChecks(prev.checks);
        setVerdict(...prev.v);
        $("arSummary").style.whiteSpace = "pre-line";
        $("arMeter").style.width = "100%";
        const back = ["使用 3D 戴上看", closeDlg];
        if (prev.v[0] === "good" || prev.v[0] === "ok")
          setButtons([
            ["先不要", closeDlg],
            ["開始試戴", startAR, true],
          ]);
        else
          setButtons([
            ["仍要試試", startAR],
            [back[0], back[1], true],
          ]);
        $("arRetest").hidden = false;
        $("arDlgTitle").textContent = "這支手機的檢查結果";
      } else {
        $("arDlgTitle").textContent = "檢查這支手機";
        runCheck();
      }
    }
    $("arBtn").onclick = openCheck;
    $("arRetest").onclick = () => {
      $("arDlgTitle").textContent = "檢查這支手機";
      runCheck();
    };
    $("arDlg").addEventListener("click", (e) => {
      if (e.target === $("arDlg")) closeDlg();
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("arDlg").hidden) closeDlg();
    });

    /* ---------- 相機 + 手部關鍵點 ---------- */
    const HAND_LINKS = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [5, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [9, 13],
      [13, 14],
      [14, 15],
      [15, 16],
      [13, 17],
      [17, 18],
      [18, 19],
      [19, 20],
      [0, 17],
    ];
    const arVideo = $("arVideo"),
      arCv = $("arCanvas"),
      arCtx = arCv.getContext("2d");
    function arMsg(t) {
      $("arMsg").hidden = !t;
      $("arMsg").textContent = t || "";
    }
    async function openCamera() {
      if (AR.stream) AR.stream.getTracks().forEach((t) => t.stop());
      AR.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: AR.facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      arVideo.srcObject = AR.stream;
      await arVideo.play();
      const set = AR.stream.getVideoTracks()[0].getSettings();
      const front = set.facingMode
        ? set.facingMode === "user"
        : AR.facing === "user";
      $("arView").classList.toggle("mirror", front);
    }
    async function startAR() {
      $("arDlg").hidden = true;
      $("arView").hidden = false;
      BS.setPaused(true);
      arMsg("");
      $("arHudL").textContent = "準備相機…";
      $("arHudR").textContent = "";
      try {
        await loadLandmarker((p) => {
          $("arHudL").textContent =
            p.text === "連線中" ? "準備 AR 元件…" : p.text;
        });
        $("arHudL").textContent = "開啟相機…";
        await openCamera();
      } catch (e) {
        console.warn("AR start", e);
        const n = e && e.name;
        arMsg(
          n === "NotAllowedError"
            ? "沒有相機權限。請到瀏覽器設定允許這個網站使用相機，再重新開啟試戴。"
            : n === "NotFoundError"
              ? "找不到可用的相機。"
              : n === "NotReadableError"
                ? "相機被其他 App 佔用中，請關閉其他使用相機的 App 再試一次。"
                : "無法開啟試戴：" + ((e && e.message) || e),
        );
        return;
      }
      AR.running = true;
      AR.fps = [];
      requestAnimationFrame(arLoop);
    }
    function stopAR() {
      AR.running = false;
      if (AR.stream) {
        AR.stream.getTracks().forEach((t) => t.stop());
        AR.stream = null;
      }
      arVideo.srcObject = null;
      $("arView").hidden = true;
      BS.setPaused(false);
      $("arBtn").focus();
    }
    function arLoop(now) {
      if (!AR.running) return;
      const vw = arVideo.videoWidth,
        vh = arVideo.videoHeight;
      if (vw && arVideo.readyState >= 2) {
        const cw = arCv.clientWidth,
          ch = arCv.clientHeight,
          d = Math.min(devicePixelRatio || 1, 2);
        if (
          arCv.width !== Math.round(cw * d) ||
          arCv.height !== Math.round(ch * d)
        ) {
          arCv.width = Math.round(cw * d);
          arCv.height = Math.round(ch * d);
        }
        const t0 = performance.now(),
          res = AR.lm.detectForVideo(arVideo, nextTs()),
          dt = performance.now() - t0;
        // video is drawn with object-fit: cover → map normalized landmarks the same way
        const sc = Math.max(cw / vw, ch / vh),
          ox = (cw - vw * sc) / 2,
          oy = (ch - vh * sc) / 2;
        const P = (l) => [(ox + l.x * vw * sc) * d, (oy + l.y * vh * sc) * d];
        arCtx.clearRect(0, 0, arCv.width, arCv.height);
        const hand = res.landmarks && res.landmarks[0];
        $("arGuide").hidden = !!hand;
        if (hand) {
          arCtx.lineWidth = 3 * d;
          arCtx.strokeStyle = "rgba(216,178,94,.9)";
          arCtx.beginPath();
          for (const [a, b] of HAND_LINKS) {
            const p = P(hand[a]),
              q = P(hand[b]);
            arCtx.moveTo(...p);
            arCtx.lineTo(...q);
          }
          arCtx.stroke();
          hand.forEach((l, i) => {
            const [x, y] = P(l);
            arCtx.fillStyle = i === 0 ? "#ff6b5a" : "#fff";
            arCtx.beginPath();
            arCtx.arc(x, y, (i === 0 ? 8 : 4.5) * d, 0, TAU);
            arCtx.fill();
          });
          // 手腕點：之後手鍊會戴在這附近
          const [wx, wy] = P(hand[0]);
          arCtx.strokeStyle = "#ff6b5a";
          arCtx.lineWidth = 2 * d;
          arCtx.beginPath();
          arCtx.arc(wx, wy, 16 * d, 0, TAU);
          arCtx.stroke();
          const hd =
            res.handedness && res.handedness[0] && res.handedness[0][0];
          // MediaPipe 假設畫面是鏡像的；後鏡頭時左右要對調
          const mirror = $("arView").classList.contains("mirror");
          const side = hd
            ? (hd.categoryName === "Left") === mirror
              ? "左手"
              : "右手"
            : "";
          $("arHudR").innerHTML =
            `${side}・信心 <b>${hd ? Math.round(hd.score * 100) : 0}%</b>`;
        } else $("arHudR").textContent = "尋找手部…";
        AR.fps.push(now);
        while (AR.fps.length && now - AR.fps[0] > 1000) AR.fps.shift();
        $("arHudL").innerHTML =
          `<b>${AR.fps.length}</b> 格/秒・偵測 ${dt.toFixed(0)} ms・${AR.delegate}`;
      }
      requestAnimationFrame(arLoop);
    }
    $("arClose").onclick = stopAR;
    $("arFlip").onclick = async () => {
      AR.facing = AR.facing === "user" ? "environment" : "user";
      try {
        await openCamera();
      } catch (e) {
        arMsg("無法切換鏡頭：" + (e.message || e));
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && AR.running) stopAR();
    });
  }

  if (window.BeadStudio) boot(window.BeadStudio);
  else
    window.addEventListener("beadstudio:ready", () => boot(window.BeadStudio), {
      once: true,
    });
})();
