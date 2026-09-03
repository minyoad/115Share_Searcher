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
  Check,
  Download,
  CheckSquare,
  FileJson
} from 'lucide-react';
import { ShareRecord } from '../types';

interface ShareTaskManagerProps {
  shares: ShareRecord[];
  onTriggerCrawl: (shareCode: string, receiveCode: string) => void;
  onOpenTree: (shareCode: string) => void;
  onSearchByShare: (shareCode: string) => void;
  onReportShare: (shareCode: string) => void;
  onOpenImport: () => void;
  onBatchTriggerCrawl?: (shareCodes: string[]) => void;
  onExportShares?: (shareCodes?: string[]) => void;
}

export const ShareTaskManager: React.FC<ShareTaskManagerProps> = ({
  shares,
  onTriggerCrawl,
  onOpenTree,
  onSearchByShare,
  onReportShare,
  onOpenImport,
  onBatchTriggerCrawl,
  onExportShares,
}) => {
  const [filterStatus, setFilterStatus] = useState<number | null>(null);
  const [searchKw, setSearchKw] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [selectedShareCodes, setSelectedShareCodes] = useState<string[]>([]);
  const [batchCrawling, setBatchCrawling] = useState(false);
  const [syncingTitles, setSyncingTitles] = useState(false);

  const handleSyncTitles = async () => {
    try {
      setSyncingTitles(true);
      const resp = await fetch('/api/v1/shares/sync-root-titles', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        alert(data.message || '已成功同步根目录标题！');
        window.location.reload();
      } else {
        alert('同步根目录标题请求失败');
      }
    } catch (err) {
      console.error('Failed to sync root titles:', err);
      alert('同步发生错误: ' + String(err));
    } finally {
      setSyncingTitles(false);
    }
  };

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

  // Batch selection methods
  const isAllSelected = filteredShares.length > 0 && filteredShares.every(s => selectedShareCodes.includes(s.share_code));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      const filteredCodes = new Set(filteredShares.map(s => s.share_code));
      setSelectedShareCodes(prev => prev.filter(code => !filteredCodes.has(code)));
    } else {
      const set = new Set(selectedShareCodes);
      filteredShares.forEach(s => set.add(s.share_code));
      setSelectedShareCodes(Array.from(set));
    }
  };

  const invertSelection = () => {
    const set = new Set(selectedShareCodes);
    filteredShares.forEach(s => {
      if (set.has(s.share_code)) {
        set.delete(s.share_code);
      } else {
        set.add(s.share_code);
      }
    });
    setSelectedShareCodes(Array.from(set));
  };

  const toggleSelectOne = (code: string) => {
    setSelectedShareCodes(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const handleBatchReCrawl = () => {
    if (selectedShareCodes.length === 0) return;
    if (onBatchTriggerCrawl) {
      setBatchCrawling(true);
      onBatchTriggerCrawl(selectedShareCodes);
      setTimeout(() => {
        setBatchCrawling(false);
        setSelectedShareCodes([]);
      }, 1000);
    }
  };

  const handleExport = (onlySelected: boolean) => {
    if (onExportShares) {
      onExportShares(onlySelected ? selectedShareCodes : undefined);
    }
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

        {/* Batch Operations & Export Toolbar */}
        <div className="bg-slate-50/90 rounded-xl p-3 border border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Selection controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700 select-none hover:text-slate-900 transition">
              <input 
                type="checkbox" 
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span>全选筛选结果</span>
            </label>

            <button 
              onClick={invertSelection}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-md transition font-medium shadow-2xs"
              title="反向选择当前列表项"
            >
              反选
            </button>

            {selectedShareCodes.length > 0 ? (
              <span className="px-2.5 py-1 bg-blue-100/80 text-blue-800 font-bold rounded-md border border-blue-200">
                已选中 {selectedShareCodes.length} 项
              </span>
            ) : (
              <span className="text-slate-400 pl-1">
                (勾选卡片复选框可进行批量操作或配置导出)
              </span>
            )}

            {selectedShareCodes.length > 0 && (
              <button 
                onClick={() => setSelectedShareCodes([])}
                className="text-xs text-slate-500 hover:text-rose-600 underline font-medium ml-1 transition"
              >
                清空选择
              </button>
            )}
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Batch Re-crawl */}
            <button 
              onClick={handleBatchReCrawl}
              disabled={selectedShareCodes.length === 0 || batchCrawling}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition shadow-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={selectedShareCodes.length === 0 ? "请先勾选需要重新抓取的分享" : "一键批量重新抓取已勾选的分享链接"}
            >
              <RotateCw className={`w-3.5 h-3.5 ${batchCrawling ? 'animate-spin' : ''}`} />
              <span>{batchCrawling ? '重新入队中...' : `批量重新抓取 (${selectedShareCodes.length})`}</span>
            </button>

            {/* Export Selected JSON */}
            <button 
              onClick={() => handleExport(true)}
              disabled={selectedShareCodes.length === 0}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition shadow-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="将选中的分享记录导出为 JSON 备份配置"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出选中配置 ({selectedShareCodes.length})</span>
            </button>

            {/* Sync Root Titles */}
            <button 
              onClick={handleSyncTitles}
              disabled={syncingTitles}
              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-semibold rounded-lg transition shadow-2xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="自动扫描并使用已抓取的根目录名称更新分享任务标题，消除雷同标题"
            >
              <FolderTree className={`w-3.5 h-3.5 ${syncingTitles ? 'animate-spin' : ''}`} />
              <span>{syncingTitles ? '正在同步标题...' : '同步根目录标题'}</span>
            </button>

            {/* Export All JSON */}
            <button 
              onClick={() => handleExport(false)}
              disabled={shares.length === 0}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold rounded-lg transition shadow-2xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="导出全部分享任务为标准 JSON 文件"
            >
              <FileJson className="w-3.5 h-3.5 text-slate-500" />
              <span>导出全量配置</span>
            </button>
          </div>
        </div>
      </div>

      {/* Share Tasks List */}
      <div className="space-y-3">
        {filteredShares.length > 0 ? (
          filteredShares.map((s) => {
            const pwdSuffix = s.receive_code ? `?password=${s.receive_code}` : '';
            const shareUrl = `https://115.com/s/${s.share_code}${pwdSuffix}`;
            const isPending = s.status === 0;
            const isSelected = selectedShareCodes.includes(s.share_code);

            return (
              <div
                key={s.id}
                className={`rounded-2xl p-4 sm:p-5 border transition shadow-xs hover:border-slate-300 flex items-start gap-3.5 ${
                  isSelected ? 'border-blue-400 bg-blue-50/25 ring-1 ring-blue-400/40' : 'bg-white border-slate-200'
                }`}
              >
                {/* Checkbox */}
                <div className="pt-1 select-none shrink-0" onClick={(e) => e.stopPropagation()}>
                  <input 
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelectOne(s.share_code)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    title={`选择 ${s.share_code}`}
                  />
                </div>

                <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900 truncate max-w-xl" title={s.title}>
                        {s.title}
                      </h3>
                      {s.folder_count > 0 && !s.title.startsWith("115 分享 (") && (
                        <span className="shrink-0 px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 rounded-md flex items-center gap-1">
                          <span>📂 根目录</span>
                        </span>
                      )}
                    </div>

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
