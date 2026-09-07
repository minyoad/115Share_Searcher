import React, { useState } from 'react';
import { 
  Puzzle, 
  X, 
  Copy, 
  Check, 
  ExternalLink, 
  HelpCircle, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle,
  FolderOpen,
  KeyRound,
  Download
} from 'lucide-react';

interface CidHelperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToTree?: () => void;
}

export const CidHelperModal: React.FC<CidHelperModalProps> = ({
  isOpen,
  onClose,
  onNavigateToTree
}) => {
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);

  if (!isOpen) return null;

  const scriptUrl = '/115-cid-helper.user.js';

  const scriptCode = `// ==UserScript==
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

  function parseParams() {
    const href = window.location.href;
    const url = new URL(href);
    let pwd = url.searchParams.get('password') || url.searchParams.get('pwd') || '';
    if (!pwd) {
      const pwdMatch = href.match(/[#&?]password=([a-zA-Z0-9_-]+)/i);
      if (pwdMatch) pwd = pwdMatch[1];
    }
    let cid = url.searchParams.get('cid') || '';
    if (!cid) {
      const cidMatch = href.match(/[#&?]cid=([0-9a-zA-Z]+)/i);
      if (cidMatch) cid = cidMatch[1];
    }
    return { pwd: pwd.trim(), targetCid: cid.trim() };
  }

  const { pwd, targetCid } = parseParams();
  let redirected = false;

  // 核心黑科技：在 document-start 拦截 115 初始请求，将 cid=0 动态替换为目标 cid
  if (targetCid && targetCid !== '0') {
    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      let finalUrl = url;
      if (typeof finalUrl === 'string' && finalUrl.includes('/share/snap') && !redirected) {
        if (finalUrl.includes('cid=0') || !finalUrl.includes('cid=')) {
          finalUrl = finalUrl.replace(/([?&]cid=)0(?=[&]|$)/, \`$1\${targetCid}\`);
          if (!finalUrl.includes('cid=')) finalUrl += '&cid=' + targetCid;
          redirected = true;
          console.log('[115直达助手] 成功定位至 CID:', targetCid);
        }
      }
      return rawOpen.call(this, method, finalUrl, ...args);
    };
  }

  // 自动填密并点击提取
  if (pwd) {
    let t = setInterval(() => {
      const inp = document.querySelector('input#js_share_pwd, input[name="receive_code"], input[placeholder*="提取码"]');
      const btn = document.querySelector('#js_share_submit, button.btn-submit, [btn="submit"]');
      if (inp) {
        inp.value = pwd;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        if (btn) {
          clearInterval(t);
          setTimeout(() => btn.click(), 300);
        }
      }
    }, 200);
  }
})();`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Puzzle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                115 官方链接 CID 直达原理与解决方案
              </h3>
              <p className="text-xs text-slate-500">
                解决“115 官方网页要求输密后停留在根目录、不跳转子目录”的问题
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 text-sm text-slate-600">
          {/* Reason Alert */}
          <div className="p-3.5 bg-amber-50/80 rounded-xl border border-amber-200/80 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs leading-relaxed text-amber-900">
              <p className="font-bold">
                ⚠️ 为什么 115 官方网页无法直接跳到指定 CID 目录？
              </p>
              <p>
                115 官方分享前端页面（<code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded">115.com/s/*</code>）采用客户端单页架构，<strong>官方源码硬编码首次加载只请求根目录 (<code className="font-mono">cid=0</code>)</strong>，并没有监听 URL Hash 中的 <code className="font-mono">#cid=</code> 参数；且输入提取码验证后，官方页面会清空状态刷新根目录。这是 115 官方网站自身的设计限制。
              </p>
            </div>
          </div>

          {/* Solution 1: Built-in Directory Tree */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 uppercase tracking-wide">
                <FolderOpen className="w-4 h-4" /> 方案一：推荐直接使用本站内置目录树（无需安装任何插件）
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                即开即用
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              本搜索服务已将整个分享的目录结构完整建立索引！在搜索结果中点击<strong>「直达所在目录」</strong>，系统可<strong>毫秒级直接展开该文件所在的多级子目录</strong>，精准高亮目标文件，并支持复制绝对路径、快速切换上级目录或复制 AList / OpenList 挂载参数。
            </p>
            {onNavigateToTree && (
              <button
                onClick={() => {
                  onClose();
                  onNavigateToTree();
                }}
                className="mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                立即打开目录树查看
              </button>
            )}
          </div>

          {/* Solution 2: Tampermonkey Userscript */}
          <div className="p-4 bg-indigo-50/60 rounded-xl border border-indigo-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-900 uppercase tracking-wide">
                <Sparkles className="w-4 h-4 text-indigo-600" /> 方案二：安装「115 官方直达 & 自动免密」油猴脚本
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[11px] font-semibold">
                终极官方直达
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              如果您习惯直接在 115 官方网页端操作，只需在浏览器（Edge / Chrome / Firefox）中安装 <strong>Tampermonkey（油猴）</strong>、<strong>脚本猫</strong> 或 <strong>Violentmonkey</strong>，并安装本脚本：
            </p>

            <ul className="text-xs space-y-1.5 text-slate-700 bg-white p-3 rounded-lg border border-indigo-100">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span><strong>自动免密提取</strong>：自动读取 URL 中的密码并模拟点击提取，无需手动输入提取码。</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span><strong>自动请求劫持定位</strong>：在 115 页面初始化时将 <code className="font-mono bg-slate-100 px-1 py-0.2 rounded">cid=0</code> 替换为目标 CID，<strong>官方网页直接展示目标子文件夹</strong>！</span>
              </li>
            </ul>

            <div className="flex items-center gap-2.5 pt-1">
              <a
                href={scriptUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                一键安装油猴脚本 (.user.js)
              </a>

              <button
                onClick={handleCopyCode}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '已复制脚本代码' : '复制脚本源码'}</span>
              </button>

              <button
                onClick={() => setShowCode(!showCode)}
                className="text-xs text-indigo-600 hover:text-indigo-800 underline ml-auto"
              >
                {showCode ? '隐藏源码' : '查看源码'}
              </button>
            </div>

            {/* Code Box */}
            {showCode && (
              <div className="mt-2 bg-slate-900 rounded-lg p-3 text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto border border-slate-800">
                <pre>{scriptCode}</pre>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
