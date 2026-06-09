// ==UserScript==
// @name         glm_bypass
// @namespace    https://github.com/langbyyi/GLM_bypass
// @version      1.0.0
// @description  极致抢购助手 - 并发重试+验证码自动识别+直接锁单+时钟校准+反检测+Vue Hacking+多标签协同+登录兼容
// @author       glm_bypass
// @updateURL    https://raw.githubusercontent.com/langbyyi/GLM_bypass/master/glm_bypass.user.js
// @downloadURL  https://raw.githubusercontent.com/langbyyi/GLM_bypass/master/glm_bypass.user.js
// @match        *://open.bigmodel.cn/*
// @match        *://www.bigmodel.cn/*
// @match        *://bigmodel.cn/*
// @match        *://*.gtimg.com/*
// @match        *://*.captcha.qcloud.com/*
// @match        *://*.captcha.qq.com/*
// @match        *://*.qq.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      127.0.0.1
// @connect      localhost
// @connect      127.0.0.1:8888
// @connect      localhost:8888
// @connect      gtimg.com
// @connect      *.gtimg.com
// @connect      captcha.qcloud.com
// @connect      *.captcha.qcloud.com
// @connect      captcha.qq.com
// @connect      *.captcha.qq.com
// @connect      turing.captcha.qcloud.com
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  //  1. 环境检测 (Iframe 模式 还是 主窗口 模式)
  // ═══════════════════════════════════════════════════════════════════
  const _host = (() => { try { return location.hostname || ''; } catch { return ''; } })();
  const inCaptchaFrame = _host.includes('gtimg.com') || _host.includes('captcha.qcloud.com') || _host.includes('captcha.qq.com') || _host.includes('tcaptcha.qq.com');

  if (inCaptchaFrame) {
    initCaptchaSolver();
    return;
  }

  // 既不是验证码 iframe，又不是大模型网站，则彻底退出，防污染其他 matched 域（如 qq.com）
  if (!_host.includes('bigmodel.cn')) {
    return;
  }

  // 接收来自验证码 iframe 的跨域日志
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'GLM_BYPASS_CAPTCHA_LOG') {
      log(e.data.msg);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  2. 验证码自动识别与模拟点击 (iframe 内部执行)
  // ═══════════════════════════════════════════════════════════════════
  function initCaptchaSolver() {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const log = (msg) => {
      console.log('%c[CaptchaSolver] ' + msg, 'color:#fdcb6e');
      try {
        window.top.postMessage({
          type: 'GLM_BYPASS_CAPTCHA_LOG',
          msg: `[验证码] ${msg}`
        }, '*');
      } catch (e) {}
    };

    log('验证码 iframe 注入成功，开始监控...');

    function getOcrUrl() {
      try { return GM_getValue('glm_bypass_captcha_server', 'http://127.0.0.1:8888'); } 
      catch (e) { return 'http://127.0.0.1:8888'; }
    }

    function visible(el) {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function bgUrlFrom(el) {
      if (!el) return '';
      const img = el.tagName === 'IMG' ? el : el.querySelector('img');
      if (img && img.src) {
        return img.src;
      }
      const text = (el.style && el.style.backgroundImage ? el.style.backgroundImage : '') || getComputedStyle(el).backgroundImage || '';
      const match = text.match(/url\(["']?([^"')]+)["']?\)/);
      if (!match) return '';
      try { return new URL(match[1], location.href).href; } 
      catch { return match[1]; }
    }

    function findBgElement() {
      const selectors = [
        '#slideBg',
        '.tencent-captcha-dy__verify-bg-img',
        '[class*="verify-bg"]',
        '.tencent-captcha-dy__bg-img',
        '.tencent-captcha-dy__image-area',
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (visible(el) && bgUrlFrom(el)) return el;
      }
      return null;
    }

    function findPromptText() {
      const selectors = [
        '#instructionText',
        '.tencent-captcha-dy__header-text',
        '.tencent-captcha-dy__header-title-wrap .tencent-captcha-dy__header-text',
        '[class*="header-text"]',
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!visible(el)) continue;
        const raw = (el.textContent || el.getAttribute('aria-label') || '').trim();
        const cleaned = raw
          .replace(/^\s*\u8BF7\u4F9D\u6B21\u70B9\u51FB[:\uff1a]?\s*/, '') 
          .replace(/\s+/g, '');
        const chars = (cleaned.match(/[\u4e00-\u9fff]/g) || []).slice(-3); 
        if (chars.length >= 3) return chars.join('');
      }
      return '';
    }

    function fetchImageDataUrl(url) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
          GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            responseType: 'blob',
            onload: (res) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('FileReader 失败'));
              reader.readAsDataURL(res.response);
            },
            onerror: () => reject(new Error('验证码图片下载失败')),
          });
        } else {
          fetch(url)
            .then(r => r.blob())
            .then(blob => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            })
            .catch(reject);
        }
      });
    }

    function callOcrServer(dataUrl, chars) {
      const server = getOcrUrl().replace(/\/$/, '');
      const url = `${server}/captcha_direct`; 
      
      const payload = JSON.stringify({
        image: dataUrl,
        text: chars,
        remark: chars, 
        ts: Date.now()
      });

      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
          GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            data: payload,
            onload: (res) => {
              try {
                const data = JSON.parse(res.responseText);
                resolve(data);
              } catch (e) {
                log('captcha_direct 接口解析失败，降级尝试 /click...');
                callClickOcrFallback(dataUrl, chars).then(resolve).catch(reject);
              }
            },
            onerror: () => {
              log('captcha_direct 连接失败，降级尝试 /click...');
              callClickOcrFallback(dataUrl, chars).then(resolve).catch(reject);
            }
          });
        } else {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
          })
            .then(r => r.json())
            .then(resolve)
            .catch(err => {
              log('fetch captcha_direct 失败，降级尝试 /click...');
              callClickOcrFallback(dataUrl, chars).then(resolve).catch(reject);
            });
        }
      });
    }

    function callClickOcrFallback(dataUrl, chars) {
      const server = getOcrUrl().replace(/\/$/, '');
      const url = `${server}/click`;
      return new Promise((resolve, reject) => {
        const body = JSON.stringify({ image: dataUrl, remark: chars });
        if (typeof GM_xmlhttpRequest !== 'undefined') {
          GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            data: body,
            onload: (r) => {
              try { resolve(JSON.parse(r.responseText)); } 
              catch (e) { reject(new Error('Fallback 响应解析失败')); }
            },
            onerror: () => reject(new Error('ddddocr fallback 连接失败'))
          });
        } else {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
          })
            .then(r => r.json())
            .then(resolve)
            .catch(reject);
        }
      });
    }

    function dispatchClick(el, nx, ny, label) {
      const rect = el.getBoundingClientRect();
      const win = el.ownerDocument.defaultView || window;
      const clientX = rect.left + nx * rect.width;
      const clientY = rect.top + ny * rect.height;
      const base = { bubbles: true, cancelable: true, view: win, clientX, clientY, button: 0, buttons: 1 };
      const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0.5 };
      try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerdown', pointer)); } catch {}
      el.dispatchEvent(new win.MouseEvent('mousedown', base));
      try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerup', pointer)); } catch {}
      el.dispatchEvent(new win.MouseEvent('mouseup', base));
      el.dispatchEvent(new win.MouseEvent('click', base));
      log(`模拟点击 "${label}" @ 归一化: (${nx.toFixed(3)}, ${ny.toFixed(3)})`);
    }

    function hasError() {
      const note = document.querySelector('#tcaptcha_note, .tencent-captcha-dy__verify-error-text');
      return visible(note);
    }

    function clickConfirm() {
      const selectors = [
        '.verify-btn',
        '.tencent-captcha-dy__verify-confirm-btn',
        '.tencent-captcha-dy__btn-confirm',
        '.tencent-captcha-dy__footer .btn',
      ];
      for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (visible(btn)) {
          btn.click();
          log('已自动点击“确定”按钮');
          return true;
        }
      }
      return false;
    }

    let lastBgUrl = '';
    let solving = false;

    async function solveOnce() {
      const bgEl = findBgElement();
      if (!bgEl) return;
      const bgUrl = bgUrlFrom(bgEl);
      if (!bgUrl || bgUrl === lastBgUrl) return;

      const chars = findPromptText();
      if (chars.length < 3) return;

      if (hasError()) {
        log('检测到验证码错误，执行刷新...');
        const reload = document.querySelector('#reload, .tencent-captcha-dy__footer-icon--refresh img');
        if (reload) reload.click();
        lastBgUrl = '';
        await sleep(1000);
        return;
      }

      lastBgUrl = bgUrl;
      log(`捕获到图片: ${bgUrl.substring(0, 80)}... 提示文字: ${chars}`);

      try {
        const dataUrl = await fetchImageDataUrl(bgUrl);
        const response = await callOcrServer(dataUrl, chars);
        
        let coords = [];
        if (response.success && response.result && Array.isArray(response.result.click_coords)) {
          coords = response.result.click_coords;
        } else if (response.success && response.data && response.data.result) {
          const raw = response.data.result.split('|');
          coords = raw.map((p, idx) => {
            const xy = p.split(',');
            return {
              char: chars[idx] || '',
              nx: parseFloat(xy[0]) / 344.0,
              ny: parseFloat(xy[1]) / 344.0
            };
          });
        }

        if (!coords || coords.length === 0) {
          log('未识别出坐标数据');
          lastBgUrl = '';
          return;
        }

        for (const pt of coords) {
          const nx = Number(pt.nx);
          const ny = Number(pt.ny);
          if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
          dispatchClick(bgEl, nx, ny, pt.char || '');
          await sleep(200); 
        }

        await sleep(300);
        const autoConfirm = GM_getValue('glm_bypass_auto_captcha_confirm', true);
        if (autoConfirm) {
          clickConfirm();
        }
      } catch (e) {
        log(`识别失败: ${e.message}`);
        lastBgUrl = '';
      }
    }

    async function tick() {
      if (solving) return;
      solving = true;
      try { await solveOnce(); } 
      catch (e) { log(`监控异常: ${e.message}`); lastBgUrl = ''; } 
      finally { solving = false; }
    }

    const observer = new MutationObserver(() => setTimeout(tick, 100));
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    setInterval(tick, 1000);
    setTimeout(tick, 500);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  3. 主窗口模块（bigmodel.cn 抢购引擎）— 总入口
  //     3A. 配置与全局状态 (L402-)
  //     3B. 多标签页同步 (L484-)
  //     3C. JSON.parse 拦截 & 强制售罄重置 (L520-)
  //     3D. 工具函数 & fetch/XHR API 劫持 (L546-)
  //     3E. Vue Hacking & 支付恢复 (L1107-)
  //     3F. 时钟校准 & 产品ID预拉取 (L1380-)
  //     3G. 抢购调度 (L1469-)
  //     3H. OCR 服务健康检查 (L1670-)
  //     3I. Shadow DOM 控制面板 (L1722-)
  //     3J. UI 刷新 & 日志渲染 (L2166-)
  //     3K. 支付检测 & 验证码状态机 (L2227-)
  // ═══════════════════════════════════════════════════════════════════
  if (document.documentElement.dataset.glmBypass === '1') return;
  document.documentElement.dataset.glmBypass = '1';

  // ── 邀请码自动修正 ──
  const INVITE_CODE = 'FGSQNRBAAE';
  try {
    const url = new URL(location.href);
    const currentIc = url.searchParams.get('ic');
    if (currentIc !== INVITE_CODE) {
      url.searchParams.set('ic', INVITE_CODE);
      history.replaceState(null, '', url.toString());
      console.log(`[glm_bypass] 邀请码已修正: ${currentIc || '(空)'} → ${INVITE_CODE}`);
    }
  } catch (e) {}

  // ── 3A. 配置与全局状态 ──────────────────────────────────────────────
  // ── 默认配置项 ──
  const CFG = {
    planPriority: [
      { plan: 'pro', billingPeriod: 'quarterly' },
      { plan: 'lite', billingPeriod: 'quarterly' },
    ],
    targetHour: 10,
    targetMinute: 0,
    advanceMs: 200,
    autoCloseInvalid: true,
    previewTimeout: 10000, // preview单请求超时(毫秒)，高峰期可能需要8-10s
    checkTimeout: 5000,    // check校验超时，高峰期放宽
    captchaServer: 'http://127.0.0.1:8888',
    autoCaptchaConfirm: true,
    preSolveMs: 2500, // 提前多少毫秒触发验证码预求解（OCR+验证在10:00前完成，preview刚好落在T+0）
    retryIntervalMs: 800,     // 均匀重试：单次请求间隔(ms)，约1.25 req/s
    retryTicketTTL: 170000,   // ticket有效期(ms)，3分钟-10s安全余量
    retryTimeout: 5000,       // 并行重试引擎：单请求超时(ms)，正常preview响应<500ms，5秒足够
  };

  try {
    const saved = localStorage.getItem('glm_bypass_cfg');
    if (saved) Object.assign(CFG, JSON.parse(saved));
  } catch (e) {}

  GM_setValue('glm_bypass_captcha_server', CFG.captchaServer);
  GM_setValue('glm_bypass_auto_captcha_confirm', CFG.autoCaptchaConfirm);

  // 状态机
  let state = {
    status: 'idle', 
    count: 0,
    bizId: null,
    captured: null, 
    cache: null,    
    lastSuccess: null,
    proactive: false,
    timerId: null,
    logs: [],
  };

  try {
    const saved = sessionStorage.getItem('glm_bypass_captured_req');
    if (saved) state.captured = JSON.parse(saved);
  } catch (e) {}

  let _capturedProductId = null;
  let _capturedAuthHeader = null;
  try {
    _capturedAuthHeader = sessionStorage.getItem('glm_bypass_captured_auth');
  } catch (e) {}
  let _allProductIds = {}; 
  try {
    const savedPid = localStorage.getItem('glm_bypass_cached_pids');
    if (savedPid) _allProductIds = JSON.parse(savedPid);
  } catch (e) {}

  let _rushActive = false; // 抢购进行中标记
  let _rushStopped = false; // 用户点击停止后标记，刷新页面才重置
  let recovering = false;
  let recoveryAttempts = 0;
  let _shadowRef = null;
  let _serverTimeOffset = 0;
  let _confirmedSoldOut = false;
  let _currentPlanIdx = 0;

  // 💡 优化项 1: 多阶段时间同步
  function serverNow() { return new Date(Date.now() + _serverTimeOffset); }
  function getTargetTime() {
    const now = serverNow();
    const t = new Date(now);
    t.setHours(CFG.targetHour, CFG.targetMinute, 0, 0);
    if (now >= t) t.setDate(t.getDate() + 1); 
    return t;
  }
  function isNearTarget() {
    const diff = getTargetTime() - serverNow();
    // 抢购前 10 分钟到后 30 分钟为抢购敏感时段，才开启底层 API 修改
    return diff <= 600000 && diff >= -1800000;
  }

  // ── 3B. 多标签页同步 (BroadcastChannel) ────────────────────────────

  const channel = new BroadcastChannel('glm_bypass_channel');
  let isMasterTab = false;
  let tabId = Math.random().toString(36).substring(2, 8);
  let masterTabId = null;

  function sendHeartbeat() {
    channel.postMessage({ type: 'HEARTBEAT', tabId, status: state.status });
  }
  setInterval(sendHeartbeat, 1500);

  channel.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'HEARTBEAT') {
      if (!masterTabId || msg.tabId < masterTabId || msg.tabId === tabId) {
        masterTabId = msg.tabId;
        isMasterTab = (masterTabId === tabId);
        updateMasterStatusDisplay();
      }
    } else if (msg.type === 'GLM_BYPASS_SUCCESS') {
      log(`[多端协同] 接收到 Tab [${msg.tabId}] 的成功通知，自动中止当前抢购...`);
      setState({
        status: 'success',
        bizId: msg.bizId,
        lastSuccess: msg.lastSuccess
      });
      stopAll();
    }
  };

  function updateMasterStatusDisplay() {}

  const curPlan = () => CFG.planPriority[_currentPlanIdx]?.plan || 'pro';
  const curPeriod = () => CFG.planPriority[_currentPlanIdx]?.billingPeriod || 'quarterly';

  // ── 3C. JSON.parse 拦截 & 强制售罄重置 ────────────────────────────
  const _parse = JSON.parse;

  function patchSoldOut(obj, visited = new WeakSet()) {
    if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
    visited.add(obj);
    if (obj.isSoldOut === true) obj.isSoldOut = false;
    if (obj.soldOut === true) obj.soldOut = false;
    if (obj.isServerBusy === true) obj.isServerBusy = false;
    if (obj.isLimitBuy === true) obj.isLimitBuy = false;
    if (obj.disabled === true && (obj.price !== undefined || obj.productId || obj.title)) obj.disabled = false;
    if (obj.stock === 0) obj.stock = 999;
    for (const k of Object.keys(obj)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (obj[k] && typeof obj[k] === 'object') patchSoldOut(obj[k], visited);
    }
  }

  JSON.parse = function (text, reviver) {
    const result = _parse(text, reviver);
    try {
      patchSoldOut(result);
    } catch (e) {}
    return result;
  };
  Object.defineProperty(JSON.parse, 'toString', { value: () => 'function parse() { [native code] }' });

  // ── 3D. 工具函数 & fetch/XHR API 劫持 ─────────────────────────────

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

  // 带超时的fetch，超时自动abort并返回{ok:false, reason:'超时'}
  async function fetchWithTimeout(url, opts, timeoutMs) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await _fetch(url, { ...opts, signal: ac.signal });
      clearTimeout(tid);
      return { ok: true, resp };
    } catch (e) {
      clearTimeout(tid);
      if (e.name === 'AbortError') return { ok: false, reason: '超时' };
      return { ok: false, reason: e.message };
    }
  }

  function visible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0;
  }

  function setState(patch) {
    if (!patch || typeof patch !== 'object') return;
    Object.assign(state, patch);
    // 持久化关键状态
    if ('captured' in patch && patch.captured) {
      try { sessionStorage.setItem('glm_bypass_captured_req', JSON.stringify(patch.captured)); } catch {}
    }
    refreshUI();
  }

  function log(msg, level = 'info') {
    const entry = { ts: ts(), msg, level };
    state.logs.push(entry);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    console.log(`${hh}:${mm}:${ss} [glm_bypass] ${msg}`);
    appendLogDOM(entry);
    refreshUI();
  }

  function extractHeaders(h) {
    const o = {};
    if (!h) return o;
    if (h instanceof Headers) h.forEach((v, k) => (o[k] = v));
    else if (Array.isArray(h)) h.forEach(([k, v]) => (o[k] = v));
    else Object.entries(h).forEach(([k, v]) => (o[k] = v));
    return o;
  }

  const _fetch = window.fetch;
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;
  const _xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';

    // 自动捕获 fetch 中的 Authorization 头
    if (init && init.headers) {
      try {
        const h = new Headers(init.headers);
        const auth = h.get('Authorization') || h.get('authorization');
        if (auth && auth !== _capturedAuthHeader) {
          _capturedAuthHeader = auth;
          sessionStorage.setItem('glm_bypass_captured_auth', auth);
          setTimeout(autoFetchProductIds, 100);
        }
      } catch (e) {}
    }
    if (typeof input === 'object' && input.headers && typeof input.headers.get === 'function') {
      try {
        const auth = input.headers.get('Authorization') || input.headers.get('authorization');
        if (auth && auth !== _capturedAuthHeader) {
          _capturedAuthHeader = auth;
          sessionStorage.setItem('glm_bypass_captured_auth', auth);
          setTimeout(autoFetchProductIds, 100);
        }
      } catch (e) {}
    }
    
    // 💡 优化：拦截并静默阻断神策等埋点统计脚本（Sensorsdata），防检测并节省抢单带宽与CPU资源
    const isTelemetry = url.includes('sensorsdata') || url.includes('/sa.gif') || url.includes('analytics');
    if (isTelemetry) {
      return new Response('{"code":200,"msg":"Blocked by glm_bypass"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 💡 优化：放行并忽略所有微信登录、账户信息、短信和登录相关的请求，彻底解决登录失败问题
    const isAuthRoute = url.includes('/login') || url.includes('/user/info') || url.includes('/user/login') || url.includes('/wechat') || url.includes('/auth') || url.includes('/sms') || url.includes('/phone') || url.includes('/oauth') || url.includes('/geetest') || url.includes('/turing');
    if (isAuthRoute) {
      return _fetch.apply(window, arguments);
    }

    if (isNearTarget() && init) {
      const headers = new Headers(init.headers || {});
      headers.set('X-Request-Id', Math.random().toString(36).slice(2, 15));
      headers.set('X-Timestamp', String(Date.now()));
      const q = (0.5 + Math.random() * 0.5).toFixed(1);
      headers.set('Accept-Language', `zh-CN,zh;q=${q},en;q=${(q * 0.7).toFixed(1)}`);
      init.headers = headers;
    }

    if (url.includes('/api/biz/pay/preview') && !url.includes('batch-preview')) {
      const method = init?.method || 'POST';
      let bodyText = init?.body || '';
      if (typeof bodyText !== 'string' && init?.body) {
        try { bodyText = await init.body.clone().text(); } catch (e) {}
      }

      const captured = {
        url,
        method,
        body: bodyText,
        headers: extractHeaders(init?.headers)
      };

      try {
        const bodyObj = JSON.parse(bodyText);
        if (bodyObj.productId) {
          const planKey = `${curPlan()}_${curPeriod()}`;
          _allProductIds[planKey] = bodyObj.productId;
          localStorage.setItem('glm_bypass_cached_pids', JSON.stringify(_allProductIds));
          _capturedProductId = bodyObj.productId;
          log(`成功捕获并保存 productId=${_capturedProductId}`);
        }
      } catch (e) {}

      setState({ captured });
      try { sessionStorage.setItem('glm_bypass_captured_req', JSON.stringify(captured)); } catch (e) {}

      // 并行重试引擎：将新ticket加入池
      if (_retryEngineActive && captured.body && !captured.body.includes('trerror')) {
        retryEngineAddTicket(captured);
      }

      if (state.status === 'success' && state.lastSuccess) {
        log('已抢购成功，拦截并返回成功响应');
        return new Response(state.lastSuccess.text, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (state.cache) {
        log('返回重点击缓存响应');
        const c = state.cache;
        setState({ cache: null });
        recoveryAttempts = 0;
        return new Response(c.text, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      log('已捕获 preview 请求数据，等待抢购开始...');
      // ── 拦截preview响应码，非成功立即重试（带超时） ──
      const fResult = await fetchWithTimeout(url, init || {}, CFG.previewTimeout);
      if (!fResult.ok) {
        _lastPreviewResult = 'timeout';
        log(`[Preview-fetch] 请求${fResult.reason}，立即重试`, 'warn');
        triggerPreviewRetry(fResult.reason);
        return new Response('{"code":555,"msg":"系统繁忙","data":null,"success":false}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const resp = fResult.resp;
      try {
        const cloned = resp.clone();
        const text = await cloned.text();
        // 非JSON响应（如WAF 405页面）→ 立即停止，提示用户
        if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html')) {
          _lastPreviewResult = 'html';
          _wafBlocked = true;
          log('⛔ IP被WAF拦截(405)，更换IP后刷新页面重试！', 'warn');
          retryEngineStop('WAF拦截');
          return new Response('{"code":555,"msg":"系统繁忙","data":null,"success":false}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const respObj = _parse(text);
        const code = respObj?.code;
        const data = respObj?.data;
        const soldOut = data?.soldOut || data?.isSoldOut;

        // 持久化非成功响应到 localStorage，供事后分析（最多保留24小时）
        if (code !== 200 || !data?.bizId) {
          try {
            const key = 'glm_bypass_preview_log';
            const arr = JSON.parse(localStorage.getItem(key) || '[]');
            const dayAgo = Date.now() - 86400000;
            const fresh = arr.filter(e => new Date(e.ts).getTime() > dayAgo);
            fresh.push({ ts: new Date().toISOString(), code, body: text.slice(0, 800) });
            localStorage.setItem(key, JSON.stringify(fresh));
          } catch (e) {}
        }

        if (code === 200 && data?.bizId) {
          _lastPreviewResult = 'ok';
        } else if (code === 555) {
          _lastPreviewResult = '555';
          log(`[Preview-fetch] 555响应体: ${text.slice(0, 500)}`, 'warn');
          triggerPreviewRetry('555系统繁忙');
          return new Response('{"code":555,"msg":"系统繁忙","data":null,"success":false}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (soldOut || (code === 200 && !data?.bizId)) {
          _lastPreviewResult = 'soldOut';
          log(`[Preview-fetch] 售罄响应体: ${text.slice(0, 500)}`, 'warn');
          triggerPreviewRetry('售罄');
          return new Response('{"code":555,"msg":"系统繁忙","data":null,"success":false}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (code === 500 || code === 405) {
          _lastPreviewResult = 'error';
          log(`[Preview-fetch] ${code}响应体: ${text.slice(0, 500)}`, 'warn');
          triggerPreviewRetry(`code=${code}`);
          return new Response('{"code":555,"msg":"系统繁忙","data":null,"success":false}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      } catch (e) {}
      return resp;
    }

    if (url.includes('/api/biz/pay/check') && url.includes('bizId=null')) {
      return new Response('{"code":-1,"msg":"等待有效bizId"}', {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.includes('batch-preview')) {
      let res;
      try {
        res = await _fetch.apply(window, arguments);
      } catch (e) {
        res = null;
      }

      let needFallback = false;
      let data = null;
      if (!res || res.status !== 200) {
        needFallback = true;
      } else {
        try {
          const text = await res.clone().text();
          data = _parse(text);
          if (!data || data.code !== 200) {
            needFallback = true;
          }
        } catch (e) {
          needFallback = true;
        }
      }

      if (needFallback) {
        log('[容灾兜底] 检测到 batch-preview 接口返回繁忙或错误，正在启用本地及接口降级防线...');
        let cachedPids = {};
        try {
          const saved = localStorage.getItem('glm_bypass_cached_pids');
          if (saved) cachedPids = JSON.parse(saved);
        } catch (e) {}

        if (!cachedPids || Object.keys(cachedPids).length === 0) {
          log('[容灾兜底] 本地无缓存，尝试调用 productinfo API 实时拉取...');
          try {
            const auth = _capturedAuthHeader || sessionStorage.getItem('glm_bypass_captured_auth');
            const headers = { 'accept': 'application/json, text/plain, */*' };
            if (auth) headers['Authorization'] = auth;
            const resp = await _fetch(location.origin + '/api/biz/pay/productinfo', {
              method: 'GET',
              credentials: 'include',
              headers: headers
            });
            if (resp.ok) {
              const data2 = await resp.json();
              const pidMap = data2?.data || data2 || {};
              const pidPattern = /^product-[a-z0-9]+$/i;
              for (const [k, pid] of Object.entries(pidMap)) {
                if (typeof pid === 'string' && pidPattern.test(pid)) {
                  const kl = k.toLowerCase();
                  let plan = kl.includes('pro') ? 'pro' : kl.includes('lite') ? 'lite' : kl.includes('max') ? 'max' : null;
                  let period = kl.includes('quarter') ? 'quarterly' : kl.includes('year') ? 'yearly' : 'monthly';
                  if (plan) {
                    cachedPids[`${plan}_${period}`] = pid;
                  }
                }
              }
              localStorage.setItem('glm_bypass_cached_pids', JSON.stringify(cachedPids));
            }
          } catch (e) {
            log(`[容灾兜底] 调用 productinfo 接口失败: ${e.message}`, 'error');
          }
        }

        if (cachedPids && Object.keys(cachedPids).length > 0) {
          log('[容灾兜底] 成功重构成功响应，绕过 555 错误！');
          const mockProductList = [];
          for (const [key, pid] of Object.entries(cachedPids)) {
            const [plan, period] = key.split('_');
            const monthlyOriginalAmount = plan === 'pro' ? 149 : plan === 'lite' ? 49 : 469;
            const campaignName = period === 'quarterly' ? '包季折后特惠' : period === 'yearly' ? '包年折后特惠' : '无';
            mockProductList.push({
              productId: pid,
              monthlyOriginalAmount: monthlyOriginalAmount,
              campaignDiscountDetails: period !== 'monthly' ? [{ campaignName }] : [],
              isSoldOut: false,
              soldOut: false,
              stock: 999,
              disabled: false
            });
          }

          const mockResponseData = {
            code: 200,
            msg: 'success',
            data: {
              productList: mockProductList
            }
          };

          return new Response(JSON.stringify(mockResponseData), {
            status: 200,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
          });
        }
      }

      if (res && res.status === 200 && data) {
        try {
          if (data.data?.productList && Array.isArray(data.data.productList)) {
            data.data.productList.forEach(item => {
              if (item && item.productId) {
                const plan = identifyPlanName(item.monthlyOriginalAmount);
                const period = identifyPeriodName(item);
                if (plan && period) {
                  _allProductIds[`${plan}_${period}`] = item.productId;
                }
              }
            });
            localStorage.setItem('glm_bypass_cached_pids', JSON.stringify(_allProductIds));
          }
        } catch (e) {}
      }

      return res;
    }

    let res = await _fetch.apply(window, arguments);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json') && (url.includes('/api/') || url.includes('bigmodel'))) {
      try {
        const text = await res.clone().text();
        const parsed = _parse(text);
        
        if (parsed?.data?.productList && Array.isArray(parsed.data.productList)) {
          parsed.data.productList.forEach(item => {
            if (item && item.productId) {
              const plan = identifyPlanName(item.monthlyOriginalAmount);
              const period = identifyPeriodName(item);
              if (plan && period) {
                _allProductIds[`${plan}_${period}`] = item.productId;
              }
            }
          });
          localStorage.setItem('glm_bypass_cached_pids', JSON.stringify(_allProductIds));
        }

        if (isNearTarget()) {
          const modified = text
            .replace(/"isSoldOut"\s*:\s*true/g, '"isSoldOut":false')
            .replace(/"soldOut"\s*:\s*true/g, '"soldOut":false')
            .replace(/"isLimitBuy"\s*:\s*true/g, '"isLimitBuy":false')
            .replace(/"stock"\s*:\s*0/g, '"stock":999')
            .replace(/"disabled"\s*:\s*true/g, '"disabled":false');
          if (modified !== text) {
            return new Response(modified, { status: res.status, statusText: res.statusText, headers: res.headers });
          }
        }
      } catch (e) {}
    }

    return res;
  };
  window.fetch.toString = () => 'function fetch() { [native code] }';

  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    (this._h || (this._h = {}))[k] = v;
    if (/^authorization$/i.test(k) && v && v !== _capturedAuthHeader) {
      _capturedAuthHeader = v;
      sessionStorage.setItem('glm_bypass_captured_auth', v);
      setTimeout(autoFetchProductIds, 100);
    }
    return _xhrSetHeader.call(this, k, v);
  };
  XMLHttpRequest.prototype.open = function (method, url) {
    this._m = method; this._u = url;
    return _xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const url = this._u || '';
    const isTelemetry = url.includes('sensorsdata') || url.includes('/sa.gif') || url.includes('analytics');
    if (isTelemetry) {
      fakeXHR(this, '{"code":200,"msg":"Blocked by glm_bypass"}');
      return;
    }

    const isAuthRoute = url.includes('/login') || url.includes('/user/info') || url.includes('/user/login') || url.includes('/wechat') || url.includes('/auth') || url.includes('/sms') || url.includes('/phone') || url.includes('/oauth') || url.includes('/geetest');
    if (isAuthRoute) {
      return _xhrSend.call(this, body);
    }

    // 拦截验证码验证结果（errorCode: 0=成功, 50=失败）
    if (url.includes('cap_union_new_verify') || url.includes('turing.captcha.qcloud.com')) {
      const self = this;
      let handled = false; // 防止 load + readystatechange 重复处理
      const origHandler = () => {
        if (handled) return;
        handled = true;
        try {
          const respText = self.responseText || self.response || '';
          const respObj = typeof respText === 'string' ? JSON.parse(respText) : respText;
          const errorCode = String(respObj?.errorCode ?? respObj?.error_code ?? '');
          if (errorCode === '0' && respObj?.ticket) {
            log('[验证码回调] ✅ 验证通过 (errorCode=0)');
            _captchaCallbackResult = 'success';
          } else if (errorCode) {
            log(`[验证码回调] ❌ 验证失败 (errorCode=${errorCode})`);
            _captchaCallbackResult = 'error';
          }
          // errorCode 为空则忽略（刷新等操作触发的无关请求）
        } catch (e) {
          // 响应解析失败，忽略
        }
      };
      self.addEventListener('load', origHandler);
      self.addEventListener('readystatechange', () => {
        if (self.readyState === 4) origHandler();
      });
      return _xhrSend.call(this, body);
    }

    if (url.includes('/api/biz/pay/preview') && !url.includes('batch-preview')) {
      const self = this;
      // 超时处理：如果preview响应超时，直接触发重试
      const ac = new AbortController();
      const tid = setTimeout(() => {
        ac.abort();
        log('[Preview-XHR] 请求超时，触发重试', 'warn');
        _lastPreviewResult = 'timeout';
        triggerPreviewRetry('超时');
      }, CFG.previewTimeout);

      // 并行重试引擎：将XHR捕获的ticket加入池
      if (_retryEngineActive && body && !body.includes('trerror')) {
        retryEngineAddTicket({ body, headers: this._h || {} });
      }

      _fetch(url, { method: this._m || 'POST', body: body, headers: this._h || {}, credentials: 'include', signal: ac.signal })
        .then(async r => {
          clearTimeout(tid); // 响应到达，取消超时
          const text = await r.text();
          // 非JSON响应（如WAF 405页面）→ 立即停止，提示用户
          if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html')) {
            _lastPreviewResult = 'html';
            _wafBlocked = true;
            log('⛔ IP被WAF拦截(405)，更换IP后刷新页面重试！', 'warn');
            retryEngineStop('WAF拦截');
            return;
          }
          // ── API响应码检测 ──
          try {
            const respObj = _parse(text);
            const code = respObj?.code;
            const data = respObj?.data;
            const soldOut = data?.soldOut || data?.isSoldOut;

            if (code === 200 && data?.bizId) {
              // 真正成功：有bizId，让Vue正常渲染支付弹窗
              _lastPreviewResult = 'ok';
              log('[Preview] 响应成功 bizId=' + data.bizId.substring(0, 8) + '...');
            } else if (code === 555) {
              // 系统繁忙：抑制弹窗，立即重试购买
              _lastPreviewResult = '555';
              log('[Preview] 555系统繁忙，拦截弹窗，立即重试', 'warn');
              triggerPreviewRetry('555系统繁忙');
              return; // 不派发事件，Vue不渲染
            } else if (soldOut) {
              // 售罄：抑制弹窗，立即重试购买
              _lastPreviewResult = 'soldOut';
              log('[Preview] 响应售罄，拦截弹窗，立即重试', 'warn');
              triggerPreviewRetry('售罄');
              return;
            } else if (code === 500 || code === 405) {
              // 服务器错误：抑制弹窗，立即重试购买
              _lastPreviewResult = 'error';
              log(`[Preview] code=${code}，拦截弹窗，立即重试`, 'warn');
              triggerPreviewRetry(`code=${code}`);
              return;
            } else if (code === 200 && !data?.bizId) {
              // code=200但无bizId = 实质售罄
              _lastPreviewResult = 'soldOut';
              log('[Preview] code=200但无bizId，拦截弹窗，立即重试', 'warn');
              triggerPreviewRetry('无bizId');
              return;
            }
          } catch (e) {}

          const dp = (k, v) => Object.defineProperty(self, k, { value: v, configurable: true });
          let patchedText = text
            .replace(/"isSoldOut"\s*:\s*true/g, '"isSoldOut":false')
            .replace(/"soldOut"\s*:\s*true/g, '"soldOut":false')
            .replace(/"stock"\s*:\s*0/g, '"stock":999')
            .replace(/"disabled"\s*:\s*true/g, '"disabled":false');
          let resVal = patchedText;
          if (self.responseType === 'json') { try { resVal = JSON.parse(patchedText); } catch(e){} }
          dp('readyState', 4); dp('status', r.status); dp('statusText', r.statusText);
          dp('responseText', patchedText); dp('response', resVal);
          self.getAllResponseHeaders = () => 'content-type: application/json\r\n';
          self.getResponseHeader = (n) => n.toLowerCase() === 'content-type' ? 'application/json' : null;
          const ev = new Event('readystatechange');
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange(ev);
          self.dispatchEvent(ev);
          const ld = new ProgressEvent('load');
          if (typeof self.onload === 'function') self.onload(ld);
          self.dispatchEvent(ld);
        }).catch(() => { clearTimeout(tid); }); // 超时abort时清掉timer
      return;
    }
    

    if (url.includes('/api/biz/pay/check') && url.includes('bizId=null')) {
      fakeXHR(this, '{"code":-1,"msg":"等待有效bizId"}');
      return;
    }
    return _xhrSend.call(this, body);
  };

  function fakeXHR(xhr, text) {
    setTimeout(() => {
      const dp = (k, v) => Object.defineProperty(xhr, k, { value: v, configurable: true });
      let patchedText = text
        .replace(/"isSoldOut"\s*:\s*true/g, '"isSoldOut":false')
        .replace(/"soldOut"\s*:\s*true/g, '"soldOut":false')
        .replace(/"stock"\s*:\s*0/g, '"stock":999')
        .replace(/"disabled"\s*:\s*true/g, '"disabled":false');
      let resVal = patchedText;
      if (xhr.responseType === 'json') { try { resVal = JSON.parse(patchedText); } catch(e){} }
      dp('readyState', 4); dp('status', 200); dp('statusText', 'OK');
      dp('responseText', patchedText); dp('response', resVal);
      xhr.getAllResponseHeaders = () => 'content-type: application/json\r\n';
      xhr.getResponseHeader = (n) => n.toLowerCase() === 'content-type' ? 'application/json' : null;
      const ev = new Event('readystatechange');
      if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(ev);
      xhr.dispatchEvent(ev);
    }, 0);
  }

  function identifyPlanName(price) {
    if (price === 49 || (price >= 30 && price <= 80)) return 'lite';
    if (price === 149 || (price >= 100 && price <= 200)) return 'pro';
    if (price === 469 || (price >= 350 && price <= 550)) return 'max';
    return null;
  }
  function identifyPeriodName(item) {
    const campaigns = item?.campaignDiscountDetails || [];
    for (const c of campaigns) {
      const cn = c.campaignName || '';
      if (['包季', '季度', '季卡', '3个月'].some(kw => cn.includes(kw))) return 'quarterly';
      if (['包年', '年度', '年卡', '12个月'].some(kw => cn.includes(kw))) return 'yearly';
    }
    return 'monthly';
  }

  function getProductIdForCurrent() {
    const planKey = `${curPlan()}_${curPeriod()}`;
    if (_allProductIds[planKey]) return _allProductIds[planKey];
    for (const [key, val] of Object.entries(_allProductIds)) {
      if (key.startsWith(curPlan() + '_')) return val;
    }
    return _capturedProductId;
  }

  // ── 3E. Vue Hacking (Object.defineProperty 永久解除 busy) ─────────

  function makePermanentlyFalse(vm, prop) {
    if (!vm) return;
    try {
      const desc = Object.getOwnPropertyDescriptor(vm, prop) || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vm), prop);
      if (desc && desc.configurable) {
        Object.defineProperty(vm, prop, {
          get: () => false,
          set: (v) => {},
          configurable: true,
          enumerable: true
        });
      } else if (!desc) {
        Object.defineProperty(vm, prop, {
          get: () => false,
          set: (v) => {},
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) {}
  }

  function removeAllDisabled() {
    document.querySelectorAll('button[disabled], a[disabled], input[disabled], .disabled, .is-disabled').forEach(el => {
      el.removeAttribute('disabled');
      if (el.disabled) el.disabled = false;
      el.classList.remove('disabled', 'is-disabled', 'btn-disabled');
      if (el.style.pointerEvents === 'none') {
        el.style.pointerEvents = 'auto';
      }
      if (el.style.opacity === '0.5' || el.style.opacity === '0.6') {
        el.style.opacity = '1';
      }
      const text = el.textContent.trim();
      if (/售罄|补货|抢光|人满|繁忙/.test(text)) {
        el.textContent = '特惠订阅';
      }
    });
  }

  function patchVueServerBusy() {
    // 强制解除 DOM 级别的禁用状态
    removeAllDisabled();

    const app = document.querySelector('#app');
    const vue = app && app.__vue__;
    if (!vue) return;
    
    let patched = 0;
    const walk = (vm, depth) => {
      if (depth > 8) return;
      if (vm.$data) {
        if ('isServerBusy' in vm.$data || vm.isServerBusy === true) {
          makePermanentlyFalse(vm, 'isServerBusy');
          patched++;
        }
        if ('soldOut' in vm.$data || vm.soldOut === true) {
          makePermanentlyFalse(vm, 'soldOut');
          patched++;
        }
        if ('isSoldOut' in vm.$data || vm.isSoldOut === true) {
          makePermanentlyFalse(vm, 'isSoldOut');
          patched++;
        }
        if ('isLimitBuy' in vm.$data || vm.isLimitBuy === true) {
          makePermanentlyFalse(vm, 'isLimitBuy');
          patched++;
        }
      }
      for (const child of (vm.$children || [])) walk(child, depth + 1);
    };
    
    walk(vue, 0);
  }

  setInterval(patchVueServerBusy, 1000);

  // ── 成功后轮询等待支付弹窗：多策略重试确保支付弹窗弹出 ──
  async function waitForPaymentDialog(responseData) {
    const maxWait = 10000; // 增加到10秒
    const pollInterval = 300;
    const start = Date.now();

    // 策略1: 先尝试正常点击购买按钮触发
    const btn = findBuyButton();
    if (btn) { btn.click(); log('[支付等待] 已点击购买按钮触发弹窗'); }

    for (let round = 0; Date.now() - start < maxWait; round++) {
      // 检查支付弹窗是否已出现
      if (isPaymentUIVisible()) {
        // 检查是否有可扫描二维码（可能需要等canvas加载）
        if (hasScannableQR()) {
          freezeForPayment('[支付等待] ✅ 支付弹窗已出现且有二维码！');
          return;
        }
        // 弹窗出现但无QR → 等待加载
        log(`[支付等待] 支付弹窗已出现，等待二维码加载 (${(Date.now() - start) / 1000}s)...`);
        await sleep(1000);
        if (hasScannableQR()) {
          freezeForPayment('[支付等待] ✅ 二维码已加载！');
          return;
        }
        // 仍在加载 → 冻结并通知用户
        freezeForPayment('[支付等待] ✅ 支付弹窗已出现，二维码加载中，冻结保护！');
        return;
      }
      // 检查是否有错误弹窗阻挡
      const errDlg = findErrorDialog();
      if (errDlg) {
        dismissDialog(errDlg);
        log(`[支付等待] 第${round + 1}轮：关闭错误弹窗，重新尝试`);
      }
      // 每600ms重试一次 forcePayDialog
      if (round > 0 && round % 2 === 0) {
        forcePayDialog(responseData);
        log(`[支付等待] 第${round + 1}轮：Vue Hack 重试`);
      }
      await sleep(pollInterval);
    }

    // 超时后最终兜底：提取直接支付链接
    log('[支付等待] 支付弹窗未出现，尝试提取直接支付链接...', 'warn');
    await tryDirectPayLink();
  }

  // ── 兜底：通过 bizId 提取直接支付链接 ──
  async function tryDirectPayLink() {
    const bizId = state.bizId;
    if (!bizId) return;
    try {
      const checkUrl = `${location.origin}/api/biz/pay/check?bizId=${encodeURIComponent(bizId)}`;
      const resp = await _fetch(checkUrl, { credentials: 'include' });
      const checkData = await resp.json();

      if (checkData.data && typeof checkData.data === 'string' && checkData.data.startsWith('http')) {
        window.open(checkData.data, '_blank');
        freezeForPayment('[兜底] 已在新标签页打开支付链接');
      } else if (checkData.data && checkData.data.payUrl) {
        window.open(checkData.data.payUrl, '_blank');
        freezeForPayment('[兜底] 已在新标签页打开支付链接');
      } else if (checkData.data && checkData.data.qrCode) {
        showQRCodeFallback(checkData.data.qrCode, bizId);
        freezeForPayment('[兜底] 已显示支付二维码');
      } else {
        log('[兜底] bizId有效但无支付链接，请手动刷新页面查看', 'warn');
      }
    } catch (e) {
      log('[兜底] 提取支付链接失败: ' + e.message, 'error');
    }
  }

  function forcePayDialog(responseData) {
    const app = document.querySelector('#app');
    const vue = app && app.__vue__;
    if (!vue) return;

    let payComp = null;
    const findComp = (vm, depth) => {
      if (depth > 8) return;
      if (vm.$data && 'payDialogVisible' in vm.$data) { payComp = vm; return; }
      for (const child of (vm.$children || [])) { findComp(child, depth + 1); if (payComp) return; }
    };
    findComp(vue, 0);
    if (!payComp) { log('[Vue Hack] 未定位到支付组件'); return; }

    if (payComp.payDialogVisible) { log('支付窗口已正常开启'); return; }

    const data = responseData && responseData.data;
    if (data) {
      payComp.priceData = data;
      payComp.payDialogVisible = true;
      log('[Vue Hack] 暴力破解成功: 已设置 payDialogVisible=true');
    }
  }

  // ── 3E. 支付恢复 & 错误弹窗自动恢复 ─────────────────────────────

  function findErrorDialog() {
    const sels = [
      '.el-dialog', '.el-message-box', '.el-dialog__wrapper',
      '.ant-modal', '.ant-modal-wrap', '[class*="modal"]', '[class*="dialog"]',
    ];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
        if (/购买人数过多|系统繁忙|稍后再试|请重试|繁忙|失败|出错|异常/.test(el.textContent || '')) return el;
      }
    }
    return null;
  }

  function dismissDialog(dialog) {
    for (const sel of ['.el-dialog__headerbtn', '.el-message-box__headerbtn', '.ant-modal-close', '[aria-label="Close"]']) {
      const btn = dialog.querySelector(sel);
      if (btn && visible(btn)) { btn.click(); return true; }
    }
    for (const btn of dialog.querySelectorAll('button')) {
      const t = (btn.textContent || '').trim();
      if (/关闭|确定|知道了|确认/.test(t) && t.length < 10) { btn.click(); return true; }
    }
    dialog.style.display = 'none';
    return true;
  }

  async function autoRecover() {
    if (recovering || recoveryAttempts >= 3 || !state.lastSuccess) return;

    const payEl = document.querySelector('[class*="pay"], [class*="qrcode"], [class*="alipay"], iframe[src*="pay"]');
    if (payEl && visible(payEl)) {
      log('扫码支付界面已开启，停止自动恢复。');
      return;
    }

    const errDlg = findErrorDialog();
    if (!errDlg) return;

    recovering = true;
    recoveryAttempts++;
    log(`[自动恢复] 检测到错误弹窗，正在发起第 ${recoveryAttempts}/3 次自动恢复机制...`);

    try {
      dismissDialog(errDlg);
      document.querySelectorAll('.el-overlay, .v-modal, .el-overlay-dialog').forEach(el => el.style.display = 'none');
      document.body.style.overflow = '';
      document.body.classList.remove('el-popup-parent--hidden');
      await sleep(300);

      setState({ cache: state.lastSuccess });
      const btn = findBuyButton();
      if (btn) {
        btn.click();
        log('[恢复策略2] 已重新模拟点击购买按钮');
        await sleep(1500);
      }

      if (!isPaymentUIVisible()) {
        log('[恢复策略3] 支付弹窗未弹出，尝试提取直接支付链接...');
        await tryDirectPayLink();
      }
    } finally {
      recovering = false;
    }
  }

  function showQRCodeFallback(qrData, bizId) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.3);text-align:center';
    div.innerHTML = `
      <h3 style="margin:0 0 15px;color:#333;font-size:16px;font-weight:bold;">glm_bypass — 抢购成功，直接支付</h3>
      <img src="${qrData}" style="width:200px;height:200px">
      <p style="margin:15px 0 0;color:#666;font-size:12px">bizId: ${bizId}</p>
      <button id="close-qr-fallback" style="margin-top:15px;padding:6px 20px;background:#6c5ce7;border:none;color:#fff;border-radius:4px;cursor:pointer">关闭</button>
    `;
    document.body.appendChild(div);
    div.querySelector('#close-qr-fallback').onclick = () => div.remove();
  }

  function findBuyButton() {
    for (const el of document.querySelectorAll('button.buy-btn, button, [role="button"]')) {
      const t = el.textContent.trim();
      if (/特惠订阅|订阅升级|购买|下单/.test(t) && t.length < 15 && visible(el)) return el;
    }
    return null;
  }

  function setupDialogWatcher() {
    const observer = new MutationObserver(() => {
      if (state.lastSuccess && !recovering && recoveryAttempts < 3) {
        if (findErrorDialog()) autoRecover();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── 3F. 时钟校准 & 产品ID预拉取 ─────────────────────────────────

  async function calibrateClock() {
    log('开始校准系统时钟与服务器时间...');
    const offsets = [];
    for (let i = 0; i < 3; i++) {
      try {
        const t1 = Date.now();
        // 💡 优化：用 HEAD 方法请求首页，完全不带 credentials 凭证，彻底绕过风控检测
        const res = await _fetch(location.origin + '/', {
          method: 'HEAD',
          credentials: 'omit',
          cache: 'no-cache'
        });
        const t2 = Date.now();
        const dateStr = res.headers.get('Date');
        if (dateStr) {
          const serverTime = new Date(dateStr).getTime();
          const localTime = (t1 + t2) / 2;
          offsets.push(serverTime - localTime);
        }
      } catch (e) {}
      await sleep(200);
    }

    if (offsets.length >= 2) {
      offsets.sort((a, b) => a - b);
      _serverTimeOffset = offsets[Math.floor(offsets.length / 2)];
      log(`[时钟校准] 完成。偏移值: ${_serverTimeOffset}ms`);
    } else {
      log('[时钟校准] 失败，将使用本地时间');
    }
  }

  async function autoFetchProductIds() {
    const auth = _capturedAuthHeader || sessionStorage.getItem('glm_bypass_captured_auth');
    if (!auth) return;
    if (_allProductIds && Object.keys(_allProductIds).length > 0) {
      log('[自动获取] 检测到已缓存的产品 ID，跳过背景预拉取以防 555 限流。');
      return;
    }
    try {
      const resp = await _fetch(location.origin + '/api/biz/pay/batch-preview', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Authorization': auth
        },
        body: '{}'
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.data?.productList && Array.isArray(data.data.productList)) {
          data.data.productList.forEach(item => {
            if (item && item.productId) {
              const plan = identifyPlanName(item.monthlyOriginalAmount);
              const period = identifyPeriodName(item);
              if (plan && period) {
                _allProductIds[`${plan}_${period}`] = item.productId;
              }
            }
          });
          localStorage.setItem('glm_bypass_cached_pids', JSON.stringify(_allProductIds));
          log(`[自动获取] 成功拉取并缓存产品 ID 列表`);
          refreshUI();
        }
      }
    } catch (e) {
      log(`[自动获取] 尝试拉取产品列表失败: ${e.message}`, 'warn');
    }
  }

  // 💡 优化：移除所有 normal 状态下的周期性时钟同步，极速抢购前 1 分钟再启动探测
  let highFreqSyncStarted = false;
  function startHighFreqSync() {
    if (highFreqSyncStarted) return;
    highFreqSyncStarted = true;
    log('[时钟校准] 临近抢购，启动安全错峰校准监控...');
    const tid = setInterval(() => {
      const diff = getTargetTime() - serverNow();
      if (diff <= 0 || _rushActive) {
        clearInterval(tid);
        return;
      }
      calibrateClock();
    }, 12000); // 间隔放宽到 12 秒，安全第一
  }

  // ── 3G. 抢购调度 (主动触发 & 错峰 & 定时) ────────────────────────
  async function startProactive() {
    // 确保授权和产品ID就绪
    if (!state.captured) {
      const auth = _capturedAuthHeader || sessionStorage.getItem('glm_bypass_captured_auth');
      const pid = getProductIdForCurrent();
      if (auth && pid) {
        state.captured = {
          url: location.origin + '/api/biz/pay/preview',
          method: 'POST',
          body: JSON.stringify({ productId: pid }),
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Authorization': auth
          }
        };
        log(`[自动装配] 检测到已有授权凭证与产品 ID，已自动生成请求参数！`);
      } else {
        log('未检测到请求参数，正在尝试主动获取...', 'warn');
        if (auth) {
          await autoFetchProductIds();
          const retryPid = getProductIdForCurrent();
          if (retryPid) {
            state.captured = {
              url: location.origin + '/api/biz/pay/preview',
              method: 'POST',
              body: JSON.stringify({ productId: retryPid }),
              headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Authorization': auth
              }
            };
            log(`[自动装配] 主动获取产品列表成功，已自动生成请求参数！`);
          } else {
            alert('请先手动点一次购买/订阅按钮，或稍候等脚本自动拉取产品列表完毕。');
            return;
          }
        } else {
          alert('未捕获到登录 Token，请确认已处于登录状态，或手动点击一次购买按钮。');
          return;
        }
      }
    }
    if (_paymentFrozen) {
      log('支付保护中，请先解冻再重新开始');
      return;
    }
    if (_wafBlocked) {
      log('⛔ IP已被WAF拦截，请更换IP后刷新页面重试！');
      return;
    }

    _rushActive = true;
    _rushStopped = false;
    // 注意：_wafBlocked 不在此重置，WAF拦截后只有刷新页面才能恢复
    setState({ status: 'active' });
    patchVueServerBusy();
    log('抢购已启动，自动点击购买按钮...');

    // 点击购买按钮触发验证码流程，后续由状态机自动处理
    const btn = findBuyButton();
    if (btn) {
      btn.click();
      log('已点击购买按钮，等待验证码弹窗...');
    } else {
      log('未找到购买按钮，请手动点击', 'warn');
    }
  }

  function stopAll() {
    _rushActive = false;
    _rushStopped = true;
    setState({ status: 'idle', count: 0 });
    if (state.timerId) { clearInterval(state.timerId); setState({ timerId: null }); }
    // 停止所有自动重试
    retryEngineCleanup();
    if (_previewRetryTimer) { clearTimeout(_previewRetryTimer); _previewRetryTimer = null; }
    _qrRetryEpoch++; // 使所有QR重试回调失效
    _captchaState = CAPTCHA_STATE.IDLE;
    _captchaProcessing = false;
    _captchaLastBgUrl = '';
    _captchaLastChars = '';
    _lastPreviewResult = '';
    // 关闭验证码弹窗
    try {
      const captchaClose = document.querySelector('.tencent-captcha-dy__close-btn') ||
        document.querySelector('#tcaptcha_transform_dy .close-btn');
      if (captchaClose) captchaClose.click();
    } catch (e) {}
    // 关闭支付弹窗
    try {
      const closeBtn = document.querySelector('[class*="pay-dialog"] [class*="close"], [class*="payDialog"] [class*="close"]');
      if (closeBtn) closeBtn.click();
      document.querySelectorAll('.el-overlay, .v-modal, .el-overlay-dialog').forEach(el => {
        el.style.display = 'none';
      });
      document.body.style.overflow = '';
    } catch (e) {}
    log('抢购已停止。');
  }

  function scheduleAt(timeStr) {
    if (state.timerId) clearInterval(state.timerId);

    const parts = timeStr.split(':').map(Number);
    const now = serverNow();
    const target = new Date(now);
    target.setHours(parts[0], parts[1], parts[2] || 0, 0);

    if (target.getTime() <= now.getTime()) {
      const overdue = now.getTime() - target.getTime();
      if (overdue < 300000) { // 5分钟内都立即激活
        log(`已超出设定时间 ${timeStr} ${(overdue/1000).toFixed(0)}秒，立即激活！`);
        startProactive();
        return;
      } else {
        log('目标时间已过期超过5分钟，自动调整为明天。');
        target.setDate(target.getDate() + 1);
      }
    }

    log(`已设定定时抢购: ${timeStr}，等待中...`);

    // 第一阶段：远距离，1秒精度（省CPU）
    const farPhase = setInterval(() => {
      const diff = target.getTime() - serverNow().getTime();

      // 更新倒计时
      if (diff > 0) {
        const timerInfo = _shadowRef?.getElementById('timer-info');
        if (timerInfo) {
          const min = Math.floor(diff / 60000);
          const sec = Math.floor((diff % 60000) / 1000);
          timerInfo.textContent = min > 0 ? `-${min}m${sec}s` : `-${sec}s`;
        }
      }

      // 进入近距离阶段（60秒内），切换到10ms精度
      if (diff <= 60000) {
        clearInterval(farPhase);
        startNearPhase(target);
      }
    }, 1000);

    setState({ timerId: farPhase });
  }

  function startNearPhase(target) {
    let presolved = false;

    const tid = setInterval(() => {
      const diff = target.getTime() - serverNow().getTime();

      if (diff > 50000 && diff < 60000) {
        startHighFreqSync();
      }

      // T-preSolveMs: 预求解验证码（提前触发购买按钮，让OCR+验证在10:00前完成）
      if (!presolved && diff > 0 && diff < CFG.preSolveMs) {
        if (_wafBlocked) { log('⛔ IP已被WAF拦截，预求解中止'); return; }
        presolved = true;
        log(`[预求解] 提前${(CFG.preSolveMs / 1000).toFixed(1)}秒触发验证码流程`);
        _rushActive = true;
        _rushStopped = false;
        // _wafBlocked 不在此重置
        setState({ status: 'active' });
        patchVueServerBusy();
        const btn = findBuyButton();
        if (btn) {
          btn.click();
          log('[预求解] 已点击购买按钮，验证码自动识别中...');
        }
      }

      // 更新倒计时（精确到0.1秒）
      if (diff > 0) {
        const timerInfo = _shadowRef?.getElementById('timer-info');
        if (timerInfo) timerInfo.textContent = `-${(diff / 1000).toFixed(1)}s`;
      }

      const tabJitter = isMasterTab ? 0 : 180 + (tabId.charCodeAt(0) % 2) * 150;
      if (diff - CFG.advanceMs - tabJitter <= 0) {
        clearInterval(tid);
        setState({ timerId: null });
        const timerInfo = _shadowRef?.getElementById('timer-info');
        if (timerInfo) timerInfo.textContent = '';

        if (_rushActive) {
          // 预求解已在运行，验证码流程进行中，不再重复点击
          log(`[点火] 预求解已在运行中 (状态=${_captchaState})，继续等待结果`);
        } else {
          log(`[点火] 抢购启动！当前协同延迟: +${tabJitter}ms`);
          patchVueServerBusy();
          startProactive();
        }
      }
    }, 10);

    setState({ timerId: tid });
  }

  // ── 3H. OCR 服务健康检查 ──
  function checkOcrHealth() {
    const statusEl = _shadowRef?.getElementById('ocr-status');
    if (!statusEl) return;
    const server = CFG.captchaServer.replace(/\/$/, '');
    statusEl.textContent = '...';
    statusEl.style.color = '#52525b';

    const timeout = setTimeout(() => {
      statusEl.textContent = 'OFF';
      statusEl.style.color = '#f87171';
      log(`[OCR] 服务未连接: ${server}`, 'warn');
    }, 3000);

    const handleOk = (text) => {
      clearTimeout(timeout);
      try {
        const data = JSON.parse(text);
        statusEl.textContent = `OK (${data.fonts ?? '?'} fonts)`;
        statusEl.style.color = '#4ade80';
        log(`[OCR] 服务就绪: ${server} (${data.fonts ?? '?'} 字体, ${data.engine ?? '?'})`);
      } catch {
        statusEl.textContent = 'ERR';
        statusEl.style.color = '#f87171';
      }
    };
    const handleFail = () => {
      clearTimeout(timeout);
      statusEl.textContent = 'OFF';
      statusEl.style.color = '#f87171';
      log(`[OCR] 服务未连接: ${server}`, 'warn');
    };

    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${server}/health`,
        timeout: 3000,
        onload: (res) => {
          if (res.status === 200) handleOk(res.responseText);
          else handleFail();
        },
        onerror: handleFail,
        ontimeout: handleFail,
      });
    } else {
      fetch(`${server}/health`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok ? r.text().then(handleOk) : handleFail())
        .catch(handleFail);
    }
  }

  // ── 3I. Shadow DOM 控制面板 (UI) ─────────────────────────────────

  function createPanel() {
    const host = document.createElement('div');
    host.id = 'glm-bypass-host';
    const shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
<style>
:host {
  all: initial;
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
.panel {
  width: 320px;
  background: #111113;
  border: 1px solid #2a2a2e;
  border-radius: 10px;
  color: #e4e4e7;
  font-size: 12px;
  user-select: none;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0,0,0,.5);
}
.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: move;
  border-bottom: 1px solid #2a2a2e;
  background: #16161a;
}
.hdr-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: #a78bfa;
  text-transform: uppercase;
}
.hdr-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hdr-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: #1e1e22;
  color: #71717a;
  font-weight: 500;
}
.hdr-btn {
  background: none;
  border: none;
  color: #71717a;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  transition: color .15s;
}
.hdr-btn:hover { color: #e4e4e7; }
.bdy { padding: 10px 12px 12px; }
.sts {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  background: #1a1a1e;
  border: 1px solid #2a2a2e;
}
.sts-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sts-idle .sts-dot { background: #52525b; }
.sts-active .sts-dot { background: #f97316; animation: blink 1s infinite; }
.sts-success .sts-dot { background: #22c55e; }
.sts-failed .sts-dot { background: #ef4444; }
@keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:.3 } }
.sts-active { border-color: #f9731633; }
.sts-success { border-color: #22c55e33; }
.sts-failed { border-color: #ef444433; }
.info-row {
  font-size: 10px;
  color: #71717a;
  padding: 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}
.cfg {
  display: grid;
  grid-template-columns: 36px 1fr 36px 1fr;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}
.cfg-label {
  font-size: 10px;
  color: #71717a;
}
.cfg select, .cfg input[type="text"] {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #2a2a2e;
  border-radius: 4px;
  background: #1a1a1e;
  color: #e4e4e7;
  font-size: 11px;
  outline: none;
  transition: border .15s;
}
.cfg select:focus, .cfg input:focus { border-color: #a78bfa; }
.cfg select option { background: #1a1a1e; color: #e4e4e7; }
.cfg-full {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
}
.cfg-full .cfg-label { width: 36px; flex-shrink: 0; }
.cfg-full input { flex: 1; }
.timer-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.timer-row input[type="time"] {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid #2a2a2e;
  border-radius: 4px;
  background: #1a1a1e;
  color: #e4e4e7;
  font-size: 11px;
  outline: none;
}
.timer-row input:focus { border-color: #a78bfa; }
.t-btn {
  padding: 4px 8px;
  border: 1px solid #2a2a2e;
  border-radius: 4px;
  background: #1a1a1e;
  color: #a1a1aa;
  font-size: 10px;
  cursor: pointer;
  transition: all .15s;
  white-space: nowrap;
}
.t-btn:hover { border-color: #a78bfa; color: #e4e4e7; }
.t-btn-accent { background: #a78bfa22; border-color: #a78bfa44; color: #a78bfa; }
.t-btn-accent:hover { background: #a78bfa33; }
#timer-info {
  font-size: 11px;
  font-weight: 700;
  color: #a78bfa;
  min-width: 40px;
  text-align: right;
}
.acts {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.abtn {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 5px;
  font-weight: 600;
  font-size: 11px;
  cursor: pointer;
  transition: opacity .15s, transform .08s;
  text-align: center;
}
.abtn:active { transform: scale(.97); }
.abtn-go { background: #a78bfa; color: #fff; }
.abtn-stop { background: #ef4444; color: #fff; }
.abtn-sec { background: #27272a; color: #a1a1aa; }
.abtn-sec:hover { background: #323236; color: #e4e4e7; }
.log-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.log-hdr span {
  font-size: 10px;
  color: #52525b;
  text-transform: uppercase;
  letter-spacing: .5px;
}
.log-copy {
  font-size: 9px;
  padding: 1px 6px;
  border: 1px solid #2a2a2e;
  border-radius: 3px;
  background: none;
  color: #52525b;
  cursor: pointer;
  transition: color .15s;
}
.log-copy:hover { color: #a1a1aa; }
.log-box {
  height: 120px;
  overflow-y: auto;
  background: #0a0a0b;
  border-radius: 6px;
  padding: 6px 8px;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 10px;
  line-height: 1.5;
  border: 1px solid #1a1a1e;
}
.log-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 1px;
  user-select: text;
  cursor: text;
}
.log-info { color: #a1a1aa; }
.log-warn { color: #fbbf24; }
.log-error { color: #f87171; }
.log-success { color: #4ade80; }
.log-box::-webkit-scrollbar { width: 3px; }
.log-box::-webkit-scrollbar-thumb { background: #2a2a2e; border-radius: 2px; }
.log-box::-webkit-scrollbar-track { background: transparent; }
.foot {
  font-size: 9px;
  color: #3f3f46;
  text-align: center;
  margin-top: 6px;
}
</style>
<div class="panel">
  <div class="hdr" id="drag-bar">
    <span class="hdr-title">glm_bypass</span>
    <div class="hdr-right">
      <span class="hdr-tag">v1.0.0</span>
      <button class="hdr-btn" id="min-btn">_</button>
    </div>
  </div>
  <div class="bdy" id="body-section">
    <div class="sts sts-idle" id="lbl-status">
      <span class="sts-dot"></span>
      <span id="sts-text">STANDBY</span>
    </div>
    <div class="cfg">
      <span class="cfg-label">套餐</span>
      <select id="sel-plan">
        <option value="pro" ${curPlan() === 'pro' ? 'selected' : ''}>Pro</option>
        <option value="lite" ${curPlan() === 'lite' ? 'selected' : ''}>Lite</option>
        <option value="max" ${curPlan() === 'max' ? 'selected' : ''}>Max</option>
      </select>
      <span class="cfg-label">周期</span>
      <select id="sel-period">
        <option value="quarterly" ${curPeriod() === 'quarterly' ? 'selected' : ''}>包季</option>
        <option value="yearly" ${curPeriod() === 'yearly' ? 'selected' : ''}>包年</option>
        <option value="monthly" ${curPeriod() === 'monthly' ? 'selected' : ''}>包月</option>
      </select>
      <div class="cfg-full">
        <span class="cfg-label">OCR</span>
        <input type="text" id="inp-ocr" value="${CFG.captchaServer}">
        <span id="ocr-status" style="font-size:9px;color:#52525b;white-space:nowrap;"></span>
      </div>
    </div>
    <div class="timer-row">
      <input type="time" id="inp-time" step="1" value="10:00:00">
      <button class="t-btn" id="btn-set-time">SET</button>
      <button class="t-btn t-btn-accent" id="btn-auto-timer">10:00</button>
      <span id="timer-info"></span>
    </div>
    <div class="acts">
      <button class="abtn abtn-go" id="btn-start">START</button>
      <button class="abtn abtn-stop" id="btn-stop" style="display:none;">STOP</button>
      <button class="abtn abtn-sec" id="btn-unfreeze" style="display:none;color:#f97316;">UNFREEZE</button>
    </div>
    <div class="log-hdr">
      <span>log</span>
      <button class="log-copy" id="btn-copy-log">copy</button>
    </div>
    <div class="log-box" id="log-list"></div>
    <div class="foot"></div>
  </div>
</div>`;



    document.body.appendChild(host);

    const $ = (id) => shadow.getElementById(id);

    $('btn-start').onclick = startProactive;
    $('btn-stop').onclick = stopAll;
    $('btn-unfreeze').onclick = () => {
      _paymentFrozen = false;
      _frozenAt = 0;
      _captchaState = 0; // CAPTCHA_STATE.IDLE
      _captchaProcessing = false;
      _captchaLastBgUrl = '';
      _captchaLastChars = '';
      log('🔓 手动解冻，状态机已重置');
    };

    $('btn-set-time').onclick = () => {
      const v = $('inp-time').value;
      if (v) scheduleAt(v);
    };
    $('btn-auto-timer').onclick = () => {
      scheduleAt('10:00:00');
      $('inp-time').value = '10:00:00';
    };
    $('btn-copy-log').onclick = () => {
      const logEl = $('log-list');
      if (!logEl) return;
      const text = Array.from(logEl.children).map(c => c.textContent).join('\n');
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const btn = $('btn-copy-log');
        btn.textContent = 'copied!';
        setTimeout(() => { btn.textContent = 'copy'; }, 1500);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        shadow.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        shadow.removeChild(ta);
        const btn = $('btn-copy-log');
        btn.textContent = 'copied!';
        setTimeout(() => { btn.textContent = 'copy'; }, 1500);
      });
    };

    $('inp-ocr').onchange = function () {
      CFG.captchaServer = this.value;
      localStorage.setItem('glm_bypass_cfg', JSON.stringify(CFG));
      GM_setValue('glm_bypass_captcha_server', CFG.captchaServer);
      checkOcrHealth();
    };

    $('sel-plan').onchange = function () {
      if (!CFG.planPriority) CFG.planPriority = [{}];
      if (!CFG.planPriority[0]) CFG.planPriority[0] = {};
      CFG.planPriority[0].plan = this.value;
      localStorage.setItem('glm_bypass_cfg', JSON.stringify(CFG));
      log(`[配置] 已将抢购首选套餐设置为: ${this.value.toUpperCase()}`);
      refreshUI();
    };
    $('sel-period').onchange = function () {
      if (!CFG.planPriority) CFG.planPriority = [{}];
      if (!CFG.planPriority[0]) CFG.planPriority[0] = {};
      CFG.planPriority[0].billingPeriod = this.value;
      localStorage.setItem('glm_bypass_cfg', JSON.stringify(CFG));
      log(`[配置] 已将抢购首选周期设置为: ${this.value === 'quarterly' ? '连续包季' : this.value === 'yearly' ? '连续包年' : '连续包月'}`);
      refreshUI();
    };

    $('min-btn').onclick = function () {
      const sect = $('body-section');
      const hidden = sect.style.display === 'none';
      sect.style.display = hidden ? '' : 'none';
      this.textContent = hidden ? '_' : '+';
    };

    let sx, sy, sl, st;
    $('drag-bar').onmousedown = function (e) {
      sx = e.clientX; sy = e.clientY;
      const rect = host.getBoundingClientRect();
      sl = rect.left; st = rect.top;
      const onMove = (evt) => {
        host.style.left = (sl + evt.clientX - sx) + 'px';
        host.style.top = (st + evt.clientY - sy) + 'px';
        host.style.right = 'auto';
        host.style.position = 'fixed';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    _shadowRef = shadow;
    log('glm_bypass 面板已就绪。');
    if (state.captured) log('已从内存中读取捕获的 preview 请求参数，可直接抢购！');

    setupDialogWatcher();
    calibrateClock();
    updateMasterStatusDisplay();
    setTimeout(autoFetchProductIds, 500);
    checkOcrHealth();

    // 自动设定10:00定时抢购（或立即激活）
    const now = serverNow();
    const target = new Date(now);
    target.setHours(CFG.targetHour, CFG.targetMinute, 0, 0);
    const timeStr = `${String(CFG.targetHour).padStart(2,'0')}:${String(CFG.targetMinute).padStart(2,'0')}:00`;
    if (target > now) {
      // 还没到10点，自动设定定时
      scheduleAt(timeStr);
    } else if (now.getTime() - target.getTime() < 300000) {
      // 10点后5分钟内，立即激活
      log(`[自动激活] 已过10:00不到5分钟，立即开始抢购！`);
      startProactive();
    }
    // 超过5分钟则不自动激活，等用户手动操作

    // 监听购买按钮的手动点击，自动激活抢购
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button, [role="button"]');
      if (!btn) return;
      const t = btn.textContent.trim();
      if (/特惠订阅|订阅升级|购买|下单/.test(t) && t.length < 15) {
        if (!_rushActive && !_rushStopped && !_paymentFrozen && !_wafBlocked) {
          _rushActive = true;
          log('检测到手动点击购买按钮，自动激活抢购流程');
        }
      }
    }, true);

    if (Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ── 3J. UI 刷新 & 日志渲染 ───────────────────────────────────────
  let uiPending = false;

  function refreshUI() {
    if (uiPending) return;
    uiPending = true;
    requestAnimationFrame(() => {
      uiPending = false;
      const shadow = _shadowRef;
      if (!shadow) return;
      
      const $ = (id) => shadow.getElementById(id);

      const statusEl = $('lbl-status');
      if (statusEl) {
        statusEl.className = 'sts sts-' + state.status;
        const textEl = $('sts-text');
        if (textEl) {
          textEl.textContent = state.status === 'idle' ? 'STANDBY'
            : state.status === 'active' ? 'RUNNING'
            : state.status === 'success' ? `OK — ${state.bizId?.substring(0, 8)}...`
            : 'FAILED';
        }
      }






      const goBtn = $('btn-start');
      const stopBtn = $('btn-stop');
      const unfreezeBtn = $('btn-unfreeze');
      if (goBtn && stopBtn) {
        goBtn.style.display = _rushActive ? 'none' : '';
        stopBtn.style.display = _rushActive ? '' : 'none';
      }
      if (unfreezeBtn) unfreezeBtn.style.display = _paymentFrozen ? '' : 'none';
    });
  }

  function appendLogDOM(entry) {
    const shadow = _shadowRef;
    if (!shadow) return;
    const el = shadow.getElementById('log-list');
    if (!el) return;
    const div = document.createElement('div');
    div.className = `log-line log-${entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : entry.msg.includes('成功') ? 'success' : 'info'}`;
    div.textContent = `${entry.ts} ${entry.msg}`;
    el.appendChild(div);
    while (el.children.length > 500) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  window.addEventListener('beforeunload', e => {
    if (_rushActive) {
      e.preventDefault();
      e.returnValue = '抢购正在后台全力进行中，确定要离开吗？';
    }
  });

  // ── 3K. 支付检测 & 验证码状态机 ──────────────────────────────────
  //    统一状态机:
  //    IDLE → 验证码弹出 → SOLVING → 点击确定 → WAITING_RESULT
  //      → 验证码消失 + 支付弹窗出现 → SUCCESS (冻结，保护支付)
  //      → 验证码消失 + 错误弹窗出现 → FAIL (关闭弹窗，重新购买)
  //      → 验证码消失 + 什么都没有   → MAYBE_RETRY (等待后重试购买)
  //      → 验证码错误提示           → FAIL (刷新验证码，重新识别)
  //      → 等待超时                 → TIMEOUT (刷新验证码)
  //
  //  铁律: 支付二维码可见 = 一切自动化停止
  // ═══════════════════════════════════════════════════════════════════
  const CAPTCHA_STATE = { IDLE: 0, SOLVING: 1, WAITING: 2 };
  let _captchaState = CAPTCHA_STATE.IDLE;
  let _captchaLastBgUrl = '';
  let _captchaLastChars = '';    // 上次已提交的验证码提示文字
  let _captchaSkipCount = 0;     // 连续因相同验证码而跳过的次数
  let _captchaAttempt = 0;
  let _captchaProcessing = false; // 防止并发处理的锁
  let _captchaWaitStart = 0;
  let _qrRetryEpoch = 0; // 渐进重试轮次号，每轮+1，旧计时器检测到不匹配自动停止
  let _paymentFrozen = false;
  let _captchaPresolved = false;
  let _captchaPreconfirmEl = null;
  let _captchaQrRetried = false;
  let _captchaCallbackResult = ''; // 'success' | 'error' | '' — 验证码SDK回调结果
  let _lastPreviewResult = '';     // '555' | 'soldOut' | 'error' | 'ok' | '' — preview API响应码
  let _previewRetryTimer = null;   // preview失败时自动重试的定时器
  const CAPTCHA_MAX_ATTEMPT = 6;
  const CAPTCHA_WAIT_TIMEOUT = 4000; // 验证码提交后4秒无结果即刷新（高峰期放宽）

  // ── 并行Ticket复用重试引擎 ──
  let _retryEngineActive = false;
  let _retryEngineEpoch = 0;              // 每次启动+1，孤儿回调检测不匹配自动停止
  let _retryEngineTickets = [];           // Array<{body, headers, capturedAt}>
  let _retryEngineBatchTimer = null;
  let _retryEngineInflight = 0;
  let _retryEngineSuccessResult = null;   // {text, data} 完整成功响应
  let _retryEngineTotalAttempts = 0;
  let _retryEngineStartTime = 0;
  let _wafBlocked = false; // WAF 405拦截标记，停止一切并提示刷新

  // ── 3K-1. 支付冻结机制 ──
  let _frozenAt = 0; // 冻结时间戳

  function freezeForPayment(msg) {
    if (_paymentFrozen) return;
    if (_retryEngineActive) retryEngineStop('支付冻结');
    _paymentFrozen = true;
    _frozenAt = Date.now();
    _captchaState = CAPTCHA_STATE.IDLE;
    _captchaAttempt = 0;
    _emptyPayDialogCount = 0;
    _rushActive = false;
    setState({ status: 'success', count: (state.count || 0) + 1 });
    // 注意：不清空 _captchaLastBgUrl！
    // 如果弹窗是空白的，解冻后不应重新识别同一验证码
    log(msg || '✅ 支付界面出现，冻结所有自动化！');
    // 记录触发冻结的元素，方便排查（只检测支付弹窗内元素）
    const payEls = [];
    const payDialog = document.querySelector('.el-dialog.pay-dialog');
    if (payDialog) {
      const canvas = payDialog.querySelector('canvas');
      const price = payDialog.querySelector('.info-price span:last-child');
      payEls.push(`pay-dialog=visible`);
      payEls.push(`canvas=${canvas ? canvas.width + 'x' + canvas.height : 'none'}`);
      payEls.push(`price="${price?.textContent?.trim() || ''}"`);
    }
    if (payEls.length) log(`[冻结检测] ${payEls.join(', ')}`);
    else log('[冻结检测] 未找到支付弹窗元素');
    // 浏览器通知
    try { new Notification('glm_bypass 抢购成功!', { body: '请尽快完成支付' }); } catch {}
    // 声音提醒: 3 声 880Hz 蜂鸣
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < 3; i++) {
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.value = 0.3;
        osc.start(actx.currentTime + i * 0.4);
        osc.stop(actx.currentTime + i * 0.4 + 0.15);
      }
    } catch {}
  }

  // ── 并行Ticket复用重试引擎 ──
  // preview返回555/500时，复用当前ticket高频重发，同时继续走验证码拿新ticket

  function retryEngineStart(initialCaptured) {
    if (_retryEngineActive) {
      retryEngineAddTicket(initialCaptured);
      return;
    }
    if (!initialCaptured?.body) { log('[重试引擎] 无请求体，跳过', 'warn'); return; }
    if (initialCaptured.body.includes('trerror')) { log('[重试引擎] trerror ticket，跳过', 'warn'); return; }

    _retryEngineActive = true;
    _retryEngineEpoch++;
    _retryEngineStartTime = Date.now();
    _retryEngineSuccessResult = null;
    _retryEngineTotalAttempts = 0;
    _retryEngineInflight = 0;
    _retryEngineTickets = [{
      body: initialCaptured.body,
      headers: initialCaptured.headers || {},
      capturedAt: Date.now()
    }];

    log(`[重试引擎] 启动 epoch=${_retryEngineEpoch} 间隔=${CFG.retryIntervalMs}ms`);

    // 立即发射第一个请求
    retryEngineFireOne();

    // 定时均匀发射
    _retryEngineBatchTimer = setInterval(retryEngineFireOne, CFG.retryIntervalMs);
  }

  function retryEngineStop(reason) {
    if (!_retryEngineActive && !_retryEngineBatchTimer) return;
    log(`[重试引擎] 停止: ${reason}，总尝试=${_retryEngineTotalAttempts}，耗时=${Date.now() - _retryEngineStartTime}ms`);
    _retryEngineActive = false;
    _retryEngineEpoch++; // 使孤儿回调失效
    if (_retryEngineBatchTimer) { clearInterval(_retryEngineBatchTimer); _retryEngineBatchTimer = null; }
    _retryEngineTickets = [];
    _retryEngineInflight = 0;
  }

  function retryEngineCleanup() {
    retryEngineStop('清理');
    _retryEngineSuccessResult = null;
    _retryEngineTotalAttempts = 0;
    _retryEngineStartTime = 0;
  }

  function retryEngineAddTicket(captured) {
    if (!_retryEngineActive) return;
    if (!captured?.body) return;
    if (captured.body.includes('trerror')) { log('[重试引擎] 跳过trerror ticket'); return; }
    // 去重
    if (_retryEngineTickets.some(t => t.body === captured.body)) return;
    _retryEngineTickets.push({
      body: captured.body,
      headers: captured.headers || {},
      capturedAt: Date.now()
    });
    log(`[重试引擎] 新ticket入池，池大小=${_retryEngineTickets.length}`);
  }

  function retryEngineFireOne() {
    if (_rushStopped) { retryEngineStop('用户停止'); return; }
    if (_paymentFrozen) { retryEngineStop('支付已冻结'); return; }
    if (!_retryEngineActive) return;
    if (_retryEngineSuccessResult) { retryEngineStop('已成功'); return; }

    // 修剪过期ticket
    const now = Date.now();
    _retryEngineTickets = _retryEngineTickets.filter(t => (now - t.capturedAt) < CFG.retryTicketTTL);
    if (_retryEngineTickets.length === 0) return;

    // 最多1个在途，保证均匀
    if (_retryEngineInflight >= 1) return;

    // Round-robin选ticket
    const ticket = _retryEngineTickets[_retryEngineTotalAttempts % _retryEngineTickets.length];
    retryEngineFireSingle(ticket);

    // 每10次打印日志
    if (_retryEngineTotalAttempts % 10 === 0) {
      log(`[重试引擎] 总计=${_retryEngineTotalAttempts}, 池=${_retryEngineTickets.length}`);
    }
  }

  async function retryEngineFireSingle(ticket) {
    const myEpoch = _retryEngineEpoch;
    _retryEngineInflight++;
    _retryEngineTotalAttempts++;

    try {
      const url = (state.captured?.url) || (location.origin + '/api/biz/pay/preview');
      const fResult = await fetchWithTimeout(url, {
        method: 'POST',
        body: ticket.body,
        headers: { ...ticket.headers },
        credentials: 'include'
      }, CFG.retryTimeout);

      if (myEpoch !== _retryEngineEpoch) { _retryEngineInflight--; return; }

      // WAF 405检测：retryEngine绕过拦截器，需自行检测
      if (!fResult.ok && (fResult.resp.status === 405 || fResult.resp.status === 403)) {
        try {
          const body = await fResult.resp.text();
          if (body.trimStart().startsWith('<!') || body.includes('<html')) {
            _wafBlocked = true;
            log('⛔ IP被WAF拦截(405)，更换IP后刷新页面重试！');
            retryEngineStop('WAF拦截');
            return;
          }
        } catch (_) {}
        _retryEngineInflight--;
        return;
      }
      if (!fResult.ok) { _retryEngineInflight--; return; }

      const text = await fResult.resp.text();
      if (myEpoch !== _retryEngineEpoch) { _retryEngineInflight--; return; }

      const respObj = _parse(text);
      const code = respObj?.code;
      const data = respObj?.data;

      if (code === 200 && data?.bizId) {
        retryEngineHandleSuccess(text, respObj);
        return; // retryEngineStop已重置inflight，不重复递减
      }
      // 555/500/其他：ticket留在池中继续用
    } catch (e) {
      // 网络/解析错误，忽略
    }
    _retryEngineInflight--;
  }

  function retryEngineHandleSuccess(responseText, respObj) {
    if (_retryEngineSuccessResult) return; // 第一赢家锁定
    _retryEngineSuccessResult = { text: responseText, data: respObj };
    const bizId = respObj?.data?.bizId || '';
    log(`[重试引擎] ✅ 成功! bizId=${bizId.substring(0, 8)}... 总尝试=${_retryEngineTotalAttempts} 耗时=${Date.now() - _retryEngineStartTime}ms`);

    // 停止引擎
    retryEngineStop('成功');

    // 保存到state，让Vue下一次preview请求拿到成功响应
    state.cache = { text: responseText };
    state.lastSuccess = { text: responseText };
    setState({ status: 'success', bizId: bizId });

    // 持久化到sessionStorage
    try { sessionStorage.setItem('glm_bypass_last_success', JSON.stringify({ text: responseText, bizId, ts: Date.now() })); } catch {}

    // 通知其他标签页
    try {
      if (typeof channel !== 'undefined' && channel?.postMessage) {
        channel.postMessage({ type: 'GLM_BYPASS_SUCCESS', tabId: typeof tabId !== 'undefined' ? tabId : 0, bizId });
      }
    } catch {}

    // 触发支付弹窗：点击购买按钮让Vue发preview → fetch拦截器返回state.cache → Vue弹支付弹窗
    setTimeout(() => {
      if (_rushStopped || _paymentFrozen) return;
      const btn = findBuyButton();
      if (btn) {
        log('[重试引擎] 点击购买按钮触发Vue支付流程');
        btn.click();
      }
    }, 500);
  }

  // ── 3K-2. 支付 UI 检测 ──
  // 支付弹窗检测
  function isPaymentUIVisible() {
    // 策略1: 找到可见的 .pay-dialog
    const wrappers = document.querySelectorAll('.el-dialog__wrapper');
    for (const wrapper of wrappers) {
      const wrapperStyle = wrapper.getAttribute('style') || '';
      if (wrapperStyle.includes('display: none') || wrapperStyle.includes('display:none')) continue;
      const cs = getComputedStyle(wrapper);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const dialog = wrapper.querySelector('.el-dialog.pay-dialog');
      if (dialog && visible(dialog)) {
        // 排除"人数较多"错误弹窗
        if ((wrapper.innerText || '').includes('当前购买人数较多')) continue;
        // 排除小飞机（系统繁忙）弹窗
        if (dialog.querySelector('.empty-data-wrap, .empty-data')) continue;
        // 确认有支付内容
        const hasPayContent = dialog.querySelector('.scan-code-box, .scan-qrcode-box, .pay-model, .code-pic-box');
        if (hasPayContent) return true;
      }
    }

    // 策略2: Vue payDialogVisible === true（仅作辅助，上面DOM检测已覆盖主要场景）
    const app = document.querySelector('#app');
    const vue = app && app.__vue__;
    if (vue) {
      let found = false;
      const walk = (vm, depth) => {
        if (found || depth > 8) return;
        if (vm.$data && vm.$data.payDialogVisible === true) { found = true; return; }
        for (const child of (vm.$children || [])) { walk(child, depth + 1); if (found) return; }
      };
      walk(vue, 0);
      if (found) return true;
    }

    // 策略3: 支付 iframe
    for (const el of document.querySelectorAll('iframe')) {
      const src = (el.src || '').toLowerCase();
      if ((src.includes('cashier') || src.includes('alipay') || src.includes('pay')) && visible(el)) return true;
    }

    // 策略4: 检查 fallback 二维码
    if (document.querySelector('#close-qr-fallback')) return true;
    return false;
  }

  // ── 3K-3. 错误弹窗检测 ──
  function isErrorDialogVisible() {
    const sels = [
      '.el-dialog', '.el-message-box', '.el-dialog__wrapper',
      '.ant-modal', '.ant-modal-wrap', '[class*="modal"]', '[class*="dialog"]',
    ];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
        if (/购买人数过多|系统繁忙|稍后再试|请重试|繁忙|失败|出错|异常|售罄|已售完/.test(el.textContent || '')) return el;
      }
    }
    return null;
  }

  // ── 3K-4. 验证码可见性检测 (DOM 查询) ──
  function mainPageCaptchaVisible() {
    // 1. 查找遮罩层/弹窗容器 — 必须真正弹出
    const modalSelectors = [
      '.tencent-captcha-dy__overlay',
      '.tencent-captcha-dy__mask',
      '.tcaptcha-overlay',
      '#tcaptcha_transform_dy',
    ];
    let modalEl = null;
    for (const sel of modalSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const s = getComputedStyle(el);
        if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) !== 0) {
          modalEl = el;
          break;
        }
      }
    }
    // 2. 查找弹窗主体
    const contentEl = document.querySelector('.tencent-captcha-dy__content');
    if (!contentEl) return false;
    const cs = getComputedStyle(contentEl);
    if (cs.display === 'none' || cs.visibility === 'hidden' || contentEl.offsetWidth < 50) return false;

    // 3. 最关键：必须有实际可见的背景图（有 background-image URL）
    const bgEl = mainPageFindBgEl();
    if (!bgEl) return false;
    const bgText = (bgEl.style && bgEl.style.backgroundImage ? bgEl.style.backgroundImage : '') || getComputedStyle(bgEl).backgroundImage || '';
    if (!bgText || bgText === 'none') return false;
    const hasUrl = /url\(/.test(bgText);
    if (!hasUrl) return false;

    // 4. 提示文字必须包含"请依次点击"或类似引导语（排除"完成验证"等按钮文字）
    const promptEl = document.querySelector('.tencent-captcha-dy__header-text, [class*="header-text"]');
    if (!promptEl) return false;
    const promptRaw = promptEl.textContent || '';
    if (!/请.*点击|请.*选择/.test(promptRaw)) return false;

    return true;
  }

  // ── 3K-5. 验证码元素查找 (背景图/URL/提示文字/点击) ──
  function mainPageFindBgEl() {
    const selectors = [
      '.tencent-captcha-dy__verify-bg-img',
      '[class*="verify-bg-img"]',
      '[class*="captcha-bg"]',
      '#slideBg',
      '[class*="verify-bg"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 0) return el;
    }
    return null;
  }

  function mainPageFindBgUrl() {
    const selectors = [
      '.tencent-captcha-dy__verify-bg-img',
      '[class*="verify-bg-img"]',
      '[class*="captcha-bg"]',
      '#slideBg',
      '[class*="verify-bg"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // 尝试 background-image
      const bgText = (el.style && el.style.backgroundImage ? el.style.backgroundImage : '') || getComputedStyle(el).backgroundImage || '';
      const match = bgText.match(/url\(["']?([^"')]+)["']?\)/);
      if (match) {
        try { return new URL(match[1], location.href).href; } catch { return match[1]; }
      }

      // 尝试 src 属性 (img 标签)
      if (el.src && el.tagName === 'IMG') {
        try { return new URL(el.src, location.href).href; } catch { return el.src; }
      }
    }
    return '';
  }

  function mainPageFindPromptText() {
    const selectors = [
      '.tencent-captcha-dy__header-text',
      '[class*="header-text"]',
      '#instructionText',
      '[class*="captcha-prompt"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const raw = (el.textContent || el.getAttribute('aria-label') || '').trim();
      // 严格模式：只从 "请依次点击：XXX" 或 "请点击：XXX" 之后提取
      // 支持冒号、空格、换行分隔
      const afterClick = raw.match(/(?:请依次点击|请点击|请按顺序点击)[：:\s]*(.+)/);
      if (afterClick) {
        const chars = (afterClick[1].match(/[\u4e00-\u9fff]/g) || []).slice(0, 3);
        if (chars.length >= 3) return chars.join('');
      }
      // 备用：找所有独立汉字（排除常见引导词）
      const allChars = (raw.match(/[\u4e00-\u9fff]/g) || []);
      const stopWords = ['请','依','次','点','击','选','按','顺','序','完','成','验','证'];
      const filtered = allChars.filter(c => !stopWords.includes(c));
      if (filtered.length >= 3) return filtered.slice(0, 3).join('');
    }
    return '';
  }

  function mainPageDispatchClick(el, nx, ny, label) {
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + nx * rect.width;
    const clientY = rect.top + ny * rect.height;
    const win = el.ownerDocument.defaultView;
    const base = { bubbles: true, cancelable: true, view: win, clientX, clientY, button: 0, buttons: 1 };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0.5 };
    try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerdown', pointer)); } catch {}
    el.dispatchEvent(new win.MouseEvent('mousedown', base));
    try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerup', pointer)); } catch {}
    el.dispatchEvent(new win.MouseEvent('mouseup', base));
    el.dispatchEvent(new win.MouseEvent('click', base));
    log(`[主页面验证码] 模拟点击 "${label}" @ (${nx.toFixed(3)}, ${ny.toFixed(3)})`);
  }

  // ── 3K-6. 验证码自动识别主流程 (OCR → 模拟点击 → 提交) ──
  async function mainPageSolveCaptcha() {
    if (_rushStopped || _captchaState !== CAPTCHA_STATE.IDLE || _paymentFrozen) return;
    if (_captchaProcessing) return; // 防止并发处理

    _captchaProcessing = true;
    _captchaState = CAPTCHA_STATE.SOLVING;
    _captchaCallbackResult = ''; // 重置SDK回调结果

    try {
      // ── 1. 查找验证码图片元素 ──
      const bgEl = mainPageFindBgEl();
      if (!bgEl) { _captchaState = CAPTCHA_STATE.IDLE; _captchaProcessing = false; return; }

      // ── 2. 提取背景图 URL ──
      const bgUrl = mainPageFindBgUrl();
      if (!bgUrl) {
        // 刷新动画期间 URL 被清空，Observer 提前触发导致空跑。
        // 不放弃，等图片加载完成后 Observer/定时器会自然再次触发。
        _captchaState = CAPTCHA_STATE.IDLE;
        _captchaProcessing = false;
        return;
      }

      // ── 3. 提取提示文字 ──
      const chars = mainPageFindPromptText();
      if (chars.length < 3) {
        const headerEl = document.querySelector('.tencent-captcha-dy__header, [class*="captcha-header"]');
        if (headerEl) log(`[主页面验证码] header 原始文本: "${headerEl.textContent.trim()}"`);
        _captchaState = CAPTCHA_STATE.IDLE;
        _captchaProcessing = false;
        return;
      }

      // ── 4. 检测重复验证码（URL相同 或 提示文字相同 = ticket已消费） ──
      const sameUrl = bgUrl === _captchaLastBgUrl;
      const sameChars = chars === _captchaLastChars && _captchaLastChars !== '';
      if (sameUrl || sameChars) {
        _captchaSkipCount++;
        if (_captchaSkipCount >= 3) {
          // 刷新3次仍是同一张 → 关闭验证码弹窗，重新点击购买按钮
          log(`[主页面验证码] 连续3次相同验证码(文字:${chars})，关闭弹窗重新购买`, 'warn');
          _captchaSkipCount = 0;
          // 不清空 _captchaLastChars！防止重新识别同一验证码
          _captchaState = CAPTCHA_STATE.IDLE;
          // 关闭验证码弹窗
          try {
            const captchaClose = document.querySelector('.tencent-captcha-dy__close-btn') ||
              document.querySelector('#tcaptcha_transform_dy .close-btn');
            if (captchaClose) captchaClose.click();
          } catch (e) {}
          // 延迟后重新点击购买按钮（会触发全新验证码会话）
          setTimeout(() => {
            _captchaProcessing = false;
            _captchaLastBgUrl = '';
            _captchaLastChars = '';
            if (_rushStopped) return;
            const btn = findBuyButton();
            if (btn && _rushActive) {
              btn.click();
              log('[验证码] 已关闭旧弹窗并重新点击购买');
            }
          }, 500);
          return;
        }
        const reason = sameChars ? `文字"${chars}"相同` : 'URL相同';
        log(`[主页面验证码] ${reason}(ticket已消费)，第${_captchaSkipCount}次刷新`);
        _captchaState = CAPTCHA_STATE.IDLE;
        // 手动刷新，不清空 _captchaLastBgUrl 和 _captchaLastChars，以便检测刷新后是否仍是同一张
        const refreshBtn = document.querySelector('.tencent-captcha-dy__footer-icon--refresh img, [class*="refresh"] img, #reload');
        if (refreshBtn) { refreshBtn.click(); log('[验证码] 已刷新'); }
        // 延迟解锁，给刷新加载新图片的时间
        setTimeout(() => { if (_rushStopped) return; _captchaProcessing = false; }, 800);
        return;
      }

      // 新验证码，重置跳过计数
      _captchaSkipCount = 0;
      _captchaLastBgUrl = bgUrl;
      _captchaLastChars = chars;
      _captchaAttempt++;
      log(`[主页面验证码] 第 ${_captchaAttempt} 次识别 — 提示: "${chars}"`);

      // ── 4. 获取图片数据（优先 canvas 直接提取，跳过网络下载） ──
      let dataUrl = '';

      // 方案 A（最快）: canvas 直接从 DOM 元素绘制，零网络开销
      try {
        const cvs = document.createElement('canvas');
        const rect = bgEl.getBoundingClientRect();
        cvs.width = rect.width || 344;
        cvs.height = rect.height || 344;
        const ctx = cvs.getContext('2d');
        // 如果是 img 标签，直接 drawImage
        if (bgEl.tagName === 'IMG' && bgEl.complete && bgEl.naturalWidth > 0) {
          ctx.drawImage(bgEl, 0, 0, cvs.width, cvs.height);
          dataUrl = cvs.toDataURL('image/jpeg', 0.85);
        }
        // 如果是带 background-image 的 div，用 Image 对象加载
        if (!dataUrl && bgUrl) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          dataUrl = await new Promise((resolve, reject) => {
            const tid = setTimeout(() => reject(new Error('img加载超时')), 3000);
            img.onload = () => {
              clearTimeout(tid);
              try {
                ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
                resolve(cvs.toDataURL('image/jpeg', 0.85));
              } catch (e) { reject(e); }
            };
            img.onerror = () => { clearTimeout(tid); reject(new Error('img加载失败')); };
            img.src = bgUrl;
          });
        }
      } catch (canvasErr) {
        log(`[主页面验证码] canvas提取失败: ${canvasErr.message}，回退网络下载`);
      }

      // 方案 B（兜底）: 通过 GM_xmlhttpRequest 网络下载
      if (!dataUrl) {
        try {
          dataUrl = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('图片下载超时')), 8000);
            if (typeof GM_xmlhttpRequest !== 'undefined') {
              GM_xmlhttpRequest({
                method: 'GET', url: bgUrl, responseType: 'blob',
                onload: (res) => {
                  clearTimeout(timeout);
                  if (res.status && res.status !== 200) { reject(new Error(`HTTP ${res.status}`)); return; }
                  if (!res.response || res.response.size < 100) { reject(new Error(`数据异常`)); return; }
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result);
                  reader.onerror = () => reject(new Error('FileReader 失败'));
                  reader.readAsDataURL(res.response);
                },
                onerror: () => { clearTimeout(timeout); reject(new Error('图片下载失败')); },
              });
            } else {
              fetch(bgUrl, { mode: 'cors', credentials: 'include' })
                .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
                .then(blob => {
                  clearTimeout(timeout);
                  if (blob.size < 100) throw new Error('blob太小');
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result);
                  reader.readAsDataURL(blob);
                })
                .catch(err => { clearTimeout(timeout); reject(err); });
            }
          });
        } catch (imgErr) {
          log(`[主页面验证码] 图片获取失败: ${imgErr.message}`);
        }
      }

      if (!dataUrl) { _captchaLastBgUrl = ''; _captchaState = CAPTCHA_STATE.IDLE; _captchaProcessing = false; return; }

      // ── 5. 调用 OCR 服务 ──
      const server = CFG.captchaServer.replace(/\/$/, '');
      const payload = JSON.stringify({ image: dataUrl, text: chars, remark: chars, ts: Date.now() });

      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('OCR 超时(8s)')), 8000);
        if (typeof GM_xmlhttpRequest !== 'undefined') {
          GM_xmlhttpRequest({
            method: 'POST', url: `${server}/captcha_direct`,
            headers: { 'Content-Type': 'application/json' }, data: payload,
            onload: (res) => {
              clearTimeout(timeout);
              try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(new Error('响应解析失败')); }
            },
            onerror: () => { clearTimeout(timeout); reject(new Error('OCR 连接失败')); },
          });
        } else {
          fetch(`${server}/captcha_direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
            .then(r => { clearTimeout(timeout); return r.json(); }).then(resolve).catch(err => { clearTimeout(timeout); reject(err); });
        }
      });

      // ── 6. 解析坐标 ──
      let coords = [];
      if (response.success && response.result && Array.isArray(response.result.click_coords)) {
        coords = response.result.click_coords;
      } else if (response.success && response.data && response.data.result) {
        const raw = response.data.result.split('|');
        coords = raw.map((p, idx) => {
          const xy = p.split(',');
          return { char: chars[idx] || '', nx: parseFloat(xy[0]) / 344.0, ny: parseFloat(xy[1]) / 344.0 };
        });
      }

      if (!coords || coords.length === 0) {
        log('[主页面验证码] OCR 未识别出有效坐标，刷新重试');
        captchaRefresh();
        return;
      }

      log(`[主页面验证码] 坐标: ${coords.map(c => `${c.char}(${c.nx.toFixed(2)},${c.ny.toFixed(2)})`).join(' ')}`);

      // ── 7. 模拟点击 ──
      for (const pt of coords) {
        const nx = Number(pt.nx), ny = Number(pt.ny);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
        mainPageDispatchClick(bgEl, nx, ny, pt.char || '');
        await sleep(150); // 150ms间隔，足够SDK响应
      }

      // ── 8. 点击确定 → 进入等待状态 ──
      await sleep(200);
      const confirmBtn = document.querySelector('.tencent-captcha-dy__verify-confirm-btn:not(.tencent-captcha-dy__verify-confirm-btn--disabled)');
      if (confirmBtn) {
        confirmBtn.click();
        _captchaState = CAPTCHA_STATE.WAITING;
        _captchaWaitStart = Date.now();
        // _captchaProcessing 保持 true，直到 SDK 回调后才解锁
        log('[主页面验证码] 已点击确定，等待验证结果...');
      } else {
        _captchaState = CAPTCHA_STATE.IDLE;
        _captchaLastBgUrl = '';
        _captchaProcessing = false;
      }
    } catch (e) {
      log(`[主页面验证码] 异常: ${e.message}`);
      _captchaLastBgUrl = '';
      _captchaState = CAPTCHA_STATE.IDLE;
      _captchaProcessing = false;
    }
  }

  function captchaRefresh() {
    if (_rushStopped) { _captchaState = CAPTCHA_STATE.IDLE; _captchaProcessing = false; return; }
    if (_paymentFrozen) return;
    const refreshBtn = document.querySelector('.tencent-captcha-dy__footer-icon--refresh img, [class*="refresh"] img, #reload');
    if (refreshBtn) {
      refreshBtn.click();
      log('[验证码] 已刷新');
    }
    _captchaLastBgUrl = '';
    // 不清空 _captchaLastChars 和 _captchaSkipCount：
    // 超时刷新后若服务端返回同一张图，sameChars 检测能立即识别并累加 skipCount，
    // 满三次关闭弹窗重启，避免同一张验证码反复提交的死循环。
    // 只有真正不同的验证码出现时（chars 不同），2756 行才会重置这些值。
    _captchaState = CAPTCHA_STATE.IDLE;
    setTimeout(() => { if (_rushStopped) return; _captchaProcessing = false; }, 800);
  }

  // ── 3K-7. QR码检测 (双通道价格 + canvas + iframe) ──
  // QR码检测 (双通道价格 + canvas + iframe)
  function hasScannableQR() {
    // 策略1: 双通道价格检测
    // 真实支付弹窗必有金额，空白/错误弹窗金额为空
    const prices = readPayDialogPrices();
    if (prices.any) return true;

    // 策略2: canvas 非空白检测
    const qrCanvas = document.querySelector('.scan-qrcode-box canvas');
    if (qrCanvas && visible(qrCanvas) && checkCanvasContent(qrCanvas)) return true;

    // 策略3: 支付弹窗内所有 canvas
    for (const c of document.querySelectorAll('.pay-model canvas, .pay-dialog canvas')) {
      if (visible(c) && checkCanvasContent(c)) return true;
    }

    // 策略4: 支付 iframe
    for (const el of document.querySelectorAll('iframe')) {
      const src = (el.src || '').toLowerCase();
      if ((src.includes('cashier') || src.includes('alipay') || src.includes('wechatpay') || src.includes('wxpay')) && visible(el)) return true;
    }

    // 策略5: data URL 图片
    for (const img of document.querySelectorAll('.scan-qrcode-box img[src^="data:image"], .pay-model img[src^="data:image"]')) {
      if (img.width > 80 && img.height > 80 && visible(img)) return true;
    }

    log('[QR检测] 未检测到有效二维码内容（canvas空白、无价格、无iframe）');
    return false;
  }

  // 双通道读价格
  function readPayDialogPrices() {
    const dlg = document.querySelector('.pay-dialog');
    let scanPrice = 0, actualPrice = 0;

    // 通道A: 扫码区 .info-price 最后一个 span（纯数字）
    if (dlg) {
      const infoPrice = dlg.querySelector('.info-price');
      if (infoPrice) {
        const spans = infoPrice.querySelectorAll('span');
        for (let i = spans.length - 1; i >= 0; i--) {
          const v = parseFloat(spans[i].textContent.trim());
          if (!isNaN(v) && v > 0) { scanPrice = v; break; }
        }
      }
      // 通道B: 计算明细区"实付金额"
      dlg.querySelectorAll('.calculate-content-item').forEach(li => {
        if ([...li.querySelectorAll('div')].some(d => d.textContent.includes('实付金额'))) {
          const v = parseFloat((li.querySelector('.price-item')?.textContent || '').replace(/[￥,]/g, '').trim());
          if (!isNaN(v) && v > 0) actualPrice = v;
        }
      });
    }

    return { scanPrice, actualPrice, any: scanPrice > 0 || actualPrice > 0 };
  }

  // 辅助：检查 canvas 是否绘制了实际内容
  function checkCanvasContent(canvas) {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      const w = canvas.width, h = canvas.height;
      if (w <= 1 || h <= 1) return false;
      const imgData = ctx.getImageData(0, 0, w, h).data;
      let nonTransparent = 0;
      const step = 4; // 每4像素采样
      for (let i = 3; i < imgData.length; i += 4 * step) {
        if (imgData[i] > 0) nonTransparent++;
      }
      const total = imgData.length / (4 * step);
      if (total > 0 && nonTransparent / total > 0.03) {
        log(`[QR检测] canvas有内容: ${w}x${h}, 非透明像素比例=${(nonTransparent/total*100).toFixed(1)}%`);
        return true;
      }
    } catch (e) {
      // 跨域canvas无法读取 → 用尺寸判断
      if (canvas.width > 50 && canvas.height > 50) {
        log(`[QR检测] canvas跨域无法读取像素但有尺寸 ${canvas.width}x${canvas.height}，假设有内容`);
        return true;
      }
    }
    return false;
  }

  // ── 3K-8. 空弹窗关闭 & 重试 ──
  function isPaymentLoading() {
    // 检查 spinner / loading 动画
    const loadingSels = [
      '.scan-qrcode-box [class*="loading"]',
      '.scan-qrcode-box [class*="spinner"]',
      '.scan-qrcode-box [class*="skeleton"]',
      '.pay-model [class*="loading"]',
      '[class*="pay-dialog"] [class*="loading"]',
      '[class*="payDialog"] [class*="loading"]',
      '.el-loading-mask',
      '.el-loading-spinner',
    ];
    for (const sel of loadingSels) {
      const el = document.querySelector(sel);
      if (el && visible(el)) return true;
    }
    // 检查 canvas 尺寸是否为 0（未初始化）
    const qrCanvas = document.querySelector('.scan-qrcode-box canvas');
    if (qrCanvas && qrCanvas.width <= 1 && qrCanvas.height <= 1) return true;
    return false;
  }

  let _emptyPayDialogCount = 0; // 空弹窗重试计数
  const MAX_EMPTY_PAY_DIALOG = 3; // 最多重试3次

  // ── 3K-8a. Preview API失败 → 立即重试购买 ──
  function triggerPreviewRetry(reason) {
    // ═══ 并行重试引擎：复用当前ticket高频重发 ═══
    if (!_paymentFrozen && _rushActive && state.captured?.body && !state.captured.body.includes('trerror')) {
      if (!_retryEngineActive) {
        retryEngineStart(state.captured);
      } else {
        retryEngineAddTicket(state.captured);
      }
    }

    // ═══ 原有逻辑：关闭弹窗 + 继续走验证码拿新ticket ═══
    // 立即关闭弹窗（同步操作，不防抖）
    if (!_paymentFrozen) {
      const closeBtn = document.querySelector('[class*="pay-dialog"] [class*="close"], [class*="payDialog"] [class*="close"], [class*="pay-dialog"] .el-dialog__headerbtn, [class*="payDialog"] .el-dialog__headerbtn');
      if (closeBtn) { closeBtn.click(); }
      document.querySelectorAll('.el-overlay, .v-modal, .el-overlay-dialog').forEach(el => {
        el.style.display = 'none';
      });
      document.body.style.overflow = '';
    }

    // 异步点击购买按钮（防抖）
    if (_previewRetryTimer) return;
    _previewRetryTimer = setTimeout(() => {
      if (_rushStopped || _paymentFrozen || _retryEngineSuccessResult || !_rushActive) { _previewRetryTimer = null; return; }

      // 关闭当前验证码弹窗（确保干净的状态）
      try {
        const captchaClose = document.querySelector('.tencent-captcha-dy__close-btn') ||
          document.querySelector('#tcaptcha_transform_dy .close-btn');
        if (captchaClose) captchaClose.click();
      } catch (e) {}

      // 重置验证码状态，允许重新触发验证码识别
      _captchaState = CAPTCHA_STATE.IDLE;
      // 不清空 _captchaLastBgUrl 和 _captchaLastChars！防止重新识别同一张验证码图
      _captchaSkipCount = 0;
      _captchaAttempt = 0; // preview失败不是OCR的问题，重置计数
      _captchaQrRetried = false;
      _qrRetryEpoch++;
      _emptyPayDialogCount = 0;

      // 点击购买按钮（会触发全新的验证码 → 新的ticket → 新的preview请求）
      const btn = findBuyButton();
      if (btn) {
        btn.click();
        log(`[Preview重试] 原因:${reason}，已点击购买按钮`);
      } else {
        log(`[Preview重试] 原因:${reason}，未找到购买按钮`, 'warn');
      }
      // 点击购买后延迟解锁，给验证码加载时间
      // 冷却期：1200ms 内不允许新的 preview 重试
      setTimeout(() => {
        if (!_rushStopped) _captchaProcessing = false;
        _previewRetryTimer = null; // 冷却结束，允许下一次重试
      }, 1200);
    }, 100); // 100ms防抖
  }
  function closeEmptyPayDialog() {
    if (_rushStopped) { _captchaState = CAPTCHA_STATE.IDLE; _captchaProcessing = false; return; }
    _emptyPayDialogCount++;
    _captchaState = 0; // IDLE
    // 延迟解锁，防止关闭后立即触发新识别
    setTimeout(() => { if (_rushStopped) return; _captchaProcessing = false; }, 600);
    // 不立刻清空 _captchaLastBgUrl！防止重新识别同一验证码

    if (_emptyPayDialogCount > MAX_EMPTY_PAY_DIALOG) {
      log(`[空弹窗] 已连续 ${_emptyPayDialogCount} 次空弹窗，停止自动重试，请手动处理`, 'warn');
      _captchaLastBgUrl = ''; // 最终清空，允许手动操作后继续
      _captchaLastChars = '';
      if (_paymentFrozen) {
        _paymentFrozen = false;
        _frozenAt = 0;
      }
      return;
    }

    // 关键：解除冻结，否则后续验证码无法自动识别
    if (_paymentFrozen) {
      _paymentFrozen = false;
      _frozenAt = 0;
      log(`[空弹窗] 第 ${_emptyPayDialogCount}/${MAX_EMPTY_PAY_DIALOG} 次解除冻结`);
    }
    // 关闭支付弹窗
    const closeBtn = document.querySelector('[class*="pay-dialog"] [class*="close"], [class*="payDialog"] [class*="close"], [class*="pay-dialog"] .el-dialog__headerbtn, [class*="payDialog"] .el-dialog__headerbtn');
    if (closeBtn) { closeBtn.click(); log('[空弹窗] 已关闭空支付弹窗'); }
    // 清理遮罩
    document.querySelectorAll('.el-overlay, .v-modal, .el-overlay-dialog').forEach(el => el.style.display = 'none');
    document.body.style.overflow = '';
    // 重置 Vue 支付弹窗状态
    const app = document.querySelector('#app');
    const vue = app && app.__vue__;
    if (vue) {
      const walk = (vm, d) => {
        if (d > 8) return;
        if (vm.$data && 'payDialogVisible' in vm.$data) { vm.payDialogVisible = false; return; }
        for (const c of (vm.$children || [])) walk(c, d + 1);
      };
      walk(vue, 0);
    }
    _captchaQrRetried = false;
    // 关闭验证码弹窗
    try {
      const captchaClose = document.querySelector('.tencent-captcha-dy__close-btn') ||
        document.querySelector('#tcaptcha_transform_dy .close-btn');
      if (captchaClose) captchaClose.click();
    } catch (e) {}
    // 延迟后清空URL缓存 + 重新点击购买（给验证码关闭+新验证码加载的时间）
    setTimeout(() => {
      _captchaLastBgUrl = '';
      _captchaLastChars = '';
      _captchaSkipCount = 0;
      log('[空弹窗] 已重置验证码缓存');
      if (_rushStopped) { log('[空弹窗] 已停止，不再重新点击购买'); return; }
      if (_rushActive) {
        const btn = findBuyButton();
        if (btn) { btn.click(); log(`[空弹窗] 第 ${_emptyPayDialogCount} 次重新点击购买按钮`); }
      } else {
        log('[空弹窗] 已停止抢购，不再重新点击购买');
      }
    }, 1500); // 1.5秒延迟后重试（原3秒，加速）
  }

  // ── 3K-9. 验证码结果判定 (captchaCheckResult) ──
  function captchaCheckResult() {
    if (_captchaState !== CAPTCHA_STATE.WAITING) return;
    if (_paymentFrozen) return;
    if (_rushStopped) { _captchaState = CAPTCHA_STATE.IDLE; _captchaProcessing = false; return; }

    // 重试引擎已成功 → 跳过验证码后续流程
    if (_retryEngineSuccessResult) {
      log('[验证码] 重试引擎已成功，跳过QR等待');
      _captchaState = CAPTCHA_STATE.IDLE;
      _captchaProcessing = false;
      return;
    }

    // ═══ 1. 先检查验证码SDK回调结果（最快最可靠） ═══
    if (_captchaCallbackResult === 'error') {
      log(`[验证码] SDK回调返回失败 (${_captchaAttempt}/${CAPTCHA_MAX_ATTEMPT})`);
      _captchaCallbackResult = ''; // 重置
      // 不在此处解锁！captchaRefresh() 会延迟解锁
      if (_captchaAttempt >= CAPTCHA_MAX_ATTEMPT) {
        log('[验证码] 已达最大重试次数，等待手动处理');
        _captchaAttempt = 0;
        _captchaState = CAPTCHA_STATE.IDLE;
        _captchaLastBgUrl = '';
        _captchaLastChars = '';
        _captchaProcessing = false; // 真正停止，解锁
        return;
      }
      captchaRefresh();
      return;
    }
    if (_captchaCallbackResult === 'success') {
      // 验证通过，跳到步骤3检查支付
      log('[验证码] SDK回调返回成功，检查支付结果...');
    } else {
      // ═══ 1b. 回调还没来，检查DOM错误提示 ═══
      // 验证码错误检测
      let hasVerifyError = false;

      // 方式A: 新版验证码错误提示
      const errEl = document.querySelector('.tencent-captcha-dy__verify-error-text, [class*="verify-error"]');
      if (errEl) {
        const es = getComputedStyle(errEl);
        if (es.display !== 'none' && es.visibility !== 'hidden' && errEl.offsetWidth > 0) {
          hasVerifyError = true;
        }
      }

      // 方式B: 旧版 #tcaptcha_note + .tc-note 可见性（参考 grabber 的 hasError）
      if (!hasVerifyError) {
        const noteEl = document.querySelector('#tcaptcha_note');
        if (noteEl) {
          const noteWrap = noteEl.closest('.tc-note');
          if (noteWrap && noteWrap.style.visibility !== 'hidden' && noteWrap.style.visibility !== '') {
            hasVerifyError = true;
          }
        }
      }

      if (hasVerifyError) {
        const errText = errEl ? errEl.textContent.trim() : '验证失败';
        log(`[验证码] DOM检测识别失败: "${errText}" (${_captchaAttempt}/${CAPTCHA_MAX_ATTEMPT})`);
        // 不在此处解锁！captchaRefresh() 会延迟解锁
        if (_captchaAttempt >= CAPTCHA_MAX_ATTEMPT) {
          log('[验证码] 已达最大重试次数，等待手动处理');
          _captchaAttempt = 0;
          _captchaState = CAPTCHA_STATE.IDLE;
          _captchaLastBgUrl = '';
          _captchaLastChars = '';
          _captchaProcessing = false; // 真正停止，解锁
          return;
        }
        captchaRefresh();
        return;
      }
    } // end of else (回调还没来)

    // ═══ 2. SDK回调成功时跳过容器检查，否则检查容器是否还在 ═══
    const sdkSuccess = _captchaCallbackResult === 'success';
    _captchaCallbackResult = ''; // 重置
    if (!sdkSuccess) {
      // 没收到success回调，检查容器
      const captchaContainer = document.querySelector(
        '.tencent-captcha-dy__content, .tencent-captcha-dy__overlay, #tcaptcha_transform_dy'
      );
      if (captchaContainer) {
        const cs = getComputedStyle(captchaContainer);
        const containerVisible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) !== 0;
        if (containerVisible) {
          // 容器可见 = 验证码还在（可能是转圈中/刷新中/等待结果）
          // 超时检查
          if (Date.now() - _captchaWaitStart > CAPTCHA_WAIT_TIMEOUT) {
            log(`[验证码] 等待超时 (${CAPTCHA_WAIT_TIMEOUT / 1000}s)，刷新重试`);
            captchaRefresh();
            return;
          }
          // 还在转圈/刷新，继续等
          return;
        }
      }
    }

    // ═══ 3. 验证码容器已消失 或 SDK回调成功 = 检查支付结果 ═══
    _captchaAttempt = 0;

    // 3-waf: WAF拦截 → 停止一切（日志已由拦截器打印）
    if (_wafBlocked) {
      _captchaState = CAPTCHA_STATE.IDLE;
      _captchaProcessing = false;
      stopAll();
      return;
    }

    // 3-early: 如果preview已返回非成功结果，不进入QR等待，直接重试
    if (_retryEngineSuccessResult) {
      log('[验证码] 重试引擎已成功(3-early)，跳过');
      _captchaState = CAPTCHA_STATE.IDLE;
      _captchaProcessing = false;
      return;
    }
    if (_lastPreviewResult && _lastPreviewResult !== 'ok') {
      log(`[验证码] preview=${_lastPreviewResult}，跳过QR等待，直接重试`);
      const savedPreview = _lastPreviewResult;
      _lastPreviewResult = '';
      _captchaState = CAPTCHA_STATE.IDLE;
      _captchaLastBgUrl = '';
      // 不清空 _captchaLastChars！防止重试后重识别同一验证码
      // 不在此解锁！让 triggerPreviewRetry 统一管理解锁时序，避免竞态
      if (!_previewRetryTimer) {
        triggerPreviewRetry(`preview=${savedPreview}`);
      }
      return;
    }

    // 3a. 支付 UI 已出现 且有可扫描二维码 = 真正成功 = 冻结
    if (isPaymentUIVisible()) {
      if (hasScannableQR()) {
        freezeForPayment('[验证码] ✅ 验证通过 → 支付二维码已出现，冻结！');
        return;
      }
      // 支付框出现但没有二维码 → 可能是加载中，使用渐进式重试
      if (!_captchaQrRetried) {
        _captchaQrRetried = true;
        _captchaState = 99; // 临时状态：阻止主循环重复进入 captchaCheckResult
        _qrRetryEpoch++; // 新一轮，旧计时器将失效
        const myEpoch = _qrRetryEpoch;
        const retryDelays = [500, 1500, 3000, 5000, 8000]; // 渐进重试，高峰期给更多时间
        let retryIdx = 0;

        const tryNext = () => {
          if (_rushStopped) { _captchaState = CAPTCHA_STATE.IDLE; _captchaProcessing = false; return; }
          if (_wafBlocked) { _captchaState = CAPTCHA_STATE.IDLE; _captchaProcessing = false; stopAll(); return; }
          if (_paymentFrozen) return;
          if (_qrRetryEpoch !== myEpoch) return; // 已被新一轮取代
          // 拦截器已检测到非成功结果，立即中止QR等待
          if (_lastPreviewResult && _lastPreviewResult !== 'ok') {
            log(`[QR重试] preview=${_lastPreviewResult}，中止等待`);
            _lastPreviewResult = '';
            _qrRetryEpoch++; // 作废后续回调
            return;
          }
          if (retryIdx >= retryDelays.length) {
            // 所有重试都失败 → 检查是否仍在加载
            if (isPaymentLoading()) {
              log('[验证码] 支付弹窗仍在加载中，额外等待10秒...', 'warn');
              setTimeout(() => {
                if (_rushStopped) return;
                if (_paymentFrozen) return;
                if (_qrRetryEpoch !== myEpoch) return;
                if (hasScannableQR()) {
                  freezeForPayment('[验证码] ✅ 二维码延迟加载成功，冻结！');
                } else if (!CFG.autoCloseInvalid) {
                  _captchaState = CAPTCHA_STATE.IDLE;
                  setTimeout(() => { if (!_rushStopped) _captchaProcessing = false; }, 500);
                  _captchaLastBgUrl = '';
                  log('[验证码] autoCloseInvalid=false，保持弹窗不关闭，停止重试');
                } else {
                  _captchaQrRetried = false;
                  closeEmptyPayDialog();
                }
              }, 10000);
            } else if (!CFG.autoCloseInvalid) {
              _captchaState = CAPTCHA_STATE.IDLE;
              setTimeout(() => { if (!_rushStopped) _captchaProcessing = false; }, 500);
              _captchaLastBgUrl = '';
              log('[验证码] autoCloseInvalid=false，保持弹窗不关闭，停止重试');
            } else {
              _captchaQrRetried = false;
              closeEmptyPayDialog();
            }
            return;
          }

          const delay = retryDelays[retryIdx++];
          log(`[验证码] 支付弹窗出现但无二维码，${delay / 1000}秒后第${retryIdx}次复查...`);
          setTimeout(() => {
            if (_rushStopped) return;
            if (_paymentFrozen) return;
            if (_qrRetryEpoch !== myEpoch) return; // 已被新一轮取代
            if (hasScannableQR()) {
              freezeForPayment(`[验证码] ✅ 二维码在第${retryIdx}次复查时加载成功，冻结！`);
            } else if (isPaymentLoading()) {
              log(`[验证码] 第${retryIdx}次复查：仍在加载中，继续等待...`);
              tryNext();
            } else {
              tryNext();
            }
          }, delay);
        };

        tryNext();
        return;
      }
      // 兜底：已在重试流程中
      return;
    }

    // ═══ 4. 验证码容器也消失了 = 验证已结束，但没有支付弹窗 ═══
    // 先检查preview API响应码（最快判断失败原因）
    if (_lastPreviewResult && _lastPreviewResult !== 'ok') {
      const reason = _lastPreviewResult;
      _lastPreviewResult = '';
      log(`[验证码] preview返回${reason}，无需等待DOM，立即重试购买`);
      _captchaAttempt = 0;
      _captchaLastBgUrl = '';
      _captchaState = CAPTCHA_STATE.IDLE;
      // 不在此解锁！让 triggerPreviewRetry 统一管理解锁时序
      if (!_previewRetryTimer) {
        triggerPreviewRetry(`preview=${reason}`);
      }
      return;
    }
    _lastPreviewResult = '';

    // 超时兜底：如果长时间既无preview响应也无支付弹窗，直接重试
    if (Date.now() - _captchaWaitStart > CFG.previewTimeout + 5000) {
      log(`[验证码] 验证后${(CFG.previewTimeout + 5000) / 1000}s无任何响应，超时重试`, 'warn');
      _captchaAttempt = 0;
      _captchaLastBgUrl = '';
      _captchaState = CAPTCHA_STATE.IDLE;
      // 不在此解锁！让 triggerPreviewRetry 统一管理解锁时序
      if (!_previewRetryTimer) {
        triggerPreviewRetry('响应超时');
      }
      return;
    }

    _captchaAttempt = 0;
    _captchaLastBgUrl = '';
    _captchaState = CAPTCHA_STATE.IDLE;

    // 再查一次支付（可能有延迟），给二维码更多加载时间
    if (isPaymentUIVisible()) {
      if (hasScannableQR()) {
        freezeForPayment('[验证码] ✅ 验证通过 → 支付弹窗已出现，冻结！');
        return;
      }
      // 弹窗出现但无二维码 → 等待加载而不是立刻关闭
      _captchaState = 99; // 阻止主循环重复进入
      _qrRetryEpoch++;
      const myEpoch4 = _qrRetryEpoch;
      log('[验证码] 支付弹窗出现但无二维码，等待8秒让QR加载...', 'warn');
      setTimeout(() => {
        if (_rushStopped) return;
        if (_paymentFrozen) return;
        if (_qrRetryEpoch !== myEpoch4) return;
        if (hasScannableQR()) {
          freezeForPayment('[验证码] ✅ 二维码延迟加载成功，冻结！');
        } else if (isPaymentLoading()) {
          log('[验证码] 支付弹窗仍在加载中，再等10秒...', 'warn');
          setTimeout(() => {
            if (_rushStopped) return;
            if (_paymentFrozen) return;
            if (_qrRetryEpoch !== myEpoch4) return;
            if (hasScannableQR()) {
              freezeForPayment('[验证码] ✅ 二维码延迟加载成功！');
            } else if (!CFG.autoCloseInvalid) {
              log('[验证码] autoCloseInvalid=false，保持弹窗不关闭，请手动处理');
            } else {
              log('[验证码] 支付弹窗长时间无二维码，关闭重试', 'warn');
              closeEmptyPayDialog();
            }
          }, 10000);
        } else if (!CFG.autoCloseInvalid) {
          _captchaState = CAPTCHA_STATE.IDLE;
          setTimeout(() => { if (!_rushStopped) _captchaProcessing = false; }, 500);
          log('[验证码] autoCloseInvalid=false，保持弹窗不关闭，请手动处理');
        } else {
          closeEmptyPayDialog();
        }
      }, 8000);
      return;
    }

    // 检查错误弹窗（人数过多、售罄等）
    const errDlg = isErrorDialogVisible();
    if (errDlg) {
      const errText = (errDlg.textContent || '').trim().substring(0, 50);
      log(`[验证码] 验证通过但购买失败: "${errText}"，关闭弹窗重新购买`);
      dismissDialog(errDlg);
      document.querySelectorAll('.el-overlay, .v-modal, .el-overlay-dialog').forEach(el => el.style.display = 'none');
      document.body.style.overflow = '';
      // 延迟后重新点击购买（可能触发新一轮验证码）
      setTimeout(() => {
        if (_rushStopped) return;
        _captchaProcessing = false;
        if (_paymentFrozen) return;
        const btn = findBuyButton();
        if (btn) { btn.click(); log('[验证码] 已重新点击购买按钮'); }
      }, 1000);
      return;
    }

    // 什么都没出现 — 可能后端处理中，也可能静默失败
    log('[验证码] 验证通过，但无支付弹窗也无错误，等待后重试购买...');
    setTimeout(() => {
      if (_rushStopped) return;
      _captchaProcessing = false;
      if (_paymentFrozen) return;
      if (isPaymentUIVisible() && hasScannableQR()) { freezeForPayment('[验证码] 支付弹窗延迟出现，冻结！'); return; }
      const btn = findBuyButton();
      if (btn) { btn.click(); log('[验证码] 延迟重试: 重新点击购买按钮'); }
    }, 2000);
  }

  function setupMainPageCaptchaWatcher() {
    // 状态机主循环
    setInterval(() => {
      // ── 解冻按钮同步显示 ──
      const ufBtn = _shadowRef?.getElementById('btn-unfreeze');
      if (ufBtn) ufBtn.style.display = _paymentFrozen ? '' : 'none';

      // 铁律: 支付保护锁
      if (_paymentFrozen) {
        // 支付UI仍在 → 保持冻结，即使QR还在加载
        if (isPaymentUIVisible()) {
          // QR已出现 → 完美
          if (hasScannableQR()) return;
          // QR未加载但弹窗在 → 检查是否刚冻结（30秒内不解除）
          if (Date.now() - _frozenAt < 30000) {
            return; // 30秒内不解除，等QR加载
          }
          log('[冻结保护] 支付弹窗存在但30秒内无二维码，解除冻结', 'warn');
        }
        // 支付UI已消失 → 解除冻结
        _paymentFrozen = false;
        _frozenAt = 0;
        log('[验证码] 支付弹窗已消失，自动解除冻结');
      }

      // 支付弹窗消失时，如果还在QR重试中(状态99)，自动恢复到IDLE
      if (_captchaState === 99 && !isPaymentUIVisible()) {
        _captchaState = CAPTCHA_STATE.IDLE;
        setTimeout(() => { if (!_rushStopped) _captchaProcessing = false; }, 500);
        _captchaQrRetried = false;
        _qrRetryEpoch++;
        log('[状态机] 支付弹窗已消失，退出QR重试，恢复IDLE');
      }

      switch (_captchaState) {
        case CAPTCHA_STATE.IDLE:
          if (!_rushStopped && mainPageCaptchaVisible()) {
            log('[状态机] 检测到验证码弹窗，500ms后识别');
            setTimeout(mainPageSolveCaptcha, 200);
          }
          break;
        case CAPTCHA_STATE.WAITING:
          captchaCheckResult();
          break;
      }
    }, 1500);

    // MutationObserver 快速响应
    const observer = new MutationObserver(() => {
      // 冻结恢复：无论是否激活都处理
      if (_paymentFrozen) {
        if (isPaymentUIVisible()) return;
        _paymentFrozen = false;
        _frozenAt = 0;
        log('[Observer] 支付弹窗已消失，解除冻结');
      }
      // QR重试中(状态99)且支付弹窗消失 → 恢复IDLE
      if (_captchaState === 99 && !isPaymentUIVisible()) {
        _captchaState = CAPTCHA_STATE.IDLE;
        setTimeout(() => { if (!_rushStopped) _captchaProcessing = false; }, 500);
        _captchaQrRetried = false;
        _qrRetryEpoch++;
        log('[Observer] 支付弹窗已消失，退出QR重试，恢复IDLE');
      }
      // 验证码识别：停止后不自动处理，刷新恢复
      if (!_rushStopped && _captchaState === CAPTCHA_STATE.IDLE && mainPageCaptchaVisible()) {
        setTimeout(mainPageSolveCaptcha, 200);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

    log('[主页面验证码] 验证码+购买状态机已启动 (v1.0.0)');
  }

  console.log('[glm_bypass] userscript v1.0.0 注入成功');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { createPanel(); setupMainPageCaptchaWatcher(); });
  } else {
    createPanel();
    setupMainPageCaptchaWatcher();
  }
})();
