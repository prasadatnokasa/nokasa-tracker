// ============================================================
//  NoKasa Tracker — Cloudflare Worker
//  env vars required:  PASSWORD  |  APPS_SCRIPT_URL
//  Deploy: wrangler deploy
// ============================================================

const SALT         = 'nokasa-tracker-v1';
const COOKIE_NAME  = 'nk_sess';
const COOKIE_DAYS  = 7;

// ── CRYPTO HELPERS ────────────────────────────────────────────
async function makeToken(password) {
  const enc  = new TextEncoder();
  const data = enc.encode(password + SALT);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseCookies(header) {
  const map = {};
  if (!header) return map;
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) map[k.trim()] = v.join('=');
  });
  return map;
}

// ── GOOGLE APPS SCRIPT PROXY ──────────────────────────────────
// Apps Script returns a 302 redirect; we must manually follow
// with the original method so doPost still fires.
async function callAppsScript(url, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  const init    = { method, headers, body, redirect: 'manual' };

  let response = await fetch(url, init);

  // Follow redirect preserving method
  if (response.status === 302 || response.status === 301) {
    const location = response.headers.get('Location');
    if (location) {
      response = await fetch(location, { method, headers, body });
    }
  }
  return response;
}

// ── MAIN FETCH ────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const { PASSWORD, APPS_SCRIPT_URL } = env;

    // ── /auth  ────────────────────────────────────────────────
    if (url.pathname === '/auth') {

      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (body.password === PASSWORD) {
          const token = await makeToken(PASSWORD);
          const maxAge = COOKIE_DAYS * 86400;
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie':   `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
            }
          });
        }
        return new Response(JSON.stringify({ error: 'Wrong password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (request.method === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`
          }
        });
      }
    }

    // ── Auth check ────────────────────────────────────────────
    const cookies      = parseCookies(request.headers.get('Cookie'));
    const expectedTok  = await makeToken(PASSWORD);
    const isAuthed     = cookies[COOKIE_NAME] === expectedTok;

    // ── /api  ─────────────────────────────────────────────────
    if (url.pathname === '/api') {
      if (!isAuthed) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const method  = request.method;
      const target  = method === 'GET'
        ? APPS_SCRIPT_URL + url.search
        : APPS_SCRIPT_URL;
      const body    = method === 'POST' ? await request.text() : undefined;

      try {
        const upstream = await callAppsScript(target, method, body);
        const text     = await upstream.text();
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Upstream error: ' + e.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // ── Serve app HTML ────────────────────────────────────────
    const html = buildHTML(isAuthed);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache'
      }
    });
  }
};

// ── HTML APP ──────────────────────────────────────────────────
function buildHTML(isAuthed) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#16a34a">
<title>NoKasa Tracker</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --g:#16a34a;--gd:#15803d;--gl:#dcfce7;--gbg:#f0fdf4;
  --r:#dc2626;--rl:#fef2f2;
  --gr0:#f9fafb;--gr1:#f3f4f6;--gr2:#e5e7eb;--gr3:#d1d5db;
  --gr5:#6b7280;--gr7:#374151;--gr9:#111827;
  --sh:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.06);
  --nav-h:60px;
  --safe-b:env(safe-area-inset-bottom,0px);
}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--gr0);color:var(--gr9);max-width:600px;margin:0 auto;position:relative}

/* ── LOGIN ── */
#login{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;background:#fff}
.login-logo{width:80px;height:80px;background:var(--g);border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:42px;margin-bottom:20px;box-shadow:0 8px 24px rgba(22,163,74,.3)}
.login-h{font-size:26px;font-weight:800;color:var(--gr9);margin-bottom:4px}
.login-sub{font-size:14px;color:var(--gr5);margin-bottom:36px}
.login-form{width:100%;max-width:340px}

/* ── APP ── */
#app{display:flex;flex-direction:column;height:100dvh}
.top-bar{background:#fff;border-bottom:1px solid var(--gr2);padding:12px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:sticky;top:0;z-index:20}
.top-bar-l .brand{font-size:17px;font-weight:800;color:var(--g)}
.top-bar-l .day{font-size:11px;color:var(--gr5);margin-top:1px}
.scrollable{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 14px calc(var(--nav-h) + var(--safe-b) + 14px)}

/* ── BOTTOM NAV ── */
.bnav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:600px;background:#fff;border-top:1px solid var(--gr2);display:flex;padding-bottom:var(--safe-b);z-index:100}
.bnav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 4px;cursor:pointer;border:none;background:none;color:var(--gr5);font-size:10px;gap:3px;transition:color .15s}
.bnav-item.on{color:var(--g)}
.bnav-item svg{width:22px;height:22px;stroke-width:1.8}

/* ── CARDS ── */
.card{background:#fff;border-radius:14px;padding:16px;box-shadow:var(--sh);margin-bottom:12px}
.ch{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.ct{font-size:15px;font-weight:700}

/* ── STATS GRID ── */
.sgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.scard{background:#fff;border-radius:12px;padding:14px;box-shadow:var(--sh)}
.sl{font-size:10px;color:var(--gr5);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.sv{font-size:20px;font-weight:800;color:var(--gr9)}
.su{font-size:11px;color:var(--gr5);font-weight:400}

/* ── FORMS ── */
.fg{margin-bottom:14px}
label{display:block;font-size:12px;font-weight:600;color:var(--gr7);margin-bottom:5px;text-transform:uppercase;letter-spacing:.3px}
input,select{width:100%;padding:11px 14px;border:1.5px solid var(--gr2);border-radius:10px;font-size:15px;color:var(--gr9);background:#fff;outline:none;-webkit-appearance:none;appearance:none;transition:border-color .15s}
input:focus,select:focus{border-color:var(--g)}
input[type=date],input[type=month]{color:var(--gr9)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}

/* ── BUTTONS ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;border:none;transition:all .15s}
.btn-p{background:var(--g);color:#fff;width:100%;padding:14px;font-size:15px;border-radius:12px}
.btn-p:active{background:var(--gd)}
.btn-p:disabled{opacity:.6}
.btn-o{background:#fff;border:1.5px solid var(--g);color:var(--g)}
.btn-s{background:var(--gr1);color:var(--gr7)}
.btn-d{background:var(--rl);color:var(--r)}
.btn-sm{padding:6px 12px;font-size:12px;border-radius:7px}
.btn-xs{padding:4px 8px;font-size:11px;border-radius:6px}
.btn-w{width:100%}

/* ── VEHICLE ENTRY CARDS ── */
.ve{background:var(--gbg);border:1px solid var(--gl);border-radius:12px;padding:14px;margin-bottom:10px;position:relative}
.ve-name{font-size:13px;font-weight:700;color:var(--gd);margin-bottom:8px}
.ve-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ve-stat{font-size:12px;color:var(--gr7)}
.ve-stat b{color:var(--gr9)}
.ve-del{position:absolute;top:10px;right:10px}

/* ── STORAGE ── */
.stcard{background:#fff;border-radius:14px;padding:16px;box-shadow:var(--sh);margin-bottom:12px}
.pbar{background:var(--gr1);border-radius:100px;height:8px;overflow:hidden;margin:8px 0 4px}
.pfill{height:100%;border-radius:100px;background:var(--g);transition:width .5s}

/* ── MODAL ── */
.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:300;display:flex;align-items:flex-end;justify-content:center}
.modal{background:#fff;border-radius:22px 22px 0 0;padding:24px 20px;width:100%;max-width:600px;max-height:92dvh;overflow-y:auto;animation:su .28s ease}
@keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
.mh{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.mt{font-size:18px;font-weight:800}
.mclose{width:32px;height:32px;border-radius:50%;background:var(--gr1);border:none;cursor:pointer;font-size:20px;color:var(--gr5);display:flex;align-items:center;justify-content:center}

/* ── MISC ── */
.hidden{display:none!important}
.screen{display:none}.screen.on{display:block}
.sh{font-size:20px;font-weight:800;margin-bottom:2px}
.ss{font-size:12px;color:var(--gr5);margin-bottom:14px}
.empty{text-align:center;padding:40px 16px;color:var(--gr5)}
.empty .ei{font-size:44px;margin-bottom:10px}
.tag{display:inline-block;padding:3px 9px;border-radius:100px;font-size:11px;font-weight:700}
.tg{background:var(--gl);color:var(--gd)}
.tgr{background:var(--gr1);color:var(--gr7)}
.load{display:flex;align-items:center;justify-content:center;padding:40px;color:var(--gr5);gap:8px}
.spin{width:20px;height:20px;border:3px solid var(--gr2);border-top-color:var(--g);border-radius:50%;animation:rot .7s linear infinite;flex-shrink:0}
@keyframes rot{to{transform:rotate(360deg)}}
.err{background:var(--rl);color:var(--r);padding:10px 12px;border-radius:9px;font-size:13px;margin-bottom:12px}
.ok{background:var(--gbg);color:var(--gd);padding:10px 12px;border-radius:9px;font-size:13px;margin-bottom:12px}
.toast{position:fixed;bottom:calc(var(--nav-h) + var(--safe-b) + 10px);left:50%;transform:translateX(-50%);background:var(--gr9);color:#fff;padding:10px 22px;border-radius:100px;font-size:13px;font-weight:600;z-index:500;white-space:nowrap;animation:tfade 2.6s ease forwards}
@keyframes tfade{0%{opacity:0;transform:translateX(-50%) translateY(8px)}12%{opacity:1;transform:translateX(-50%) translateY(0)}80%{opacity:1}100%{opacity:0}}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:var(--gr5);font-weight:600;padding:7px 0;border-bottom:1px solid var(--gr1);font-size:10px;text-transform:uppercase}
td{padding:9px 0;border-bottom:1px solid var(--gr1);color:var(--gr7)}
td:last-child,th:last-child{text-align:right}
.datenav{display:flex;align-items:center;gap:10px;background:#fff;border-radius:12px;padding:12px 14px;box-shadow:var(--sh);margin-bottom:14px}
.datenav input{flex:1;border:none;font-size:15px;font-weight:700;padding:0;background:transparent}
.sum-banner{background:var(--gbg);border:1px solid var(--gl);border-radius:12px;padding:14px;margin-bottom:14px}
.sum-label{font-size:11px;font-weight:700;color:var(--gd);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
.sum-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sum-item{font-size:12px;color:var(--gr7)}
.sum-item b{color:var(--gr9);font-weight:800}
.month-row{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.month-row input{flex:1;font-size:15px;font-weight:700}
.ratio-bar{display:flex;height:10px;border-radius:100px;overflow:hidden;margin:10px 0 6px;background:var(--gr1)}
.rb-g{background:var(--g);transition:width .5s}
.rb-r{background:#fca5a5;transition:width .5s}
.list-item{padding:11px 0;border-bottom:1px solid var(--gr1);font-size:14px;display:flex;align-items:center;gap:8px}
.list-item:last-child{border:none}
.section-hdr{font-size:11px;font-weight:700;color:var(--gr5);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px}
</style>
</head>
<body>

<!-- ═══════════════════ LOGIN ═══════════════════ -->
<div id="login">
  <div class="login-logo">🌿</div>
  <div class="login-h">NoKasa Tracker</div>
  <div class="login-sub">Clothes Collection Management</div>
  <div class="login-form">
    <div id="lerr" class="err hidden"></div>
    <div class="fg">
      <label>Password</label>
      <input type="password" id="pwd" placeholder="Enter password" autocomplete="current-password">
    </div>
    <button class="btn btn-p" id="lbtn" onclick="doLogin()">Sign In</button>
  </div>
</div>

<!-- ═══════════════════ APP ═══════════════════ -->
<div id="app" class="hidden">
  <div class="top-bar">
    <div class="top-bar-l">
      <div class="brand">NoKasa Tracker</div>
      <div class="day" id="hdr-date"></div>
    </div>
    <button class="btn btn-s btn-sm" onclick="doLogout()">Logout</button>
  </div>

  <div class="scrollable">

    <!-- ── ENTRY ── -->
    <div id="sc-entry" class="screen on">
      <div class="sh">Daily Collection</div>
      <div class="ss">Log vehicle-wise collections</div>

      <div class="datenav">
        <span style="font-size:20px">📅</span>
        <input type="date" id="entry-date" onchange="loadDay()">
        <div id="day-badge"></div>
      </div>

      <div id="day-sum" class="sum-banner hidden">
        <div class="sum-label">Day Summary</div>
        <div class="sum-grid">
          <div class="sum-item">Vehicles: <b id="s-veh">0</b></div>
          <div class="sum-item">Pickups: <b id="s-pkp">0</b></div>
          <div class="sum-item">Wearable: <b id="s-wear">0 kg</b></div>
          <div class="sum-item">Wastage: <b id="s-wast">0 kg</b></div>
        </div>
      </div>

      <div id="entries-list"></div>

      <button class="btn btn-o btn-w" style="margin-top:4px" onclick="openEntryModal()">
        ＋ Add Vehicle Entry
      </button>
    </div>

    <!-- ── STORAGE ── -->
    <div id="sc-storage" class="screen">
      <div class="sh">Storage</div>
      <div class="ss">Warehouse & shop inventory</div>
      <div id="storage-list"></div>
      <button class="btn btn-o btn-w" style="margin-top:4px" onclick="openPickupModal(null,0)">
        ＋ Log Vendor Pickup
      </button>
    </div>

    <!-- ── DASHBOARD ── -->
    <div id="sc-dash" class="screen">
      <div class="sh">Dashboard</div>
      <div class="month-row">
        <span style="font-size:20px">📊</span>
        <input type="month" id="dash-month" onchange="loadDash()">
      </div>
      <div id="dash-content"><div class="load"><div class="spin"></div>Loading…</div></div>
    </div>

    <!-- ── SETTINGS ── -->
    <div id="sc-settings" class="screen">
      <div class="sh">Settings</div>
      <div class="ss">Manage vehicles and storage locations</div>

      <div class="card">
        <div class="ch">
          <div class="ct">📍 Regions</div>
          <button class="btn btn-o btn-sm" onclick="openAddModal('region')">＋ Add</button>
        </div>
        <div id="reg-list"></div>
      </div>

      <div class="card">
        <div class="ch">
          <div class="ct">🚐 Vehicles</div>
          <button class="btn btn-o btn-sm" onclick="openAddModal('vehicle')">＋ Add</button>
        </div>
        <div id="veh-list"><div class="load"><div class="spin"></div></div></div>
      </div>

      <div class="card">
        <div class="ch">
          <div class="ct">🏭 Storages</div>
          <button class="btn btn-o btn-sm" onclick="openAddModal('storage')">＋ Add</button>
        </div>
        <div id="sto-list"><div class="load"><div class="spin"></div></div></div>
      </div>
    </div>

  </div><!-- /scrollable -->

  <!-- ── BOTTOM NAV ── -->
  <nav class="bnav">
    <button class="bnav-item on" id="nav-entry" onclick="nav('entry')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
      Entry
    </button>
    <button class="bnav-item" id="nav-storage" onclick="nav('storage')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
      Storage
    </button>
    <button class="bnav-item" id="nav-dash" onclick="nav('dash')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
      Dashboard
    </button>
    <button class="bnav-item" id="nav-settings" onclick="nav('settings')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
      Settings
    </button>
  </nav>
</div>

<!-- ═══════════════════ MODAL ═══════════════════ -->
<div id="backdrop" class="backdrop hidden" onclick="tryClose(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <div id="modal-body"></div>
  </div>
</div>

<script>
// ── STATE ────────────────────────────────────────────────────
let CFG       = { vehicles: [], storages: [], regions: [] };
let DAY_DATA  = [];
let CUR_DATE  = '';
let authed    = ${isAuthed};

// ── BOOT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hdr-date').textContent =
    new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  if (!authed) {
    show('login'); hide('app');
    q('#pwd').addEventListener('keypress', e => { if (e.key==='Enter') doLogin(); });
  } else {
    bootApp();
  }
});

async function bootApp() {
  hide('login'); show('app');
  const today = todayStr();
  q('#entry-date').value = today;
  CUR_DATE = today;
  q('#dash-month').value = today.substring(0,7);
  await loadConfig();
  loadDay();
}

// ── AUTH ─────────────────────────────────────────────────────
async function doLogin() {
  const pwd  = q('#pwd').value;
  const btn  = q('#lbtn');
  const err  = q('#lerr');
  btn.textContent = 'Signing in…'; btn.disabled = true;
  err.classList.add('hidden');
  try {
    const r = await fetch('/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:pwd}) });
    if (r.ok) { authed = true; bootApp(); }
    else { err.textContent = 'Wrong password.'; err.classList.remove('hidden'); }
  } catch { err.textContent = 'Connection error.'; err.classList.remove('hidden'); }
  btn.textContent = 'Sign In'; btn.disabled = false;
}

async function doLogout() {
  await fetch('/auth', { method:'DELETE' });
  authed = false;
  show('login'); hide('app');
  q('#pwd').value = '';
}

// ── NAVIGATION ───────────────────────────────────────────────
function nav(screen) {
  qAll('.screen').forEach(s => s.classList.remove('on'));
  qAll('.bnav-item').forEach(b => b.classList.remove('on'));
  q('#sc-' + screen).classList.add('on');
  q('#nav-' + screen).classList.add('on');
  if (screen === 'storage')  loadStorage();
  if (screen === 'dash')     loadDash();
  if (screen === 'settings') loadConfig().then(() => renderSettings());
}

// ── API WRAPPERS ─────────────────────────────────────────────
async function apiGet(params) {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch('/api?' + qs);
  if (res.status === 401) { authed=false; show('login'); hide('app'); throw new Error('Unauth'); }
  return res.json();
}

async function apiPost(body) {
  const res = await fetch('/api', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (res.status === 401) { authed=false; show('login'); hide('app'); throw new Error('Unauth'); }
  return res.json();
}

// ── CONFIG ───────────────────────────────────────────────────
async function loadConfig() {
  try {
    const data = await apiGet({ action:'getConfig' });
    if (data && data.vehicles) CFG = data;
  } catch {}
}

// ── DAILY ENTRY ──────────────────────────────────────────────
async function loadDay() {
  CUR_DATE = q('#entry-date').value;
  const dow = new Date(CUR_DATE + 'T00:00:00').getDay(); // local
  const badge = q('#day-badge');
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  if (dow === 4) {
    badge.innerHTML = '<span class="tag tgr">Holiday 🏖</span>';
    q('#entries-list').innerHTML = '<div class="empty"><div class="ei">🏖️</div>Thursday is a holiday</div>';
    q('#day-sum').classList.add('hidden');
    return;
  }

  badge.innerHTML = '<span class="tag tg">' + DAYS[dow] + '</span>';
  q('#entries-list').innerHTML = '<div class="load"><div class="spin"></div>Loading…</div>';

  try {
    const data = await apiGet({ action:'getCollections', date: CUR_DATE });
    DAY_DATA = data.collections || [];
    renderEntries();
  } catch {
    q('#entries-list').innerHTML = '<div class="err">Failed to load entries</div>';
  }
}

function renderEntries() {
  const list = q('#entries-list');
  const sumEl = q('#day-sum');

  if (!DAY_DATA.length) {
    list.innerHTML = '<div class="empty"><div class="ei">🚐</div>No entries yet for this day</div>';
    sumEl.classList.add('hidden');
    return;
  }

  const totW   = DAY_DATA.reduce((s,e) => s+e.wearableKG, 0);
  const totWa  = DAY_DATA.reduce((s,e) => s+e.wastageKG, 0);
  const totPkp = DAY_DATA.reduce((s,e) => s+e.pickups, 0);

  q('#s-veh').textContent  = DAY_DATA.length;
  q('#s-pkp').textContent  = totPkp;
  q('#s-wear').textContent = fmt(totW) + ' kg';
  q('#s-wast').textContent = fmt(totWa) + ' kg';
  sumEl.classList.remove('hidden');

  list.innerHTML = DAY_DATA.map(e => \`
    <div class="ve">
      <div class="ve-del">
        <button class="btn btn-d btn-xs" onclick="delEntry('\${esc(e.timestamp)}')">✕</button>
      </div>
      <div class="ve-name">🚐 \${esc(e.vehicle)}\${e.region ? ' &nbsp;·&nbsp; ' + esc(e.region) : ''}</div>
      <div class="ve-grid">
        <div class="ve-stat">Pickups: <b>\${e.pickups}</b></div>
        <div class="ve-stat">Wearable: <b>\${fmt(e.wearableKG)} kg</b></div>
        <div class="ve-stat">Wastage: <b>\${fmt(e.wastageKG)} kg</b></div>
        <div class="ve-stat" style="grid-column:span 2">Storage: <b>\${esc(e.storageLocation)||'—'}</b></div>
      </div>
    </div>
  \`).join('');
}

function openEntryModal() {
  if (!CFG.vehicles.length) { toast('Add vehicles in Settings first'); return; }
  if (!CFG.storages.length) { toast('Add storage locations in Settings first'); return; }

  const regionOpts = CFG.regions && CFG.regions.length
    ? opts(CFG.regions)
    : '<option value="">— select region —</option>';

  q('#modal-body').innerHTML = \`
    <div class="mh"><div class="mt">Add Vehicle Entry</div><button class="mclose" onclick="closeModal()">×</button></div>
    <div id="merr" class="err hidden"></div>
    <div class="two">
      <div class="fg">
        <label>Vehicle</label>
        <select id="m-veh">\${opts(CFG.vehicles)}</select>
      </div>
      <div class="fg">
        <label>Region</label>
        <select id="m-reg">\${regionOpts}</select>
      </div>
    </div>
    <div class="fg">
      <label>Number of Pickups (customers)</label>
      <input type="number" id="m-pkp" placeholder="0" min="0" step="1" inputmode="numeric">
    </div>
    <div class="two">
      <div class="fg">
        <label>Wearable (kg)</label>
        <input type="number" id="m-wear" placeholder="0.0" min="0" step="0.1" inputmode="decimal">
      </div>
      <div class="fg">
        <label>Wastage (kg)</label>
        <input type="number" id="m-wast" placeholder="0.0" min="0" step="0.1" inputmode="decimal">
      </div>
    </div>
    <div class="fg">
      <label>Storage Location</label>
      <select id="m-sto">\${opts(CFG.storages)}</select>
    </div>
    <button class="btn btn-p" id="m-save" onclick="saveEntry()">Save Entry</button>
  \`;
  openModal();
}

async function saveEntry() {
  const v    = q('#m-veh').value;
  const reg  = q('#m-reg') ? q('#m-reg').value : '';
  const pkp  = parseInt(q('#m-pkp').value) || 0;
  const wear = parseFloat(q('#m-wear').value) || 0;
  const wast = parseFloat(q('#m-wast').value) || 0;
  const sto  = q('#m-sto').value;
  const err  = q('#merr');

  if (wear === 0 && wast === 0) {
    err.textContent = 'Enter at least wearable or wastage weight'; err.classList.remove('hidden'); return;
  }
  setBusy('#m-save', 'Saving…');
  try {
    await apiPost({ action:'addCollection', date:CUR_DATE, vehicle:v, region:reg, pickups:pkp, wearableKG:wear, wastageKG:wast, storageLocation:sto });
    closeModal(); await loadDay(); toast('Entry saved ✓');
  } catch {
    err.textContent = 'Failed to save. Try again.'; err.classList.remove('hidden');
    resetBusy('#m-save', 'Save Entry');
  }
}

async function delEntry(ts) {
  if (!confirm('Delete this entry?')) return;
  try { await apiPost({ action:'deleteCollection', timestamp:ts }); await loadDay(); toast('Deleted'); }
  catch { toast('Failed to delete'); }
}

// ── STORAGE ─────────────────────────────────────────────────
async function loadStorage() {
  q('#storage-list').innerHTML = '<div class="load"><div class="spin"></div>Loading…</div>';
  try {
    const d = await apiGet({ action:'getStorageState' });
    renderStorage(d.storages || []);
  } catch {
    q('#storage-list').innerHTML = '<div class="err">Failed to load storage data</div>';
  }
}

function renderStorage(storages) {
  if (!storages.length) {
    q('#storage-list').innerHTML = '<div class="empty"><div class="ei">🏭</div>No storages yet<br><small>Add in Settings</small></div>';
    return;
  }

  const tIn  = storages.reduce((s,x) => s+x.totalIn, 0);
  const tOut = storages.reduce((s,x) => s+x.totalOut, 0);
  const tCur = storages.reduce((s,x) => s+x.currentStock, 0);

  let html = \`
    <div class="sum-banner" style="margin-bottom:14px">
      <div class="sum-label">All Warehouses Combined</div>
      <div class="sum-grid">
        <div class="sum-item">Total In: <b>\${fmt(tIn)} kg</b></div>
        <div class="sum-item">Vendor Out: <b>\${fmt(tOut)} kg</b></div>
        <div class="sum-item" style="grid-column:span 2">Current Stock: <b style="color:var(--g)">\${fmt(tCur)} kg</b></div>
      </div>
    </div>
  \`;

  html += storages.map(st => {
    const pct = st.totalIn > 0 ? Math.max(0, Math.min(100, st.currentStock / st.totalIn * 100)) : 0;
    return \`
      <div class="stcard">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div style="font-size:15px;font-weight:800">🏭 \${esc(st.name)}</div>
          <button class="btn btn-o btn-sm" onclick="openPickupModal('\${esc(st.name)}',\${st.currentStock})">Log Pickup</button>
        </div>
        <div class="two" style="margin-bottom:10px">
          <div><div class="sl">Total Received</div><div style="font-size:18px;font-weight:800">\${fmt(st.totalIn)}<span class="su"> kg</span></div></div>
          <div><div class="sl">Vendor Taken</div><div style="font-size:18px;font-weight:800;color:var(--r)">\${fmt(st.totalOut)}<span class="su"> kg</span></div></div>
        </div>
        <div class="sl">Current Stock</div>
        <div style="font-size:24px;font-weight:900;color:var(--g);margin-bottom:4px">\${fmt(st.currentStock)} kg</div>
        <div class="pbar"><div class="pfill" style="width:\${pct}%"></div></div>
        <div style="font-size:10px;color:var(--gr5);text-align:right">\${Math.round(pct)}% remaining</div>
      </div>
    \`;
  }).join('');

  q('#storage-list').innerHTML = html;
}

function openPickupModal(storageName, currentStock) {
  if (!CFG.storages.length) { toast('Add storage locations in Settings first'); return; }
  const preselect = storageName || CFG.storages[0];
  const info = storageName
    ? \`<div class="ok" style="margin-bottom:14px"><b>\${esc(storageName)}</b> — current stock: <b>\${fmt(currentStock)} kg</b></div>\`
    : '';

  q('#modal-body').innerHTML = \`
    <div class="mh"><div class="mt">Log Vendor Pickup</div><button class="mclose" onclick="closeModal()">×</button></div>
    \${info}
    <div id="perr" class="err hidden"></div>
    <div class="fg">
      <label>Storage Location</label>
      <select id="p-sto">\${opts(CFG.storages, preselect)}</select>
    </div>
    <div class="fg">
      <label>Weight Taken (kg)</label>
      <input type="number" id="p-wt" placeholder="e.g. 500" min="0" step="0.1" inputmode="decimal">
    </div>
    <div class="fg">
      <label>Date</label>
      <input type="date" id="p-date" value="\${todayStr()}">
    </div>
    <div class="fg">
      <label>Vendor / Notes (optional)</label>
      <input type="text" id="p-notes" placeholder="Vendor name or remarks">
    </div>
    <button class="btn btn-p" id="p-save" onclick="savePickup()">Log Pickup</button>
  \`;
  openModal();
}

async function savePickup() {
  const sto    = q('#p-sto').value;
  const wt     = parseFloat(q('#p-wt').value);
  const date   = q('#p-date').value;
  const notes  = q('#p-notes').value;
  const err    = q('#perr');

  if (!wt || wt <= 0) { err.textContent = 'Enter a valid weight'; err.classList.remove('hidden'); return; }
  setBusy('#p-save','Saving…');
  try {
    await apiPost({ action:'addStorageMovement', storageName:sto, type:'OUT', weightKG:wt, date, notes });
    closeModal(); await loadStorage(); toast('Pickup logged ✓');
  } catch {
    err.textContent = 'Failed to save. Try again.'; err.classList.remove('hidden');
    resetBusy('#p-save','Log Pickup');
  }
}

// ── DASHBOARD ────────────────────────────────────────────────
async function loadDash() {
  const month = q('#dash-month').value;
  q('#dash-content').innerHTML = '<div class="load"><div class="spin"></div>Loading…</div>';
  try {
    const d = await apiGet({ action:'getDashboard', month });
    renderDash(d, month);
  } catch {
    q('#dash-content').innerHTML = '<div class="err">Failed to load dashboard</div>';
  }
}

function renderDash(data, month) {
  if (!data.stats) {
    q('#dash-content').innerHTML = '<div class="empty"><div class="ei">📊</div>No data for this month</div>';
    return;
  }
  const s = data.stats;
  const wPct  = s.wearablePct;
  const waPct = 100 - wPct;

  let html = \`
    <div class="sgrid">
      <div class="scard"><div class="sl">Total Pickups</div><div class="sv">\${s.totalPickups}</div></div>
      <div class="scard"><div class="sl">Total Weight</div><div class="sv">\${fmt(s.totalWeight)}<span class="su"> kg</span></div></div>
      <div class="scard"><div class="sl">Avg kg / Pickup</div><div class="sv">\${fmt(s.avgKgPerPickup)}<span class="su"> kg</span></div></div>
      <div class="scard"><div class="sl">Avg Pickups / Day</div><div class="sv">\${fmt(s.avgPickupsPerDay)}</div></div>
      <div class="scard"><div class="sl">Avg Collect / Day</div><div class="sv">\${fmt(s.avgCollectionPerDay)}<span class="su"> kg</span></div></div>
      <div class="scard"><div class="sl">Active Days</div><div class="sv">\${s.activeDays}</div></div>
    </div>

    <div class="card">
      <div class="ct" style="margin-bottom:12px">Wearable vs Wastage</div>
      <div class="two" style="text-align:center;margin-bottom:8px">
        <div>
          <div style="font-size:22px;font-weight:900;color:var(--g)">\${fmt(s.totalWearable)} kg</div>
          <div style="font-size:10px;color:var(--gr5)">WEARABLE (\${wPct}%)</div>
        </div>
        <div>
          <div style="font-size:22px;font-weight:900;color:var(--r)">\${fmt(s.totalWastage)} kg</div>
          <div style="font-size:10px;color:var(--gr5)">WASTAGE (\${waPct}%)</div>
        </div>
      </div>
      <div class="ratio-bar">
        <div class="rb-g" style="width:\${wPct}%"></div>
        <div class="rb-r" style="width:\${waPct}%"></div>
      </div>
    </div>
  \`;

  if (data.regionBreakdown && data.regionBreakdown.length) {
    html += \`
      <div class="card">
        <div class="ct" style="margin-bottom:10px">By Region</div>
        <table>
          <thead><tr><th>Region</th><th>Pickups</th><th>Wearable</th><th>Wastage</th></tr></thead>
          <tbody>
            \${data.regionBreakdown.map(r => \`
              <tr>
                <td>\${esc(r.region)}</td>
                <td>\${r.pickups}</td>
                <td>\${fmt(r.wearable)} kg</td>
                <td>\${fmt(r.wastage)} kg</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    \`;
  }

  if (data.vehicleBreakdown.length) {
    html += \`
      <div class="card">
        <div class="ct" style="margin-bottom:10px">By Vehicle</div>
        <table>
          <thead><tr><th>Vehicle</th><th>Trips</th><th>Pickups</th><th>Wearable</th><th>Wastage</th></tr></thead>
          <tbody>
            \${data.vehicleBreakdown.map(v => \`
              <tr>
                <td>\${esc(v.vehicle)}</td>
                <td>\${v.trips}</td>
                <td>\${v.pickups}</td>
                <td>\${fmt(v.wearable)} kg</td>
                <td>\${fmt(v.wastage)} kg</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    \`;
  }

  if (data.dailyData.length) {
    html += \`
      <div class="card">
        <div class="ct" style="margin-bottom:10px">Daily Breakdown</div>
        <table>
          <thead><tr><th>Date</th><th>Pickups</th><th>Wearable</th><th>Wastage</th></tr></thead>
          <tbody>
            \${data.dailyData.map(d => \`
              <tr>
                <td>\${fmtDate(d.date)}</td>
                <td>\${d.pickups}</td>
                <td>\${fmt(d.wearable)} kg</td>
                <td>\${fmt(d.wastage)} kg</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    \`;
  }

  q('#dash-content').innerHTML = html;
}

// ── SETTINGS ─────────────────────────────────────────────────
function renderSettings() {
  q('#veh-list').innerHTML = CFG.vehicles.length
    ? CFG.vehicles.map(v => \`<div class="list-item">🚐 \${esc(v)}</div>\`).join('')
    : '<div style="padding:10px 0;font-size:13px;color:var(--gr5)">No vehicles added yet</div>';

  q('#sto-list').innerHTML = CFG.storages.length
    ? CFG.storages.map(s => \`<div class="list-item">🏭 \${esc(s)}</div>\`).join('')
    : '<div style="padding:10px 0;font-size:13px;color:var(--gr5)">No storage locations yet</div>';

  const regEl = q('#reg-list');
  if (regEl) {
    regEl.innerHTML = CFG.regions && CFG.regions.length
      ? CFG.regions.map(r => \`<div class="list-item">📍 \${esc(r)}</div>\`).join('')
      : '<div style="padding:10px 0;font-size:13px;color:var(--gr5)">No regions added yet</div>';
  }
}

async function saveConfig(type) {
  const name = q('#add-name').value.trim();
  if (!name) { toast('Please enter a name'); return; }
  setBusy('#add-save', 'Adding…');
  try {
    const actionMap = { vehicle:'addVehicle', storage:'addStorage', region:'addRegion' };
    await apiPost({ action: actionMap[type], name });
    await loadConfig();
    closeModal();
    renderSettings();
    const labels = { vehicle:'Vehicle added ✓', storage:'Storage location added ✓', region:'Region added ✓' };
    setTimeout(() => toast(labels[type] || 'Added ✓'), 100);
  } catch {
    resetBusy('#add-save', 'Add');
    toast('Failed to save — please try again');
  }
}

function openAddModal(type) {
  const labels = { vehicle:'Vehicle Name', storage:'Location Name', region:'Region Name' };
  const phs    = { vehicle:'e.g. Vehicle 1 / KA01AB1234', storage:'e.g. Warehouse A / Shop 1', region:'e.g. North / South / HSR Layout' };
  const titles = { vehicle:'Add Vehicle', storage:'Add Storage Location', region:'Add Region' };

  q('#modal-body').innerHTML = \`
    <div class="mh"><div class="mt">\${titles[type]}</div><button class="mclose" onclick="closeModal()">×</button></div>
    <div class="fg">
      <label>\${labels[type]}</label>
      <input type="text" id="add-name" placeholder="\${phs[type]}">
    </div>
    <button class="btn btn-p" id="add-save" onclick="saveConfig('\${type}')">Add</button>
  \`;
  openModal();
  setTimeout(() => q('#add-name').focus(), 100);
}
function openModal()  { q('#backdrop').classList.remove('hidden'); }
function closeModal() { q('#backdrop').classList.add('hidden'); }
function tryClose(e)  { if (e.target === q('#backdrop')) closeModal(); }

// ── UTILS ─────────────────────────────────────────────────────
function q(sel)      { return document.querySelector(sel); }
function qAll(sel)   { return document.querySelectorAll(sel); }
function show(id)    { document.getElementById(id).classList.remove('hidden'); }
function hide(id)    { document.getElementById(id).classList.add('hidden'); }
function todayStr()  { return new Date().toLocaleDateString('en-CA'); } // YYYY-MM-DD
function fmt(n)      { return (Math.round(n*10)/10).toLocaleString('en-IN'); }
function esc(s)      { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function opts(arr, selected='') {
  return arr.map(v => \`<option value="\${esc(v)}" \${v===selected?'selected':''}>\${esc(v)}</option>\`).join('');
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}
function setBusy(sel, txt)   { const b=q(sel); b.textContent=txt; b.disabled=true; }
function resetBusy(sel, txt) { const b=q(sel); b.textContent=txt; b.disabled=false; }
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2700);
}
</script>
</body>
</html>`;
}
