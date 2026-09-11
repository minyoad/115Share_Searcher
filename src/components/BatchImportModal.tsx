import React, { useState, useMemo } from 'react';
import { 
  PlusCircle, 
  Link, 
  Send, 
  CheckCircle, 
  AlertCircle, 
  Sparkles,
  ArrowRight,
  Database,
  RotateCw,
  AlertTriangle,
  Layers,
  ShieldCheck
} from 'lucide-react';
import { ShareRecord, FileRecord } from '../types';

interface ImporterViewProps {
  existingShares?: ShareRecord[];
  onImportSuccess: (newShare: ShareRecord, newFiles: FileRecord[]) => void;
  onNavigateToTasks?: () => void;
}

const URL_REGEX = /(?:https?:\/\/)?(?:[a-zA-Z0-9.-]+\.)?(?:115(?:cdn)?|anxia)\.com\/s\/([a-zA-Z0-9_-]{6,64})|([a-zA-Z0-9_-]{6,64})(?:[?&#](?:(?:password|pwd|receive_code)=)?([a-zA-Z0-9]{2,32}))?/i;

function parseLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  
  // Extract share code
  const codeMatch = trimmed.match(/(?:https?:\/\/)?(?:[a-zA-Z0-9.-]+\.)?(?:115(?:cdn)?|anxia)\.com\/s\/([a-zA-Z0-9_-]{6,64})/i)
                 || trimmed.match(/\/s\/([a-zA-Z0-9_-]{6,64})/i)
                 || trimmed.match(/^([a-zA-Z0-9_-]{6,64})/i);
  
  if (!codeMatch || !codeMatch[1]) return null;
  const shareCode = codeMatch[1];
  
  // Extract password
  let receiveCode = '';
  const pwdMatch = trimmed.match(/(?:[?&](?:password|pwd|receive_code)=([a-zA-Z0-9]+)|#([a-zA-Z0-9]+))/i);
  if (pwdMatch) {
    receiveCode = pwdMatch[1] || pwdMatch[2] || '';
  }
  
  return {
    raw: trimmed,
    valid: true,
    shareCode,
    receiveCode,
  };
}

export const ImporterView: React.FC<ImporterViewProps> = ({ existingShares = [], onImportSuccess, onNavigateToTasks }) => {
  const [inputText, setInputText] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successLogs, setSuccessLogs] = useState<string[]>([]);
  const [chunkSize, setChunkSize] = useState<number>(100);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [totalBatchesCount, setTotalBatchesCount] = useState(0);
  const [batchProgressPercent, setBatchProgressPercent] = useState(0);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Parse lines
  const parsedItems = useMemo(() => {
    const lines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
      const parsed = parseLine(line);
      if (parsed) return parsed;
      return {
        raw: line,
        valid: false,
        shareCode: '',
        receiveCode: '',
      };
    });
  }, [inputText]);

  const validCount = parsedItems.filter(i => i.valid).length;

  const getExistingShare = (shareCode: string) => {
    if (!shareCode) return null;
    return existingShares.find(s => s.share_code.toLowerCase() === shareCode.toLowerCase()) || null;
  };

  const handleBatchSubmit = async () => {
    if (validCount === 0 || isProcessing) return;
    setIsProcessing(true);
    setSuccessLogs([]);
    setBatchError(null);
    setCurrentBatchIndex(0);
    setBatchProgressPercent(0);

    const validItems = parsedItems.filter(i => i.valid);
    
    // Separate items to submit vs skipped duplicates
    const itemsToSubmit: typeof validItems = [];
    let initialSkipped = 0;
    const initialLogs: string[] = [];

    validItems.forEach(item => {
      const existing = getExistingShare(item.shareCode);
      if (existing && existing.status === 1 && (existing.file_count || 0) > 0 && skipDuplicates) {
        initialSkipped++;
        initialLogs.push(`跳过已收录且抓取完成的分享（智能去重）：${item.shareCode} (${existing.file_count} 个文件)`);
      } else {
        itemsToSubmit.push(item);
      }
    });

    if (itemsToSubmit.length === 0) {
      setSuccessLogs([
        `已检查 ${validCount} 条链接，全部均为已收录且抓取完成的分享，智能去重跳过，无需重复入库。`,
        ...initialLogs
      ]);
      setIsProcessing(false);
      return;
    }

    // Split into chunks of chunkSize (e.g. 100 items each)
    const chunks: (typeof validItems)[] = [];
    for (let i = 0; i < itemsToSubmit.length; i += chunkSize) {
      chunks.push(itemsToSubmit.slice(i, i + chunkSize));
    }

    setTotalBatchesCount(chunks.length);

    let totalQueuedCount = 0;
    let totalFailedCount = 0;
    const allLogs = [...initialLogs];

    for (let bIndex = 0; bIndex < chunks.length; bIndex++) {
      const chunk = chunks[bIndex];
      setCurrentBatchIndex(bIndex + 1);
      const pct = Math.round(((bIndex) / chunks.length) * 100);
      setBatchProgressPercent(pct);

      try {
        const payload = {
          shares: chunk.map(c => ({
            share_code: c.shareCode,
            receive_code: c.receiveCode || '',
          })),
          force_crawl: !skipDuplicates,
        };

        const res = await fetch('/api/v1/shares/batch-import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const detail = errData?.detail || `HTTP ${res.status} ${res.statusText}`;
          throw new Error(`第 ${bIndex + 1}/${chunks.length} 批（共 ${chunk.length} 条）提交失败: ${detail}`);
        }

        const data = await res.json().catch(() => ({}));
        const queuedThisBatch = data.tasks_queued || chunk.length;
        totalQueuedCount += queuedThisBatch;

        // Local optimistic state update for each item in the chunk
        chunk.forEach((item, itemIdx) => {
          const mockShareId = Date.now() + bIndex * 1000 + itemIdx;
          const newShare: ShareRecord = {
            id: mockShareId,
            share_code: item.shareCode,
            receive_code: item.receiveCode || '',
            title: `115 分享 (${item.shareCode})`,
            file_count: 0,
            folder_count: 0,
            total_size: 0,
            status: 0, // 0 = 抓取中 / 待开始
            created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
            last_crawled_at: undefined,
          };

          onImportSuccess(newShare, []);
        });

        allLogs.push(`✅ 第 ${bIndex + 1}/${chunks.length} 批已成功提交入库 (共 ${chunk.length} 条，入队 ${queuedThisBatch} 条)`);

      } catch (err: any) {
        totalFailedCount += chunk.length;
        const errStr = err?.message || String(err);
        setBatchError(`⚠️ 提交在第 ${bIndex + 1}/${chunks.length} 批中断：${errStr}。已成功入队 ${totalQueuedCount} 条。请检查网络或配置后重试。`);
        allLogs.push(`❌ 第 ${bIndex + 1}/${chunks.length} 批异常：${errStr}`);
        break; // Stop on first fatal batch error to avoid cascade failures
      }
    }

    setBatchProgressPercent(100);
    setIsProcessing(false);

    if (totalQueuedCount > 0) {
      setSuccessLogs([
        `🎉 批量提交完成！总计有效链接 ${validCount} 条：成功推入 Redis 爬取队列 ${totalQueuedCount} 条${initialSkipped > 0 ? `，智能去重跳过 ${initialSkipped} 条已完成分享` : ''}${totalFailedCount > 0 ? `，失败 ${totalFailedCount} 条` : ''}。`,
        ...allLogs
      ]);
      setInputText('');
    } else {
      setSuccessLogs(allLogs);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200 shadow-xs sm:shadow-sm space-y-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-blue-600 shrink-0" />
            批量提交 115 分享链接 (异步爬虫入库)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            支持标准 URL、密码参数（<code>?password=xxxx</code> 或 <code>#xxxx</code>）及原始代码。系统将推入 Redis Task Queue 由 Worker 并发抓取。
          </p>
        </div>

        {/* Preset quick buttons */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 text-nowrap scrollbar-none text-xs">
          <span className="text-slate-400 font-medium shrink-0">快速载入示例:</span>
          <button
            type="button"
            onClick={() => setInputText(`https://115cdn.com/s/swnsdrk3h2m?password=p783\nhttps://115cdn.com/s/sw6tcot3hbe?password=e9d7`)}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition font-mono text-[11px] shrink-0 min-h-[30px]"
          >
            载入 115cdn 链接
          </button>
          <button
            type="button"
            onClick={() => setInputText(`https://115.com/s/sw34kcyberpunk?password=cp77\nhttps://115.com/s/sw3mathclassical#mt24`)}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition font-mono text-[11px] shrink-0 min-h-[30px]"
          >
            载入 115 官方链接
          </button>
        </div>

        {/* Input Textarea */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            输入 115 分享链接 / 文本 (每行一条)
          </label>
          <textarea
            id="batch-import-textarea"
            rows={5}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="每行一个分享链接，例如：&#10;https://115.com/s/sw34kcyberpunk?password=cp77&#10;sw3mathclassical#mt24&#10;https://115.com/s/sw3998877"
            className="w-full p-3 sm:p-3.5 rounded-xl border border-slate-300 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-800"
          />
        </div>

        {/* Real-time Parsed Preview with Existence Detection */}
        <div className="bg-slate-50 rounded-xl p-3 sm:p-4 border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
              实时正则解析器预览 ({parsedItems.length} 行，有效 {validCount} 条)
            </span>
            <span className="text-[11px] text-slate-500">
              系统检测: <strong className="text-emerald-700">{parsedItems.filter(p => p.valid && !!getExistingShare(p.shareCode)).length}</strong> 条已存在
              {parsedItems.filter(p => p.valid && !getExistingShare(p.shareCode)).length > 0 && (
                <span> · <strong className="text-blue-700">{parsedItems.filter(p => p.valid && !getExistingShare(p.shareCode)).length}</strong> 条新链接</span>
              )}
            </span>
          </div>

          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {parsedItems.map((item, idx) => {
              const existing = item.valid ? getExistingShare(item.shareCode) : null;
              return (
                <div
                  key={idx}
                  className={`p-2 rounded-lg text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border ${
                    item.valid
                      ? 'bg-white border-slate-200 text-slate-800'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {item.valid ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    )}
                    <span className="truncate text-[11px] sm:text-xs">{item.raw}</span>
                  </div>

                  {item.valid ? (
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0 text-[11px] pl-5 sm:pl-0">
                      <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold">
                        CODE: {item.shareCode}
                      </span>
                      {item.receiveCode ? (
                        <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-semibold">
                          PWD: {item.receiveCode}
                        </span>
                      ) : (
                        <span className="text-slate-400">无密码</span>
                      )}
                      {existing ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-sans font-medium">
                          ✓ 已收录 ({existing.status === 1 ? '完成' : '待办'} · {existing.file_count}文件)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-sans font-medium">
                          ★ 新链接
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-rose-600 font-sans shrink-0 pl-5 sm:pl-0">格式不符</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Batch Configuration & Deduplication Option */}
        <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <label className="flex items-start sm:items-center gap-2 cursor-pointer text-xs text-slate-700 select-none bg-slate-50 hover:bg-slate-100 p-2.5 sm:p-3 rounded-xl border border-slate-200 transition min-h-[44px] flex-1">
            <input 
              type="checkbox" 
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer mt-0.5 sm:mt-0"
            />
            <span className="font-medium text-slate-800">
              智能去重: 若分享链接已存在且已抓取完成，自动跳过 (防重复消耗 115 API 配额)
            </span>
          </label>

          {/* Batch Chunk Size Selector */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-xl text-xs text-slate-600 shrink-0">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] font-medium">每批切片大小:</span>
            <select
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              disabled={isProcessing}
              className="bg-white border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={50}>50 条 / 批</option>
              <option value={100}>100 条 / 批 (推荐)</option>
              <option value={150}>150 条 / 批</option>
            </select>
          </div>
        </div>

        {/* Big Batch Banner (> 200 items) */}
        {validCount > 200 && (
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs space-y-1.5 text-blue-900">
            <div className="flex items-center gap-2 font-bold text-blue-800">
              <span className="text-sm">⚡</span>
              <span>已检测到大批量提交（当前共 {validCount} 条有效链接，超 200 条单批限制）</span>
            </div>
            <p className="text-blue-700 leading-relaxed text-[11px]">
              系统已自动启用「后台切片多批次提交引擎」，将按每批 {chunkSize} 条自动切片推入 Redis 任务队列，自动规避单次提交超过 200 条限制，并实时展示分批进度与清晰结果反馈！
            </p>
          </div>
        )}

        {/* Real-time Multi-batch Progress Bar */}
        {isProcessing && totalBatchesCount > 0 && (
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 flex items-center gap-2">
                <RotateCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                正在后台多批次提交：第 {currentBatchIndex} / {totalBatchesCount} 批
              </span>
              <span className="font-mono text-blue-700 font-bold text-xs">{batchProgressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(5, batchProgressPercent)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              采用非阻塞分批事务并发提交，保障数据库连接池稳定性，请勿关闭页面。
            </p>
          </div>
        )}

        {/* Explicit Error Banner if any batch fails */}
        {batchError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-900">批量提交中断 / 遇到明确异常</p>
                <p className="mt-1 text-rose-700 font-mono text-[11px] leading-relaxed">{batchError}</p>
              </div>
            </div>
            <div className="pt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleBatchSubmit}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition"
              >
                重试提交
              </button>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <span className="text-xs text-slate-500">
            API 对应路由: <code className="bg-slate-100 text-blue-600 px-1.5 py-0.5 rounded font-mono text-[11px]">POST /api/v1/shares/batch-import</code>
          </span>

          <button
            id="submit-import-btn"
            onClick={handleBatchSubmit}
            disabled={validCount === 0 || isProcessing}
            className="w-full sm:w-auto px-6 py-3 sm:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-xs transition disabled:opacity-50 min-h-[44px] active:scale-95"
          >
            {isProcessing ? (
              <>
                <RotateCw className="w-4 h-4 animate-spin" />
                <span>分批推入队列中 ({currentBatchIndex}/{totalBatchesCount})...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>
                  {validCount > 200 
                    ? `分批推入抓取队列 (${validCount} 条 · ${Math.ceil(validCount / chunkSize)} 批) 🚀`
                    : `推入抓取队列 (${validCount} 条) 🚀`}
                </span>
              </>
            )}
          </button>
        </div>

        {/* Success logs */}
        {successLogs.length > 0 && (
          <div className="p-3.5 sm:p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs space-y-2">
            <p className="font-bold flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              后台 Worker 异步抓取并索引成功！
            </p>
            {successLogs.map((log, i) => (
              <p key={i} className="font-mono text-emerald-700 break-all">• {log}</p>
            ))}
            {onNavigateToTasks && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onNavigateToTasks}
                  className="w-full sm:w-auto justify-center px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-xs transition min-h-[40px] active:scale-95"
                >
                  前往「任务与状态监控」查看抓取详情 ➔
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
