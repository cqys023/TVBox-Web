/**
 * Cloudflare Worker - Meow / TVBox 多资源站影视播放器
 * 部署：将本文件完整复制到 Cloudflare Workers 编辑器。
 * 可选环境变量：
 *   CONFIG_URL            默认 Meow JSON 地址
 *   ALLOWED_CONFIG_HOSTS  允许读取配置 JSON 的域名，逗号分隔；默认 raw.githubusercontent.com
 *   ALLOWED_PROXY_HOSTS   额外允许代理的公开域名，逗号分隔（用于自定义配置/媒体域名）
 */

const DEFAULT_CONFIG_URL = 'https://raw.githubusercontent.com/anaer/Meow/main/meow.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.searchParams.has('proxy')) {
      return handleProxy(url, env);
    }

    return new Response(HTML, {
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      }
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400'
  };
}

function hostList(value, fallback = []) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values.map(v => String(v).trim().toLowerCase()).filter(Boolean);
}

function isPublicHttpUrl(value) {
  let u;
  try { u = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  if (/^\[?(fc|fd|fe80):/i.test(h)) return false;
  return true;
}

async function handleProxy(requestUrl, env) {
  const target = requestUrl.searchParams.get('proxy');
  const configUrl = requestUrl.searchParams.get('config') || env.CONFIG_URL || DEFAULT_CONFIG_URL;
  if (!target || !isPublicHttpUrl(target)) {
    return jsonResponse({ error: '无效或不允许的代理地址' }, 400);
  }

  let targetUrl, config;
  try {
    targetUrl = new URL(target);
    const configHosts = hostList(env.ALLOWED_CONFIG_HOSTS || 'raw.githubusercontent.com');
    const extraHosts = hostList(env.ALLOWED_PROXY_HOSTS || '');
    const configIsAllowed = isPublicHttpUrl(configUrl) && configHosts.includes(new URL(configUrl).hostname.toLowerCase());
    if (!configIsAllowed) {
      return jsonResponse({ error: '配置文件域名未加入 ALLOWED_CONFIG_HOSTS' }, 403);
    }

    const configHost = new URL(configUrl).hostname.toLowerCase();
    let allowed = targetUrl.hostname.toLowerCase() === configHost || extraHosts.includes(targetUrl.hostname.toLowerCase());

    if (!allowed) {
      const cfgRes = await fetch(configUrl, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, redirect: 'follow' });
      if (!cfgRes.ok) return jsonResponse({ error: '资源站配置读取失败', status: cfgRes.status }, 502);
      config = await cfgRes.json();
      const sites = Array.isArray(config.sites) ? config.sites : [];
      allowed = sites.some(site => {
        try { return site.api && new URL(normalizeApi(site.api)).hostname.toLowerCase() === targetUrl.hostname.toLowerCase(); }
        catch { return false; }
      });
    }

    if (!allowed) return jsonResponse({ error: '目标域名不在配置资源站白名单中', host: targetUrl.hostname }, 403);

    const upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': requestUrl.searchParams.get('accept') || '*/*'
      },
      redirect: 'follow'
    });
    const headers = new Headers(upstream.headers);
    for (const h of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) headers.delete(h);
    Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return jsonResponse({ error: '代理请求失败', detail: String(error?.message || error) }, 502);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...corsHeaders() }
  });
}

function normalizeApi(api) {
  let value = String(api || '').trim();
  if (value.startsWith('//')) value = 'https:' + value;
  else if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  return value;
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meow TVBox 多资源站播放器</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/lucide@latest"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>tailwind.config={darkMode:'class',theme:{extend:{colors:{brand:{500:'#6366f1',600:'#4f46e5',accent:'#06b6d4'}}}}};</script>
<style>
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(15,23,42,.6)}::-webkit-scrollbar-thumb{background:rgba(99,102,241,.4);border-radius:4px}
.glass-panel{background:rgba(15,23,42,.88);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08)}
.glass-card{background:rgba(30,41,59,.6);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.05);transition:all .25s ease}
.glass-card:hover{background:rgba(49,46,129,.45);border-color:rgba(99,102,241,.4);transform:translateY(-2px)}
.cat-btn{white-space:nowrap}.line-clamp-4{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
</style>
</head>
<body class="bg-slate-950 text-slate-100 font-sans min-h-screen flex flex-col overflow-x-hidden">
<header class="min-h-16 border-b border-slate-800/80 glass-panel sticky top-0 z-40 flex items-center justify-between gap-3 px-4 lg:px-8 py-2">
 <div class="flex items-center gap-3 shrink-0"><div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center"><i data-lucide="tv" class="w-5 h-5 text-white"></i></div><div><h1 class="font-bold text-base md:text-lg">TVBox Web </h1><p class="text-[11px] text-slate-400">Meow 多资源站聚合浏览</p></div></div>
 <div class="flex items-center gap-2 min-w-0">
  <button id="openHistoryBtn" class="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs border border-slate-700/80 shrink-0">历史</button>
  <div class="flex items-center gap-2 bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 min-w-0"><i data-lucide="server" class="w-4 h-4 text-indigo-400 shrink-0"></i><span class="text-xs text-slate-400 hidden sm:inline">资源站：</span><select id="siteSelect" class="bg-transparent text-xs text-slate-100 font-medium focus:outline-none max-w-[145px] md:max-w-[230px]"><option>正在加载…</option></select></div>
  <button id="openConfigBtn" class="px-3 py-2 rounded-xl bg-indigo-600/20 text-indigo-300 text-xs border border-indigo-500/30">配置</button>
 </div>
</header>
<main id="homeView" class="flex-1 flex flex-col p-4 md:p-8 max-w-7xl mx-auto w-full gap-6">
 <section class="glass-panel p-4 rounded-2xl flex flex-col md:flex-row items-start justify-between gap-4"><div id="categoryTabs" class="flex flex-wrap items-center gap-2 w-full md:flex-1 min-w-0 pb-1 text-xs overflow-visible"><span class="text-slate-500">正在读取分类…</span></div><div class="flex items-center gap-2 w-full md:w-80 shrink-0"><input id="searchInput" type="text" placeholder="搜索片名、演员…" class="min-w-0 flex-1 px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-700 text-slate-200"><button id="searchBtn" class="px-4 py-2 bg-indigo-600 text-white text-xs rounded-xl">搜索</button></div></section>
 <section id="vodGrid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"><div class="col-span-full text-center text-xs text-slate-500 py-20">正在加载资源站…</div></section>
 <footer class="flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-slate-800"><span id="currentSiteLabel">当前源：未选择</span><span id="vodCountLabel">共 0 部影片</span></footer>
</main>
<div id="detailView" class="fixed inset-0 bg-slate-950 z-50 overflow-y-auto hidden">
 <div class="h-14 border-b border-slate-800 glass-panel sticky top-0 z-10 flex items-center justify-between px-4"><button id="backToHomeBtn" class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs">← 返回首页</button><div id="detailHeaderTitle" class="text-xs text-slate-400 truncate max-w-[55%]">影片详情</div><span class="w-16"></span></div>
 <div class="max-w-6xl mx-auto w-full p-4 md:p-8 flex flex-col gap-6">
  <div class="w-full bg-black rounded-2xl overflow-hidden border border-slate-800 relative">
   <div class="aspect-video max-h-[75vh] flex items-center justify-center"><video id="videoPlayer" class="w-full h-full object-contain" controls playsinline webkit-playsinline crossorigin="anonymous"></video></div>
   <div id="playerSpinner" class="hidden absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-3"><div class="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div><span id="spinnerText" class="text-xs text-indigo-300">正在加载…</span></div>
  </div>
  <div class="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-2">
   <div class="flex flex-wrap gap-2">
    <button id="webPlayBtn" type="button" disabled class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold">网页播放</button>
    <button id="vlcPlayBtn" type="button" disabled class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-semibold">使用 VLC 播放</button>
   </div>
   <p id="playerStatus" class="text-[11px] text-slate-400 min-h-4" aria-live="polite">请选择线路和集数，然后点击网页播放或使用 VLC 播放</p>
  </div>
  <div class="glass-panel rounded-2xl p-5 md:p-6 flex flex-col gap-6"><div class="flex flex-col md:flex-row gap-5"><img id="detailPoster" src="" class="w-32 md:w-40 aspect-[3/4] object-cover rounded-xl border border-slate-700" alt="海报"><div class="flex flex-col gap-2 min-w-0 flex-1"><h2 id="detailTitle" class="text-xl md:text-2xl font-bold">影片名称</h2><div id="detailMeta" class="flex flex-wrap gap-2 text-xs text-slate-400"></div><p id="detailDesc" class="text-xs text-slate-400 leading-relaxed line-clamp-4 mt-2">简介加载中…</p></div></div>
  <div class="border-t border-slate-800 pt-4 flex flex-col gap-3"><span class="text-xs font-semibold text-slate-400">切换线路</span><div id="routeTabs" class="flex flex-wrap gap-2 text-xs"></div></div><div class="flex flex-col gap-3"><span class="text-xs font-semibold text-slate-400">剧集选集</span><div id="episodeGrid" class="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2.5 max-h-60 overflow-y-auto p-1"></div></div></div>
 </div>
</div>
<div id="historyModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[60] flex items-center justify-center p-4 hidden">
 <div class="glass-panel w-full max-w-2xl rounded-2xl p-6 flex flex-col gap-4 max-h-[85vh]">
  <div class="flex items-center justify-between pb-3 border-b border-slate-800">
   <div class="flex items-center gap-2"><i data-lucide="history" class="w-5 h-5 text-indigo-400"></i><h3 class="font-semibold text-slate-200 text-sm">观看历史记录</h3></div>
   <div class="flex items-center gap-2"><button id="clearHistoryBtn" class="text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20">清空历史</button><button id="closeHistoryBtn" class="text-xs text-slate-400 hover:text-slate-200 px-2 py-1">关闭</button></div>
  </div>
  <div id="historyList" class="flex flex-col gap-2.5 overflow-y-auto flex-1 pr-1"></div>
 </div>
</div>
<div id="configModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[60] flex items-center justify-center p-4 hidden"><div class="glass-panel w-full max-w-lg rounded-2xl p-6 flex flex-col gap-4"><h3 class="font-semibold text-slate-200 text-sm">Meow / TVBox 配置 JSON 地址</h3><input id="jsonUrlInput" class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs" type="url"><p class="text-[11px] text-slate-500">配置文件需包含 sites 数组，每个站点需提供 api。自定义配置域名需加入 Worker 环境变量 ALLOWED_CONFIG_HOSTS。</p><div class="flex justify-end gap-2 text-xs"><button id="closeConfigBtn" class="px-4 py-2 rounded-lg bg-slate-800">取消</button><button id="saveConfigBtn" class="px-4 py-2 rounded-lg bg-indigo-600">加载配置</button></div></div></div>
<script>
const DEFAULT_CONFIG_URL = 'https://raw.githubusercontent.com/anaer/Meow/main/meow.json';
const state = {
  configUrl: DEFAULT_CONFIG_URL,
  sites: [],
  currentSite: null,
  hlsPlayer: null,
  requestSeq: 0,
  currentVodId: null,
  categoryCache: new Map(),
  currentPlayUrl: '',
  playRequestSeq: 0,
  currentDetail: null,
  currentEpName: '',
  pendingSeekTime: 0
};
const el = Object.fromEntries(['homeView','detailView','siteSelect','vodGrid','categoryTabs','searchInput','searchBtn','videoPlayer','playerSpinner','spinnerText','webPlayBtn','vlcPlayBtn','playerStatus','detailHeaderTitle','detailTitle','detailMeta','detailDesc','detailPoster','routeTabs','episodeGrid','backToHomeBtn','currentSiteLabel','vodCountLabel','configModal','openConfigBtn','closeConfigBtn','saveConfigBtn','jsonUrlInput','historyModal','openHistoryBtn','closeHistoryBtn','clearHistoryBtn','historyList'].map(id=>[id,document.getElementById(id)]));

window.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  el.jsonUrlInput.value = state.configUrl;
  initEvents();
  loadTVBoxConfig(state.configUrl);
});

function initEvents() {
  el.openConfigBtn.onclick = () => el.configModal.classList.remove('hidden');
  el.closeConfigBtn.onclick = () => el.configModal.classList.add('hidden');
  el.saveConfigBtn.onclick = () => {
    const value = el.jsonUrlInput.value.trim();
    if (!/^https?:\\/\\//i.test(value)) { alert('请输入有效的 http/https 配置地址'); return; }
    el.configModal.classList.add('hidden');
    loadTVBoxConfig(value);
  };
  
  el.openHistoryBtn.onclick = () => { renderHistoryList(); el.historyModal.classList.remove('hidden'); };
  el.closeHistoryBtn.onclick = () => el.historyModal.classList.add('hidden');
  el.clearHistoryBtn.onclick = () => {
    if (confirm('确定要清空所有观看历史吗？')) {
      localStorage.removeItem('meow_watch_history');
      renderHistoryList();
    }
  };

  el.siteSelect.onchange = () => { const site = state.sites[Number(el.siteSelect.value)]; if (site) switchSite(site); };
  el.searchBtn.onclick = search;
  el.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  el.backToHomeBtn.onclick = closeDetailView;
  el.webPlayBtn.onclick = playInWeb;
  el.vlcPlayBtn.onclick = playInVLC;
  
  el.videoPlayer.addEventListener('playing', () => setPlayerStatus('正在使用网页播放器播放'));
  el.videoPlayer.addEventListener('waiting', () => { el.playerSpinner.classList.remove('hidden'); el.spinnerText.textContent = '视频缓冲中…'; });
  el.videoPlayer.addEventListener('canplay', () => {
    el.playerSpinner.classList.add('hidden');
    if (state.pendingSeekTime > 0) {
      el.videoPlayer.currentTime = state.pendingSeekTime;
      state.pendingSeekTime = 0;
    }
  });
  el.videoPlayer.addEventListener('timeupdate', saveCurrentProgress);
  el.videoPlayer.addEventListener('error', () => { el.playerSpinner.classList.add('hidden'); if (state.currentPlayUrl) setPlayerStatus('网页播放器加载失败，可尝试 VLC 或切换线路'); });
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem('meow_watch_history') || '[]'); } catch { return []; }
}
function saveHistoryItem(vod, epName, time = 0) {
  if (!vod || !state.currentSite) return;
  const list = getHistory();
  const index = list.findIndex(item => item.siteApi === state.currentSite.api && String(item.vodId) === String(vod.vod_id));
  const record = {
    siteApi: state.currentSite.api,
    siteName: state.currentSite.name,
    vodId: vod.vod_id,
    vodName: vod.vod_name || '未知影片',
    vodPic: vod.vod_pic || '',
    epName: epName || '第一集',
    time: Math.floor(time),
    updatedAt: Date.now()
  };
  if (index !== -1) list.splice(index, 1);
  list.unshift(record);
  if (list.length > 50) list.pop();
  localStorage.setItem('meow_watch_history', JSON.stringify(list));
}
function saveCurrentProgress() {
  if (state.currentDetail && el.videoPlayer.currentTime > 0) {
    saveHistoryItem(state.currentDetail, state.currentEpName, el.videoPlayer.currentTime);
  }
}
function formatTime(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}
function renderHistoryList() {
  const history = getHistory();
  el.historyList.innerHTML = '';
  if (!history.length) {
    el.historyList.innerHTML = '<div class="text-center text-xs text-slate-500 py-12">暂无播放记录</div>';
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'glass-card p-3 rounded-xl flex items-center justify-between gap-3 cursor-pointer';
    div.onclick = () => {
      el.historyModal.classList.add('hidden');
      const targetSite = state.sites.find(s => s.api === item.siteApi);
      if (targetSite) {
        if (state.currentSite !== targetSite) switchSite(targetSite);
        openDetailView(item.vodId, item.epName, item.time);
      } else {
        alert('对应的资源站未在当前配置中提供，无法继续观看');
      }
    };
    div.innerHTML = '<img src="' + escapeHtml(item.vodPic) + '" class="w-12 h-16 object-cover rounded-lg bg-slate-900 border border-slate-700/50 shrink-0" onerror="this.src=\\'https://placehold.co/300x400/1e293b/6366f1?text=No+Cover\\'"><div class="flex-1 min-w-0"><h4 class="text-xs font-semibold truncate text-slate-100">' + escapeHtml(item.vodName) + '</h4><p class="text-[11px] text-indigo-400 mt-1">' + escapeHtml(item.epName) + ' <span class="text-slate-500 ml-1">看至 ' + formatTime(item.time) + '</span></p><p class="text-[10px] text-slate-500 mt-0.5">源: ' + escapeHtml(item.siteName) + '</p></div><button class="px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 text-xs shrink-0 hover:bg-indigo-600 hover:text-white transition">播放</button>';
    el.historyList.appendChild(div);
  });
}

function proxyUrl(target){return location.origin+'/?proxy='+encodeURIComponent(target)+'&config='+encodeURIComponent(state.configUrl)}
function normalizeApi(api){let s=String(api||'').trim();if(s.startsWith('//'))s='https:'+s;else if(!/^https?:\\/\\//i.test(s))s='https://'+s;return s}
function buildApiUrl(site,params={}){const u=new URL(normalizeApi(site.api));for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));return u.toString()}
async function proxyJson(url){const r=await fetch(proxyUrl(url));if(!r.ok){let msg='HTTP '+r.status;try{const j=await r.json();msg=j.error||msg}catch{}throw new Error(msg)}return r.json()}

async function loadTVBoxConfig(url){
  state.configUrl=url;el.jsonUrlInput.value=url;state.sites=[];state.currentSite=null;state.categoryCache.clear();
  el.vodGrid.innerHTML='<div class="col-span-full text-center text-xs text-indigo-400 py-20">正在读取 Meow 资源站配置…</div>';
  el.categoryTabs.innerHTML='';el.siteSelect.innerHTML='<option>加载中…</option>';
  try{
    const config=await proxyJson(url);
    if(!config||!Array.isArray(config.sites))throw new Error('配置 JSON 中没有 sites 数组');
    state.sites=config.sites.filter(s=>s&&s.api).map((s,i)=>({...s,name:s.name||('资源站 '+(i+1)),api:normalizeApi(s.api)}));
    if(!state.sites.length)throw new Error('sites 中没有可用的影视资源站');
    renderSiteOptions();switchSite(state.sites[0]);
  }catch(err){
    el.vodGrid.innerHTML='<div class="col-span-full text-center text-xs text-rose-400 py-20">配置加载失败：'+escapeHtml(err.message)+'</div>';
    el.siteSelect.innerHTML='<option>配置加载失败</option>';
  }
}
function renderSiteOptions(){el.siteSelect.innerHTML='';state.sites.forEach((site,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=site.name;el.siteSelect.appendChild(opt)});}
function switchSite(site){state.currentSite=site;const idx=state.sites.indexOf(site);el.siteSelect.value=String(idx);el.currentSiteLabel.textContent='当前源：'+site.name;el.categoryTabs.innerHTML='<span class="text-slate-500 text-xs">正在读取该资源站分类…</span>';fetchVodList(site,{},true)}
function search(){const q=el.searchInput.value.trim();if(q&&state.currentSite)fetchVodList(state.currentSite,{wd:q})}
function extractClasses(data){
  const root=data&&data.data&&typeof data.data==='object'?data.data:data;
  const arr=Array.isArray(data?.class)?data.class:(Array.isArray(root?.class)?root.class:(Array.isArray(data?.categories)?data.categories:(Array.isArray(root?.categories)?root.categories:[])));
  return arr.filter(c=>c&&c.type_id!==undefined&&c.type_name);
}
async function fetchVodList(site,params={},reloadClasses=false){
  const seq=++state.requestSeq;
  el.vodGrid.innerHTML='<div class="col-span-full text-center text-xs text-indigo-400 py-20">正在获取 '+escapeHtml(site.name)+' 影片列表…</div>';
  try{
    let classes=state.categoryCache.get(site.api);
    if(reloadClasses||!classes){
      try{
        const categoryData=await proxyJson(buildApiUrl(site,{}));
        classes=extractClasses(categoryData);
        if(!classes.length){
          const fallbackData=await proxyJson(buildApiUrl(site,{ac:'list'}));
          classes=extractClasses(fallbackData);
        }
        state.categoryCache.set(site.api,classes);
      }catch(categoryError){
        console.warn('读取资源站分类失败：',site.name,categoryError);
        classes=[];
      }
    }
    if(seq!==state.requestSeq)return;
    renderCategories(classes||[]);
    const data=await proxyJson(buildApiUrl(site,{ac:'videolist',...params}));
    if(seq!==state.requestSeq)return;
    const root=data&&data.data&&typeof data.data==='object'?data.data:data;
    const list=Array.isArray(data?.list)?data.list:(Array.isArray(root?.list)?root.list:[]);
    const listClasses=extractClasses(data);
    if(listClasses.length){state.categoryCache.set(site.api,listClasses);renderCategories(listClasses)}
    renderVodGrid(list);
  }catch(err){
    if(seq!==state.requestSeq)return;
    el.vodGrid.innerHTML='<div class="col-span-full text-center text-xs text-amber-400 py-20">资源站请求失败：'+escapeHtml(err.message)+'</div>';
  }
}
function renderCategories(items){
  el.categoryTabs.innerHTML='';const all=makeCatButton('最新推荐',true,()=>fetchVodList(state.currentSite));el.categoryTabs.appendChild(all);
  items.forEach(c=>{if(!c||c.type_id===undefined||!c.type_name)return;const b=makeCatButton(c.type_name,false,()=>fetchVodList(state.currentSite,{t:c.type_id}));el.categoryTabs.appendChild(b)});
  if(!items.length){const hint=document.createElement('span');hint.className='text-[11px] text-amber-400 shrink-0';hint.textContent='该资源站接口未返回分类（仅显示最新推荐）';el.categoryTabs.appendChild(hint)}
}
function makeCatButton(label,active,fn){const b=document.createElement('button');b.className='cat-btn px-4 py-2 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap border '+(active?'bg-indigo-600 text-white border-indigo-500':'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800');b.textContent=label;b.onclick=()=>{el.categoryTabs.querySelectorAll('button').forEach(x=>x.className='cat-btn px-4 py-2 rounded-xl text-xs font-medium shrink-0 border bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800');b.className='cat-btn px-4 py-2 rounded-xl text-xs font-medium shrink-0 border bg-indigo-600 text-white border-indigo-500';fn()};return b}
function renderVodGrid(list){
  el.vodGrid.innerHTML='';el.vodCountLabel.textContent='共 '+list.length+' 部影片';
  if(!list.length){el.vodGrid.innerHTML='<div class="col-span-full text-center text-xs text-slate-500 py-20">该分类暂无影片</div>';return}
  list.forEach(vod=>{
    const card=document.createElement('button');card.type='button';card.className='glass-card text-left rounded-2xl overflow-hidden cursor-pointer flex flex-col group shadow-md';
    const pic=vod.vod_pic||'';
    const wrap=document.createElement('div');wrap.className='relative w-full aspect-[3/4] overflow-hidden bg-slate-900';
    const img=document.createElement('img');img.src=pic;img.alt=vod.vod_name||'影片';img.loading='lazy';img.className='w-full h-full object-cover group-hover:scale-105 transition duration-300';
    img.onerror=()=>{img.src='https://placehold.co/300x400/1e293b/6366f1?text=No+Cover'};
    wrap.appendChild(img);
    const remark=vod.vod_remarks||vod.vod_delay;
    if(remark){const badge=document.createElement('span');badge.className='absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-lg bg-slate-950/80 text-cyan-400';badge.textContent=remark;wrap.appendChild(badge)}
    const body=document.createElement('div');body.className='p-3';
    const title=document.createElement('h4');title.className='text-xs font-semibold truncate';title.textContent=vod.vod_name||'未命名影片';
    const sub=document.createElement('p');sub.className='text-[11px] text-slate-400 truncate mt-1';sub.textContent=vod.type_name||'全分类';
    body.append(title,sub);card.append(wrap,body);
    card.onclick=()=>openDetailView(vod.vod_id);
    el.vodGrid.appendChild(card);
  });
}

async function openDetailView(vodId, targetEpName = null, seekTime = 0){
  if(!state.currentSite||vodId===undefined)return;
  state.currentVodId=vodId;
  state.pendingSeekTime = seekTime || 0;
  el.detailView.classList.remove('hidden');
  document.body.style.overflow='hidden';
  el.playerSpinner.classList.remove('hidden');
  el.spinnerText.textContent='正在加载影片详情…';
  el.detailTitle.textContent='正在加载…';
  el.routeTabs.innerHTML='';
  el.episodeGrid.innerHTML='';
  try{
    const data=await proxyJson(buildApiUrl(state.currentSite,{ac:'detail',ids:vodId}));
    const root=data.data&&typeof data.data==='object'?data.data:data;
    const list=Array.isArray(data.list)?data.list:root.list;
    if(!Array.isArray(list)||!list.length)throw new Error('接口没有返回影片详情');
    const d=list[0];
    state.currentDetail = d;
    el.detailHeaderTitle.textContent=d.vod_name||'影片详情';
    el.detailTitle.textContent=d.vod_name||'未知影片';
    el.detailMeta.innerHTML='';
    [d.type_name,d.vod_year,d.vod_area,d.vod_remarks].filter(Boolean).forEach(v=>{const s=document.createElement('span');s.className='px-2 py-1 rounded bg-indigo-500/10 text-indigo-300';s.textContent=v;el.detailMeta.appendChild(s)});
    el.detailDesc.textContent=String(d.vod_content||'暂无剧情简介').replace(/<[^>]*>/g,'');
    el.detailPoster.src=d.vod_pic||'https://placehold.co/300x400/1e293b/6366f1?text=No+Cover';
    el.detailPoster.onerror=()=>{el.detailPoster.src='https://placehold.co/300x400/1e293b/6366f1?text=No+Cover'};
    parsePlayRoutes(d, targetEpName);
  }catch(err){alert('无法加载影片详情：'+err.message)}finally{el.playerSpinner.classList.add('hidden')}
}

function setPlayerStatus(message){el.playerStatus.textContent=message}
function resetPlayer(){
  state.currentPlayUrl='';state.playRequestSeq++;
  if(state.hlsPlayer){state.hlsPlayer.destroy();state.hlsPlayer=null}
  const video=el.videoPlayer;video.pause();video.removeAttribute('src');video.load();
  video.onerror=null;video.onloadeddata=null;
  el.webPlayBtn.disabled=true;el.vlcPlayBtn.disabled=true;el.playerSpinner.classList.add('hidden');
  setPlayerStatus('请选择线路和集数，然后点击网页播放或使用 VLC 播放');
}
function closeDetailView(){
  saveCurrentProgress();
  state.currentDetail = null;
  el.detailView.classList.add('hidden');
  document.body.style.overflow='';
  resetPlayer();
}

function parsePlayRoutes(detail, targetEpName = null){
  const froms=String(detail.vod_play_from||'').split('$$$');
  const urls=String(detail.vod_play_url||'').split('$$$');
  el.routeTabs.innerHTML='';el.episodeGrid.innerHTML='';resetPlayer();
  froms.forEach((name,i)=>{
    const b=document.createElement('button');
    b.className='px-3.5 py-1.5 rounded-xl border text-xs '+(i===0?'bg-indigo-600 text-white border-indigo-500':'bg-slate-900 text-slate-300 border-slate-700');
    b.textContent=name||('线路 '+(i+1));
    b.onclick=()=>{
      el.routeTabs.querySelectorAll('button').forEach(x=>x.className='px-3.5 py-1.5 rounded-xl border text-xs bg-slate-900 text-slate-300 border-slate-700');
      b.className='px-3.5 py-1.5 rounded-xl border text-xs bg-indigo-600 text-white border-indigo-500';
      renderEpisodes(urls[i], targetEpName);
    };
    el.routeTabs.appendChild(b);
  });
  if(urls.length) renderEpisodes(urls[0], targetEpName);
}

function renderEpisodes(raw, targetEpName = null){
  el.episodeGrid.innerHTML='';resetPlayer();if(!raw)return;
  const eps=raw.split('#').filter(Boolean);
  let targetBtn = null;
  let targetUrl = '';
  let targetName = '';

  eps.forEach((ep,i)=>{
    const p=ep.split('$');
    const name=p.length>1?p[0]:'第 '+(i+1)+' 集';
    const url=p.length>1?p.slice(1).join('$'):p[0];
    const b=document.createElement('button');
    b.className='ep-btn px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs truncate';
    b.textContent=name;
    b.onclick=()=>{
      el.episodeGrid.querySelectorAll('button').forEach(x=>x.classList.remove('border-indigo-500','text-indigo-400','bg-indigo-950/40'));
      b.classList.add('border-indigo-500','text-indigo-400','bg-indigo-950/40');
      state.currentEpName = name;
      playVideo(url);
    };
    el.episodeGrid.appendChild(b);

    if (targetEpName && name === targetEpName) {
      targetBtn = b;
      targetUrl = url;
      targetName = name;
    }
  });

  if (!targetBtn && eps.length) {
    const first=eps[0].split('$');
    targetUrl=first.length>1?first.slice(1).join('$'):first[0];
    targetName=first.length>1?first[0]:'第 1 集';
    targetBtn=el.episodeGrid.querySelector('button');
  }

  if (targetBtn) {
    targetBtn.classList.add('border-indigo-500','text-indigo-400','bg-indigo-950/40');
    state.currentEpName = targetName;
    playVideo(targetUrl);
  }
}

function playVideo(url){
  const source=String(url||'').trim();resetPlayer();
  if(!/^https?:\\/\\//i.test(source)){setPlayerStatus('当前剧集没有有效的 HTTP/HTTPS 播放地址');return}
  state.currentPlayUrl=source;const requestId=++state.playRequestSeq;const video=el.videoPlayer;
  el.webPlayBtn.disabled=false;el.vlcPlayBtn.disabled=false;setPlayerStatus('已获取当前剧集地址，可点击“网页播放”或“使用 VLC 播放”');
  el.playerSpinner.classList.remove('hidden');el.spinnerText.textContent='正在准备视频流…';
  saveHistoryItem(state.currentDetail, state.currentEpName, state.pendingSeekTime || 0);

  const isHls=/\\.m3u8(?:$|[?#])/i.test(source);
  if(isHls&&video.canPlayType('application/vnd.apple.mpegurl')){
   video.src=source;video.load();video.onloadedmetadata=()=>{if(requestId!==state.playRequestSeq)return;el.playerSpinner.classList.add('hidden');setPlayerStatus('视频地址已就绪，点击网页播放开始播放')};
  }else if(isHls&&window.Hls&&Hls.isSupported()){
   const h=new Hls({enableWorker:true});state.hlsPlayer=h;h.loadSource(source);h.attachMedia(video);
   h.on(Hls.Events.MANIFEST_PARSED,()=>{if(requestId!==state.playRequestSeq)return;el.playerSpinner.classList.add('hidden');setPlayerStatus('视频地址已就绪，点击网页播放开始播放')});
   h.on(Hls.Events.ERROR,(_event,data)=>{if(requestId!==state.playRequestSeq||!data?.fatal)return;el.playerSpinner.classList.add('hidden');setPlayerStatus('网页播放器加载失败，可尝试 VLC 或切换线路')});
  }else{
   video.src=source;video.load();video.onloadedmetadata=()=>{if(requestId!==state.playRequestSeq)return;el.playerSpinner.classList.add('hidden');setPlayerStatus('视频地址已就绪，点击网页播放开始播放')};
  }
}

function playInWeb(){
  if(!state.currentPlayUrl){setPlayerStatus('请先选择线路和剧集');return}
  el.videoPlayer.play().then(()=>setPlayerStatus('正在使用网页播放器播放')).catch(()=>setPlayerStatus('网页播放未能启动，请检查视频地址或尝试 VLC'));
}
function playInVLC(){
  if(!state.currentPlayUrl){setPlayerStatus('请先选择线路和剧集');return}
  const vlcUrl='vlc-x-callback://x-callback-url/stream?url='+encodeURIComponent(state.currentPlayUrl);
  setPlayerStatus('正在尝试打开 VLC…');window.location.href=vlcUrl;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
</script>
</body></html>`;
