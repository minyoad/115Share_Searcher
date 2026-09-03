import React, { useState, useMemo } from 'react';
import { 
  PlusCircle, 
  Link, 
  Send, 
  CheckCircle, 
  AlertCircle, 
  Sparkles,
  ArrowRight,
  Database
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
  const [inputText, setInputText] = useState(
    `https://115cdn.com/s/swnsdrk3h2m?password=p783\nhttps://115cdn.com/s/sw6tcot3hbe?password=e9d7\nhttps://115.com/s/sw34kcyberpunk?password=cp77`
  );
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successLogs, setSuccessLogs] = useState<string[]>([]);

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

  const handleSimulateImport = () => {
    if (validCount === 0) return;
    setIsProcessing(true);
    setSuccessLogs([]);

    setTimeout(() => {
      let importedCount = 0;
      let skippedCount = 0;
      const logs: string[] = [];

      parsedItems.forEach((item, index) => {
        if (!item.valid) return;

        const existing = getExistingShare(item.shareCode);
        if (existing && existing.status === 1 && existing.file_count > 0 && skipDuplicates) {
          skippedCount++;
          logs.push(`跳过已收录且抓取完成的分享（去重）：${item.shareCode} (${existing.file_count} 个文件)`);
          return;
        }

        importedCount++;
        const mockShareId = Date.now() + index;
        const newShare: ShareRecord = {
          id: mockShareId,
          share_code: item.shareCode,
          receive_code: item.receiveCode,
          title: `115 分享资源包 (${item.shareCode})`,
          file_count: 3,
          folder_count: 1,
          total_size: 42949672960, // 40 GB
          status: 1,
          created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
          last_crawled_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
        };

        const newFiles: FileRecord[] = [
          {
            id: mockShareId * 10 + 1,
            share_id: mockShareId,
            file_115_id: `cid_${mockShareId}`,
            parent_115_id: '0',
            name: `资源核心合集_${item.shareCode}`,
            extension: '',
            size: 0,
            is_dir: true,
            sha1: '',
            full_path: `/${newShare.title}`,
            share_code: item.shareCode,
            receive_code: item.receiveCode,
            share_title: newShare.title,
          },
          {
            id: mockShareId * 10 + 2,
            share_id: mockShareId,
            file_115_id: `fid_${mockShareId}_1`,
            parent_115_id: `cid_${mockShareId}`,
            name: `高清电影_4K_HDR_${item.shareCode}.mkv`,
            extension: 'mkv',
            size: 21474836480,
            is_dir: false,
            sha1: 'a89c72e918237498172938471928374619283746',
            full_path: `/${newShare.title}/高清电影_4K_HDR_${item.shareCode}.mkv`,
            share_code: item.shareCode,
            receive_code: item.receiveCode,
            share_title: newShare.title,
          },
          {
            id: mockShareId * 10 + 3,
            share_id: mockShareId,
            file_115_id: `fid_${mockShareId}_2`,
            parent_115_id: `cid_${mockShareId}`,
            name: `全套无损原声大碟_FLAC_${item.shareCode}.flac`,
            extension: 'flac',
            size: 1073741824,
            is_dir: false,
            sha1: 'b91c83e019283746192837461928374619283746',
            full_path: `/${newShare.title}/全套无损原声大碟_FLAC_${item.shareCode}.flac`,
            share_code: item.shareCode,
            receive_code: item.receiveCode,
            share_title: newShare.title,
          },
        ];

        onImportSuccess(newShare, newFiles);
        logs.push(`已成功推入 Redis 队列并由 Worker 完成索引：${item.shareCode}`);
      });

      setSuccessLogs([
        `已成功处理 ${validCount} 条链接：入队/更新 ${importedCount} 条${skippedCount > 0 ? `，自动去重跳过 ${skippedCount} 条已完成分享` : ''}`,
        ...logs
      ]);
      setIsProcessing(false);
      setInputText('');
    }, 800);
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

        {/* Deduplication Option */}
        <div className="pt-1">
          <label className="flex items-start sm:items-center gap-2 cursor-pointer text-xs text-slate-700 select-none bg-slate-50 hover:bg-slate-100 p-2.5 sm:p-3 rounded-xl border border-slate-200 transition min-h-[44px]">
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
        </div>

        {/* Action Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <span className="text-xs text-slate-500">
            API 对应路由: <code className="bg-slate-100 text-blue-600 px-1.5 py-0.5 rounded font-mono text-[11px]">POST /api/v1/shares/batch-import</code>
          </span>

          <button
            id="submit-import-btn"
            onClick={handleSimulateImport}
            disabled={validCount === 0 || isProcessing}
            className="w-full sm:w-auto px-6 py-3 sm:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-xs transition disabled:opacity-50 min-h-[44px] active:scale-95"
          >
            <Send className="w-4 h-4" />
            {isProcessing ? '推入队列抓取中...' : `推入抓取队列 (${validCount} 条) 🚀`}
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
