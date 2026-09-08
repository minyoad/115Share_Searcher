// ==UserScript==
// @name         115 分享链接 CID 直达 & 自动免密助手 (增强版)
// @namespace    https://115.com/
// @version      1.2.0
// @description  自动解析 115 分享链接中的提取码并秒级自动免密提交；自动将根目录请求重定向至目标 CID 子目录，告别从根目录逐层手动翻找！
// @author       115 Search Service
// @match        *://115.com/s/*
// @match        *://*.115.com/s/*
// @match        *://115cdn.com/s/*
// @match        *://*.115cdn.com/s/*
// @match        *://anxia.com/s/*
// @match        *://*.anxia.com/s/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // 1. 深度解析当前 URL 中的提取码和目标 CID (支持 SearchParams、Hash 及 Regex 混合匹配)
  function parseParams() {
    const href = win.location.href;
    let pwd = '';
    let cid = '';

    try {
      const url = new URL(href);
      pwd = url.searchParams.get('password') || url.searchParams.get('pwd') || url.searchParams.get('receive_code') || '';
      cid = url.searchParams.get('cid') || '';
    } catch (e) {}

    if (!pwd) {
      const m = href.match(/[?&#](?:password|pwd|receive_code)=([a-zA-Z0-9_-]+)/i);
      if (m) pwd = m[1];
    }
    if (!cid) {
      const m = href.match(/[?&#]cid=([0-9a-zA-Z]+)/i);
      if (m) cid = m[1];
    }

    return { pwd: (pwd || '').trim(), targetCid: (cid || '').trim() };
  }

  const { pwd, targetCid } = parseParams();
  let autoSubmitted = false;
  let redirectedCount = 0;

  console.log(`[115-CID-Helper v1.2.0] 初始化成功 | 提取码: "${pwd}" | 目标CID: "${targetCid}"`);

  // 2. 网络层深度拦截：在请求到达 115 官方服务器前，自动注入目标 CID 与 提取码 receive_code
  function rewriteUrl(url) {
    if (typeof url !== 'string' || !url.includes('/share/snap')) return url;
    let newUrl = url;

    // 注入 CID (将默认 0 替换为用户目标 CID)
    if (targetCid && targetCid !== '0') {
      if (newUrl.includes('cid=0')) {
        newUrl = newUrl.replace(/([?&]cid=)0(?=[&]|$)/, `$1${targetCid}`);
      } else if (!newUrl.includes('cid=')) {
        newUrl += (newUrl.includes('?') ? '&' : '?') + `cid=${targetCid}`;
      }
    }

    // 注入 receive_code (免密关键：直接把密码塞进首次 snap 请求，115 校验成功后无需弹窗)
    if (pwd) {
      if (newUrl.includes('receive_code=&') || newUrl.endsWith('receive_code=')) {
        newUrl = newUrl.replace(/([?&]receive_code=)(?:&|$)/, `$1${pwd}&`).replace(/&$/, '');
      } else if (!newUrl.includes('receive_code=')) {
        newUrl += (newUrl.includes('?') ? '&' : '?') + `receive_code=${pwd}`;
      }
    }

    if (newUrl !== url) {
      redirectedCount++;
      console.log(`[115-CID-Helper] 成功重写 snap 请求 -> ${newUrl}`);
      showFloatTip(`🚀 正在直达 CID: ${targetCid || '根目录'} (${pwd ? '自动注入密码' : '无密'})`);
    }
    return newUrl;
  }

  function rewriteBody(body) {
    if (!body) return body;
    try {
      if (typeof body === 'string') {
        let modified = body;
        if (targetCid && targetCid !== '0' && modified.includes('cid=0')) {
          modified = modified.replace(/([&?]cid=)0(?=[&]|$)/, `$1${targetCid}`);
        }
        if (pwd && (modified.includes('receive_code=&') || modified.endsWith('receive_code='))) {
          modified = modified.replace(/([&?]receive_code=)(?:&|$)/, `$1${pwd}&`).replace(/&$/, '');
        } else if (pwd && !modified.includes('receive_code=')) {
          modified += `&receive_code=${pwd}`;
        }
        return modified;
      }
      if (body instanceof URLSearchParams) {
        if (targetCid && targetCid !== '0') body.set('cid', targetCid);
        if (pwd) body.set('receive_code', pwd);
        return body;
      }
      if (body instanceof FormData) {
        if (targetCid && targetCid !== '0') body.set('cid', targetCid);
        if (pwd) body.set('receive_code', pwd);
        return body;
      }
    } catch (e) {
      console.error('[115-CID-Helper] 重写请求 Body 出错:', e);
    }
    return body;
  }

  // 劫持 XMLHttpRequest
  const origXhrOpen = win.XMLHttpRequest.prototype.open;
  const origXhrSend = win.XMLHttpRequest.prototype.send;

  win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const finalUrl = rewriteUrl(url);
    this._snapUrl = finalUrl;
    return origXhrOpen.call(this, method, finalUrl, ...rest);
  };

  win.XMLHttpRequest.prototype.send = function (body) {
    let finalBody = body;
    if (this._snapUrl && typeof this._snapUrl === 'string' && this._snapUrl.includes('/share/snap')) {
      finalBody = rewriteBody(body);
    }
    return origXhrSend.call(this, finalBody);
  };

  // 劫持 fetch API
  if (win.fetch) {
    const origFetch = win.fetch;
    win.fetch = function (input, init) {
      let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (url && url.includes('/share/snap')) {
        url = rewriteUrl(url);
        let newInit = init;
        if (init && init.body) {
          newInit = Object.assign({}, init, { body: rewriteBody(init.body) });
        }
        if (typeof input === 'string') {
          input = url;
        } else {
          input = new Request(url, newInit || init);
        }
        return origFetch.call(this, input, newInit);
      }
      return origFetch.call(this, input, init);
    };
  }

  // 3. DOM 层自动化：React 合成事件兼容注入、自动回车提交、自动点击提取按钮
  function setReactInputValue(input, val) {
    input.focus();
    const lastValue = input.value;
    input.value = val;
    if (input._valueTracker) {
      input._valueTracker.setValue(lastValue);
    }
    const nativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, val);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function tryAutoSubmitPassword() {
    if (!pwd || autoSubmitted) return false;

    // 查找所有可能的密码/提取码输入框
    const allInputs = Array.from(document.querySelectorAll('input'));
    const pwdInput = allInputs.find(input => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      const ph = (input.getAttribute('placeholder') || '').toLowerCase();
      const name = (input.getAttribute('name') || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const cls = (input.className || '').toLowerCase();
      return (
        type === 'password' ||
        ph.includes('提取') || ph.includes('密码') || ph.includes('code') ||
        name.includes('receive') || name.includes('password') || name.includes('pwd') ||
        id.includes('pwd') || id.includes('share') ||
        cls.includes('pwd') || cls.includes('input-text')
      );
    });

    if (pwdInput) {
      console.log('[115-CID-Helper] 发现提取码输入框，正在注入提取码并触发提交...', pwdInput);
      setReactInputValue(pwdInput, pwd);

      // 1. 触发回车键提交 (大多数 SPA 框架支持回车直达)
      const enterKeyProps = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
      pwdInput.dispatchEvent(new KeyboardEvent('keydown', enterKeyProps));
      pwdInput.dispatchEvent(new KeyboardEvent('keypress', enterKeyProps));
      pwdInput.dispatchEvent(new KeyboardEvent('keyup', enterKeyProps));

      // 2. 查找所属弹窗或页面中的提取/提交按钮
      const container = pwdInput.closest('form, div[class*="dialog"], div[class*="modal"], div[class*="box"], div[class*="share"], div[class*="content"]') || document.body;
      const buttons = Array.from(container.querySelectorAll('button, a, div[role="button"], input[type="submit"], input[type="button"]'));

      const submitBtn = buttons.find(btn => {
        const text = (btn.innerText || btn.textContent || '').trim();
        const cls = (btn.className || '').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        return (
          text.includes('提取') || text.includes('确定') || text.includes('访问') ||
          text.includes('提交') || text.includes('进入') || text.toLowerCase().includes('ok') ||
          cls.includes('submit') || cls.includes('btn-submit') || cls.includes('btn-blue') || cls.includes('primary') ||
          id.includes('submit')
        );
      });

      if (submitBtn) {
        console.log('[115-CID-Helper] 发现提交按钮，模拟触发点击:', submitBtn);
        setTimeout(() => {
          submitBtn.click();
        }, 120);
      }

      autoSubmitted = true;
      showFloatTip(`🔑 已自动填入密码 [${pwd}] 并自动点击跳过`);

      // 延时检测并清除残留遮罩层
      setTimeout(dismissStuckMasks, 600);
      setTimeout(dismissStuckMasks, 1500);
      return true;
    }
    return false;
  }

  // 4. 清理被挡住的遮罩层/弹窗 (如果文件列表已在底层加载完毕)
  function dismissStuckMasks() {
    const hasFiles = document.querySelector('[class*="file"], [class*="list-contents"], table, tbody tr, .file-item, [class*="item"]');
    if (hasFiles) {
      const masks = document.querySelectorAll('[class*="mask"], [class*="backdrop"], [class*="modal-overlay"]');
      masks.forEach(m => {
        m.style.setProperty('display', 'none', 'important');
      });
    }
  }

  // 5. 持续监听 DOM 变化 (MutationObserver 秒级捕获动态弹窗)
  const observer = new MutationObserver(() => {
    tryAutoSubmitPassword();
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // 双重定时器轮询兜底
  let pollCount = 0;
  const pollTimer = setInterval(() => {
    pollCount++;
    if (tryAutoSubmitPassword() || pollCount > 35) {
      clearInterval(pollTimer);
    }
  }, 250);

  // 6. 悬浮快捷控制台：如果出现弹窗遮挡或特殊情况，提供一键跳过与进入按钮
  function renderHelperWidget() {
    if (document.getElementById('cid-helper-widget')) return;
    const widget = document.createElement('div');
    widget.id = 'cid-helper-widget';
    widget.innerHTML = `
      <div style="
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(8px);
        color: #f8fafc;
        padding: 12px 16px;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
        border: 1px solid #3b82f6;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 240px;
        max-width: 320px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; font-weight: 600; color: #60a5fa;">
          <span style="display: flex; align-items: center; gap: 4px;">🧩 115 官方直达助手</span>
          <span style="cursor: pointer; color: #94a3b8; font-size: 14px;" id="cid-helper-close">✕</span>
        </div>
        <div style="color: #cbd5e1; line-height: 1.4; font-size: 11px;">
          ${targetCid ? `<div>📁 目标CID: <strong style="color: #38bdf8;">${targetCid}</strong></div>` : ''}
          ${pwd ? `<div>🔒 提取码: <strong style="color: #fbbf24;">${pwd}</strong> (已自动提取)</div>` : ''}
        </div>
        <button id="cid-helper-force-jump" style="
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 7px 12px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        ">
          <span>⚡ 一键跳过密码 / 强制进入</span>
        </button>
      </div>
    `;

    document.body.appendChild(widget);

    document.getElementById('cid-helper-close')?.addEventListener('click', () => {
      widget.remove();
    });

    document.getElementById('cid-helper-force-jump')?.addEventListener('click', () => {
      autoSubmitted = false;
      tryAutoSubmitPassword();
      dismissStuckMasks();
      showFloatTip('🎯 正在强制跳过密码并直达目录...');
    });
  }

  // 7. 顶部浮动通知
  function showFloatTip(text) {
    let tip = document.getElementById('cid-helper-toast');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'cid-helper-toast';
      Object.assign(tip.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: '2147483647',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        padding: '10px 18px',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '500',
        boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
        border: '1px solid #3b82f6',
        transition: 'all 0.3s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      });
      document.body ? document.body.appendChild(tip) : window.addEventListener('DOMContentLoaded', () => document.body.appendChild(tip));
    }
    tip.textContent = text;
    tip.style.opacity = '1';

    setTimeout(() => {
      if (tip) {
        tip.style.opacity = '0';
        setTimeout(() => tip.remove(), 400);
      }
    }, 4500);
  }

  // 挂载小挂件
  if (targetCid || pwd) {
    if (document.body) {
      renderHelperWidget();
    } else {
      window.addEventListener('DOMContentLoaded', renderHelperWidget);
    }
  }
})();
