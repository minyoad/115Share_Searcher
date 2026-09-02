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

export const ImporterView: React.FC<ImporterViewProps> = ({ onImportSuccess, onNavigateToTasks }) => {
  const [inputText, setInputText] = useState(
    `https://115cdn.com/s/swnsdrk3h2m?password=p783\nhttps://115cdn.com/s/sw6tcot3hbe?password=e9d7\nhttps://115.com/s/sw34kcyberpunk?password=cp77`
  );
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

  const handleSimulateImport = () => {
    if (validCount === 0) return;
    setIsProcessing(true);
    setSuccessLogs([]);

    setTimeout(() => {
      parsedItems.forEach((item, index) => {
        if (!item.valid) return;

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
      });

      setSuccessLogs(parsedItems.filter(i => i.valid).map(i => `已成功推入 Redis 队列并由 Worker 完成索引：${i.shareCode}`));
      setIsProcessing(false);
      setInputText('');
    }, 800);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-blue-600" />
            批量提交 115 分享链接 (异步爬虫入库)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            支持标准 URL、密码参数（<code>?password=xxxx</code> 或 <code>#xxxx</code>）及原始代码。系统将推入 Redis Task Queue 由 Worker 并发抓取。
          </p>
        </div>

        {/* Preset quick buttons */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-400 font-medium">快速载入示例:</span>
          <button
            type="button"
            onClick={() => setInputText(`https://115cdn.com/s/swnsdrk3h2m?password=p783\nhttps://115cdn.com/s/sw6tcot3hbe?password=e9d7`)}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition font-mono text-[11px]"
          >
            载入 115cdn 链接
          </button>
          <button
            type="button"
            onClick={() => setInputText(`https://115.com/s/sw34kcyberpunk?password=cp77\nhttps://115.com/s/sw3mathclassical#mt24`)}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition font-mono text-[11px]"
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
            className="w-full p-3.5 rounded-xl border border-slate-300 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-800"
          />
        </div>

        {/* Real-time Parsed Preview */}
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" />
              实时正则解析器预览 ({parsedItems.length} 行，有效 {validCount} 条)
            </span>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {parsedItems.map((item, idx) => (
              <div
                key={idx}
                className={`p-2 rounded-lg text-xs font-mono flex items-center justify-between border ${
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
                  <span className="truncate">{item.raw}</span>
                </div>

                {item.valid ? (
                  <div className="flex items-center gap-2 shrink-0 text-[11px]">
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
                  </div>
                ) : (
                  <span className="text-[10px] text-rose-600 font-sans shrink-0">格式不符</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-slate-500">
            API 对应路由: <code className="bg-slate-100 text-blue-600 px-1.5 py-0.5 rounded font-mono">POST /api/v1/shares/batch-import</code>
          </span>

          <button
            id="submit-import-btn"
            onClick={handleSimulateImport}
            disabled={validCount === 0 || isProcessing}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm transition disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {isProcessing ? '推入队列抓取中...' : `推入抓取队列 (${validCount} 条) 🚀`}
          </button>
        </div>

        {/* Success logs */}
        {successLogs.length > 0 && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs space-y-2">
            <p className="font-bold flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              后台 Worker 异步抓取并索引成功！
            </p>
            {successLogs.map((log, i) => (
              <p key={i} className="font-mono text-emerald-700">• {log}</p>
            ))}
            {onNavigateToTasks && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onNavigateToTasks}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-xs transition"
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
