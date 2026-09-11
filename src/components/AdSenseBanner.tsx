import React, { useEffect, useRef } from 'react';
import { Sparkles, DollarSign, Info } from 'lucide-react';
import { AdSenseConfig } from '../types';

interface AdSenseBannerProps {
  config: AdSenseConfig | null;
  slotType?: 'banner' | 'in-feed' | 'sidebar';
  className?: string;
}

export const AdSenseBanner: React.FC<AdSenseBannerProps> = ({
  config,
  slotType = 'banner',
  className = '',
}) => {
  const adRef = useRef<HTMLModElement | null>(null);
  const initialized = useRef(false);

  // If AdSense is not enabled or no client_id, do not render
  if (!config || !config.enabled || !config.client_id) {
    return null;
  }

  const clientId = config.client_id.trim();
  const slotId = config.slot_id?.trim();
  const isTestMode = config.test_mode;

  // Dynamically load Google AdSense script into document head once
  useEffect(() => {
    if (!clientId) return;

    const scriptId = 'google-adsense-script';
    let scriptTag = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!scriptTag) {
      scriptTag = document.createElement('script');
      scriptTag.id = scriptId;
      scriptTag.async = true;
      scriptTag.crossOrigin = 'anonymous';
      scriptTag.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
      document.head.appendChild(scriptTag);
    }

    // Initialize unit ad push if slotId is present
    if (slotId && adRef.current && !initialized.current) {
      try {
        const adsbygoogle = (window as any).adsbygoogle || [];
        adsbygoogle.push({});
        initialized.current = true;
      } catch (e) {
        console.warn('AdSense push unit error or adblocker detected:', e);
      }
    }
  }, [clientId, slotId]);

  // If only Auto Ads is enabled and no specific slot ID is set, render subtle indicator in test mode or null
  if (!slotId) {
    if (isTestMode) {
      return (
        <div className={`p-2.5 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-800 text-[11px] flex items-center justify-between gap-2 my-3 ${className}`}>
          <div className="flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>
              <strong>Google AdSense Auto Ads 自动广告就绪</strong> · 发布商 ID: <code className="font-mono">{clientId}</code>（测试模式）
            </span>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-amber-200/70 text-amber-900 font-semibold text-[10px]">
            AI 自动匹配版位中
          </span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs my-4 ${className}`}>
      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2 px-1">
        <span className="flex items-center gap-1 font-medium tracking-wide uppercase">
          <Sparkles className="w-3 h-3 text-amber-500" />
          广告赞助 · 商业推广
        </span>
        {isTestMode && (
          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 font-mono text-[10px]">
            AdSense 测试模式 (data-adtest="on")
          </span>
        )}
      </div>

      <div className="min-h-[90px] flex items-center justify-center bg-slate-50/60 rounded-lg border border-dashed border-slate-200 relative overflow-hidden">
        {/* Real Google AdSense Unit */}
        <ins
          ref={adRef}
          className="adsbygoogle"
          style={{ display: 'block', minWidth: '250px', width: '100%', textAlign: 'center' }}
          data-ad-client={clientId}
          data-ad-slot={slotId}
          data-ad-format={slotType === 'banner' ? 'auto' : 'rectangle'}
          data-full-width-responsive="true"
          {...(isTestMode ? { 'data-adtest': 'on' } : {})}
        />

        {/* Fallback preview indicator for sandbox/dev mode */}
        <div className="text-center py-4 px-3 text-slate-400 pointer-events-none select-none">
          <p className="text-xs font-medium text-slate-600 mb-0.5">Google AdSense 广告展示位</p>
          <p className="text-[11px] text-slate-400 font-mono">
            Client: {clientId} · Slot: {slotId}
          </p>
        </div>
      </div>
    </div>
  );
};
