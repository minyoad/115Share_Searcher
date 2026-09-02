import React, { useState } from 'react';
import { 
  ListChecks, 
  Play, 
  RotateCw, 
  Search, 
  FolderTree, 
  ExternalLink, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  PlusCircle, 
  Database,
  HardDrive,
  Copy,
  Check
} from 'lucide-react';
import { ShareRecord } from '../types';

interface ShareTaskManagerProps {
  shares: ShareRecord[];
  onTriggerCrawl: (shareCode: string, receiveCode: string) => void;
  onOpenTree: (shareCode: string) => void;
  onSearchByShare: (shareCode: string) => void;
  onReportShare: (shareCode: string) => void;
  onOpenImport: () => void;
}

export const ShareTaskManager: React.FC<ShareTaskManagerProps> = ({
  shares,
  onTriggerCrawl,
  onOpenTree,
  onSearchByShare,
  onReportShare,
  onOpenImport,
}) => {
  const [filterStatus, setFilterStatus] = useState<number | null>(null);
  const [searchKw, setSearchKw] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let idx = 0;
    let size = bytes;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx++;
    }
    return `${size.toFixed(2)} ${units[idx]}`;
  };

  // Stats calculation
  const totalShares = shares.length;
  const activeShares = shares.filter(s => s.status === 1).length;
  const pendingShares = shares.filter(s => s.status === 0).length;
  const expiredShares = shares.filter(s => s.status === 2 || s.status === 3).length;
  const totalFiles = shares.reduce((acc, s) => acc + s.file_count, 0);
  const totalBytes = shares.reduce((acc, s) => acc + s.total_size, 0);

  // Filtering
  const filteredShares = shares.filter(s => {
    if (filterStatus !== null && s.status !== filterStatus) return false;
    if (searchKw.trim()) {
      const kw = searchKw.trim().toLowerCase();
      const codeMatch = s.share_code.toLowerCase().includes(kw);
      const titleMatch = s.title.toLowerCase().includes(kw);
      if (!codeMatch && !titleMatch) return false;
    }
    return true;
  });

  const handleCopy = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Overview Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">收录分享总数</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {totalShares} <span className="text-xs font-normal text-slate-400">个任务</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" />
            抓取完成 (有效)
          </p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            {activeShares} <span className="text-xs font-normal text-slate-400">个</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            抓取中 / 待抓取
          </p>
          <p className="text-2xl font-bold text-amber-600 mt-1 flex items-center gap-2">
            {pendingShares}
            {pendingShares > 0 && (
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
            )}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider flex items-center gap-1">
            <HardDrive className="w-3.5 h-3.5" />
            已收录文件总数
          </p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {totalFiles} <span className="text-xs font-normal text-slate-400">({formatSize(totalBytes)})</span>
          </p>
        </div>
      </div>

      {/* Filter and Action Header */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">115 分享链接爬取状态监控</h2>
            <span className="text-xs text-slate-400">({filteredShares.length} 条)</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
              <input 
                type="text"
                placeholder="搜索分享代码或标题..."
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <button
              onClick={onOpenImport}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-xs shrink-0"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              提交新链接
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs border-t border-slate-100 pt-3">
          <span className="text-slate-400 font-medium">状态筛选:</span>
          <button
            onClick={() => setFilterStatus(null)}
            className={`px-3 py-1 rounded-lg transition font-semibold ${
              filterStatus === null
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            全部 ({totalShares})
          </button>
          <button
            onClick={() => setFilterStatus(0)}
            className={`px-3 py-1 rounded-lg transition font-semibold flex items-center gap-1 ${
              filterStatus === 0
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
            抓取中 / 待开始 ({pendingShares})
          </button>
          <button
            onClick={() => setFilterStatus(1)}
            className={`px-3 py-1 rounded-lg transition font-semibold ${
              filterStatus === 1
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            ✅ 抓取完成 ({activeShares})
          </button>
          <button
            onClick={() => setFilterStatus(2)}
            className={`px-3 py-1 rounded-lg transition font-semibold ${
              filterStatus === 2
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            ⚠️ 密码错误 / 失效 ({expiredShares})
          </button>
        </div>
      </div>

      {/* Share Tasks List */}
      <div className="space-y-3">
        {filteredShares.length > 0 ? (
          filteredShares.map((s) => {
            const pwdSuffix = s.receive_code ? `?password=${s.receive_code}` : '';
            const shareUrl = `https://115.com/s/${s.share_code}${pwdSuffix}`;
            const isPending = s.status === 0;

            return (
              <div
                key={s.id}
                className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs hover:border-slate-300 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Left Metadata */}
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Status Tag */}
                      {isPending ? (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                          抓取中 / 待调度
                        </span>
                      ) : s.status === 1 ? (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          抓取完成 (有效)
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          密码错误 / 链接已失效
                        </span>
                      )}

                      <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                        {s.share_code}
                      </span>

                      {s.receive_code ? (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-mono font-semibold">
                          提取码: {s.receive_code}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">无提取码</span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900 truncate" title={s.title}>
                      {s.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-0.5">
                      <span>📁 包含文件: <strong className="text-slate-800">{s.file_count}</strong> 个</span>
                      <span>📂 目录层级: <strong className="text-slate-800">{s.folder_count}</strong> 个</span>
                      <span>📦 资源总大小: <strong className="text-slate-800">{formatSize(s.total_size)}</strong></span>
                      {s.last_crawled_at && (
                        <span>🕒 上次遍历: <span className="text-slate-600">{s.last_crawled_at}</span></span>
                      )}
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap self-end sm:self-center shrink-0">
                    {/* Manual Start / Retry Crawl button */}
                    <button
                      id={`btn-crawl-${s.share_code}`}
                      onClick={() => onTriggerCrawl(s.share_code, s.receive_code)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-xs ${
                        isPending
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                      title={isPending ? '立即触发/加速抓取' : '重新递归遍历该分享'}
                    >
                      {isPending ? (
                        <>
                          <RotateCw className="w-3.5 h-3.5 animate-spin" />
                          <span>立即开始抓取</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>重新抓取</span>
                        </>
                      )}
                    </button>

                    {/* View Tree */}
                    <button
                      onClick={() => onOpenTree(s.share_code)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1 transition"
                      title="打开层级目录树浏览"
                    >
                      <FolderTree className="w-3.5 h-3.5 text-slate-500" />
                      <span>目录树</span>
                    </button>

                    {/* Search files in this share */}
                    <button
                      onClick={() => onSearchByShare(s.share_code)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1 transition"
                      title="在搜索页检索该分享内的所有文件"
                    >
                      <Search className="w-3.5 h-3.5 text-slate-500" />
                      <span>搜文件</span>
                    </button>

                    {/* Direct 115 link */}
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
                      title="在新标签页直达 115 页面"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 text-slate-500">
            <p className="text-base font-semibold text-slate-700">暂无符合条件的分享任务</p>
            <p className="text-xs mt-1">您可以点击上方「提交新链接」录入需要爬取的 115 分享。</p>
          </div>
        )}
      </div>
    </div>
  );
};
