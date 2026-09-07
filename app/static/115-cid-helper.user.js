// ==UserScript==
// @name         115 分享链接 CID 直达 & 自动免密助手
// @namespace    https://115.com/
// @version      1.1.0
// @description  自动识别 115 分享链接中的提取码并提交，支持通过 #cid= 或 ?cid= 直接进入指定子目录，告别从根目录逐层手动翻找！
// @author       115 Search Service
// @match        *://115.com/s/*
// @match        *://*.115.com/s/*
// @match        *://115cdn.com/s/*
// @match        *://*.115cdn.com/s/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 1. 解析当前 URL 中的提取码和目标 CID
  function parseParams() {
    const href = window.location.href;
    const url = new URL(href);
    
    // 提取密码 (?password=xxxx 或 #password=xxxx 或 ?pwd=xxxx)
    let pwd = url.searchParams.get('password') || url.searchParams.get('pwd') || '';
    if (!pwd) {
      const pwdMatch = href.match(/[#&?]password=([a-zA-Z0-9_-]+)/i) || href.match(/[#&?]pwd=([a-zA-Z0-9_-]+)/i);
      if (pwdMatch) pwd = pwdMatch[1];
    }

    // 提取目标 CID (#cid=xxxx 或 ?cid=xxxx)
    let cid = url.searchParams.get('cid') || '';
    if (!cid) {
      const cidMatch = href.match(/[#&?]cid=([0-9a-zA-Z]+)/i);
      if (cidMatch) cid = cidMatch[1];
    }

    return { pwd: pwd.trim(), targetCid: cid.trim() };
  }

  const { pwd, targetCid } = parseParams();
  let redirectedInitialSnap = false;

  // 2. 核心黑科技：在 document-start 时拦截网络请求，将初始 cid=0 动态重定向为目标 CID
  if (targetCid && targetCid !== '0') {
    // 劫持 XMLHttpRequest
    const rawXhrOpen = XMLHttpRequest.prototype.open;
    const rawXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      let finalUrl = url;
      if (typeof finalUrl === 'string' && finalUrl.includes('/share/snap') && !redirectedInitialSnap) {
        if (finalUrl.includes('cid=0') || !finalUrl.includes('cid=')) {
          finalUrl = finalUrl.replace(/([?&]cid=)0(?=[&]|$)/, `$1${targetCid}`);
          if (!finalUrl.includes('cid=')) {
            finalUrl += (finalUrl.includes('?') ? '&' : '?') + `cid=${targetCid}`;
          }
          redirectedInitialSnap = true;
          console.log(`[115-CID-Helper] 成功劫持 snap 请求，定位至 CID: ${targetCid}`);
          showFloatTip(`🎯 已拦截并直达目标目录 (CID: ${targetCid})`);
        }
      }
      return rawXhrOpen.call(this, method, finalUrl, ...args);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (body && typeof body === 'string' && body.includes('share/snap') && !redirectedInitialSnap) {
        if (body.includes('cid=0')) {
          body = body.replace(/([&?]cid=)0(?=[&]|$)/, `$1${targetCid}`);
          redirectedInitialSnap = true;
          console.log(`[115-CID-Helper] 成功劫持 snap POST 请求，定位至 CID: ${targetCid}`);
          showFloatTip(`🎯 已拦截并直达目标目录 (CID: ${targetCid})`);
        }
      }
      return rawXhrSend.call(this, body);
    };

    // 劫持 fetch API
    if (window.fetch) {
      const rawFetch = window.fetch;
      window.fetch = function (input, init) {
        let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (url && url.includes('/share/snap') && !redirectedInitialSnap) {
          if (url.includes('cid=0') || !url.includes('cid=')) {
            url = url.replace(/([?&]cid=)0(?=[&]|$)/, `$1${targetCid}`);
            if (!url.includes('cid=')) {
              url += (url.includes('?') ? '&' : '?') + `cid=${targetCid}`;
            }
            redirectedInitialSnap = true;
            console.log(`[115-CID-Helper] fetch 拦截成功，定位至 CID: ${targetCid}`);
            showFloatTip(`🎯 已拦截并直达目标目录 (CID: ${targetCid})`);
            if (typeof input === 'string') {
              input = url;
            } else {
              input = new Request(url, init);
            }
          }
        }
        return rawFetch.call(this, input, init);
      };
    }
  }

  // 3. 自动填入提取码并点击提取
  function autoFillPassword() {
    if (!pwd) return;

    let attempts = 0;
    const maxAttempts = 30; // 检查 6 秒
    const timer = setInterval(() => {
      attempts++;

      // 常见 115 密码输入框选择器
      const pwdInput = document.querySelector(
        'input#js_share_pwd, input[name="receive_code"], input[name="password"], input.input-text[maxlength="4"], input[placeholder*="提取码"], input[placeholder*="密码"]'
      );

      // 提取提交按钮
      const submitBtn = document.querySelector(
        '#js_share_submit, button.btn-submit, [btn="submit"], a.btn-blue, button[type="submit"], a.btn:not(.btn-cancel)'
      );

      if (pwdInput) {
        if (!pwdInput.value) {
          pwdInput.value = pwd;
          pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
          pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`[115-CID-Helper] 已自动填充提取码: ${pwd}`);
        }

        if (submitBtn) {
          clearInterval(timer);
          setTimeout(() => {
            submitBtn.click();
            console.log('[115-CID-Helper] 已自动点击提取按钮');
            showFloatTip(`🔑 正在使用提取码 ${pwd} 自动解锁...`);
          }, 300);
          return;
        }
      }

      if (attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 200);
  }

  // 4. 浮动状态气泡提示
  function showFloatTip(text) {
    if (document.getElementById('cid-helper-toast')) {
      const el = document.getElementById('cid-helper-toast');
      el.textContent = text;
      el.style.opacity = '1';
      return;
    }
    const tip = document.createElement('div');
    tip.id = 'cid-helper-toast';
    tip.textContent = text;
    Object.assign(tip.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '999999',
      backgroundColor: '#1e293b',
      color: '#f8fafc',
      padding: '10px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2)',
      border: '1px solid #3b82f6',
      transition: 'all 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'none'
    });
    
    if (document.body) {
      document.body.appendChild(tip);
    } else {
      window.addEventListener('DOMContentLoaded', () => document.body.appendChild(tip));
    }

    setTimeout(() => {
      if (tip) {
        tip.style.opacity = '0';
        setTimeout(() => tip.remove(), 400);
      }
    }, 4500);
  }

  // 页面加载阶段挂载
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', autoFillPassword);
  } else {
    autoFillPassword();
  }
})();
