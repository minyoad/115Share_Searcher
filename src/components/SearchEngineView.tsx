import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  Folder, 
  File, 
  Film, 
  Music, 
  BookOpen, 
  Archive, 
  ExternalLink, 
  Copy, 
  Check, 
  Flag,
  Database,
  Hash,
  Layers,
  Sparkles
} from 'lucide-react';
import { FileRecord, ShareRecord } from '../types';

interface SearchEngineViewProps {
  shares: ShareRecord[];
  files: FileRecord[];
  onOpenTree: (shareCode: string) => void;
  onReportShare: (shareCode: string) => void;
}

export const SearchEngineView: React.FC<SearchEngineViewProps> = ({
  shares,
  files,
  onOpenTree,
  onReportShare,
}) => {
  const [keyword, setKeyword] = useState('');
  const [selectedExt, setSelectedExt] = useState('');
  const [isDirFilter, setIsDirFilter] = useState(false);
  const [sizeFilter, setSizeFilter] = useState<'all' | 'small' | 'medium' | 'large' | 'huge'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<number | null>(null);

  const quickExts = ['mkv', 'mp4', 'pdf', 'zip', 'iso', 'flac', 'epub'];

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let s = bytes;
    while (s >= 1024 && i < units.length - 1) {
      s /= 1024;
      i++;
    }
    return `${s.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  };

  const getFileIcon = (ext: string, isDir: boolean) => {
    if (isDir) return <Folder className="w-5 h-5 text-amber-500 shrink-0" />;
    if (['mkv', 'mp4', 'avi', 'mov'].includes(ext)) return <Film className="w-5 h-5 text-purple-500 shrink-0" />;
    if (['flac', 'mp3', 'wav', 'aac'].includes(ext)) return <Music className="w-5 h-5 text-emerald-500 shrink-0" />;
    if (['pdf', 'epub', 'mobi', 'txt'].includes(ext)) return <BookOpen className="w-5 h-5 text-rose-500 shrink-0" />;
    if (['zip', 'rar', '7z', 'tar', 'iso'].includes(ext)) return <Archive className="w-5 h-5 text-blue-500 shrink-0" />;
    return <File className="w-5 h-5 text-slate-400 shrink-0" />;
  };

  // Filtered Results with PostgreSQL Trigram & Full Path Simulation
  const searchResults = useMemo(() => {
    return files.filter(f => {
      // Check share status
      const share = shares.find(s => s.id === f.share_id);
      if (share && share.status !== 1) return false;

      // Directory filter
      if (f.is_dir !== isDirFilter) return false;

      // Extension filter
      if (selectedExt && f.extension.toLowerCase() !== selectedExt.toLowerCase()) {
        return false;
      }

      // Size filter
      if (sizeFilter === 'small' && f.size > 100 * 1024 * 1024) return false; // < 100MB
      if (sizeFilter === 'medium' && (f.size <= 100 * 1024 * 1024 || f.size > 1024 * 1024 * 1024)) return false; // 100MB - 1GB
      if (sizeFilter === 'large' && (f.size <= 1024 * 1024 * 1024 || f.size > 10 * 1024 * 1024 * 1024)) return false; // 1GB - 10GB
      if (sizeFilter === 'huge' && f.size <= 10 * 1024 * 1024 * 1024) return false; // > 10GB

      // Keyword query in full_path and name (fuzzy & trigram match)
      if (keyword.trim()) {
        const terms = keyword.trim().toLowerCase().split(/\s+/);
        const target = (f.full_path + ' ' + f.name).toLowerCase();
        return terms.every(term => target.includes(term));
      }

      return true;
    });
  }, [files, shares, keyword, selectedExt, isDirFilter, sizeFilter]);

  const handleCopyNodeId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyShareLink = (f: FileRecord) => {
    const pwd = f.receive_code ? `?password=${f.receive_code}` : '';
    const link = `https://115.com/s/${f.share_code}${pwd}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(f.id);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Search Header Hero Bar */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
          <input
            id="search-input"
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="输入全路径关键词 (例如：4K, 流浪地球, Interstellar, 架构师, Hi-Res, FLAC, DDIA)..."
            className="w-full pl-12 pr-10 py-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-base"
          />
          {keyword && (
            <button
              onClick={() => setKeyword('')}
              className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-600 text-sm font-medium"
            >
              清空
            </button>
          )}
        </div>

        {/* Filters Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs border-t border-slate-100">
          {/* Extension Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-slate-500 flex items-center gap-1 mr-1">
              <Filter className="w-3.5 h-3.5" />
              后缀:
            </span>
            {quickExts.map((ext) => (
              <button
                key={ext}
                onClick={() => setSelectedExt(selectedExt === ext ? '' : ext)}
                className={`px-2.5 py-1 rounded-full font-medium transition ${
                  selectedExt === ext
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                .{ext}
              </button>
            ))}
            {selectedExt && (
              <button
                onClick={() => setSelectedExt('')}
                className="text-blue-600 hover:underline font-medium ml-1"
              >
                重置
              </button>
            )}
          </div>

          {/* Size Range & IsDir Toggles */}
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
              <button
                onClick={() => setIsDirFilter(false)}
                className={`px-2.5 py-1 rounded-md transition ${!isDirFilter ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-500'}`}
              >
                文件
              </button>
              <button
                onClick={() => setIsDirFilter(true)}
                className={`px-2.5 py-1 rounded-md transition ${isDirFilter ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-500'}`}
              >
                仅文件夹
              </button>
            </div>

            <select
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg border-0 focus:ring-1 focus:ring-blue-500 text-xs font-medium"
            >
              <option value="all">体积不限</option>
              <option value="small">&lt; 100 MB</option>
              <option value="medium">100 MB - 1 GB</option>
              <option value="large">1 GB - 10 GB</option>
              <option value="huge">&gt; 10 GB (超高清/原盘)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Header Info */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-blue-600" />
          PostgreSQL 索引中收录：<strong className="text-slate-800 font-semibold">{files.length}</strong> 个节点，当前匹配：
          <strong className="text-blue-600 font-bold">{searchResults.length}</strong> 条结果
        </span>
        <span className="text-[11px] text-slate-400">
          支持 pg_trgm GIN 三元倒排模糊索引与全路径路径下钻
        </span>
      </div>

      {/* Results Cards List */}
      <div className="space-y-3">
        {searchResults.length > 0 ? (
          searchResults.map((item) => {
            const pwd = item.receive_code ? `?password=${item.receive_code}` : '';
            const shareUrl = `https://115.com/s/${item.share_code}${pwd}`;

            return (
              <div
                key={item.id}
                className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 hover:border-blue-300 shadow-sm hover:shadow transition space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left Info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 shrink-0">
                      {getFileIcon(item.extension, item.is_dir)}
                    </div>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                          {item.is_dir ? 'DIR 目录' : item.extension || 'FILE'}
                        </span>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate" title={item.name}>
                          {item.name}
                        </h3>
                      </div>

                      <div className="text-xs text-slate-500 font-mono truncate flex items-center gap-1">
                        <span className="text-slate-400">路径:</span>
                        <span className="text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                          {item.full_path}
                        </span>
                      </div>

                      {/* Metadata Row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-1">
                        {!item.is_dir && (
                          <span>
                            📦 体积: <strong className="text-slate-800 font-semibold">{formatSize(item.size)}</strong>
                          </span>
                        )}
                        {item.sha1 && (
                          <span className="hidden sm:inline font-mono">
                            🔑 SHA1: <span className="text-slate-700">{item.sha1.substring(0, 10)}...</span>
                          </span>
                        )}
                        <span>
                          📁 所属分享: <span className="text-slate-800 font-medium">{item.share_title}</span>
                        </span>
                        {item.receive_code && (
                          <span>
                            🔒 提取码: <code className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-mono font-semibold">{item.receive_code}</code>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5 transition"
                    >
                      直达 115 提取
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleCopyNodeId(item.file_115_id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium rounded transition flex items-center gap-1"
                        title="复制 115 节点 ID (FID/CID) 用于 AList / OpenList 挂载"
                      >
                        {copiedId === item.file_115_id ? <Check className="w-3 h-3 text-emerald-600" /> : <Hash className="w-3 h-3 text-slate-400" />}
                        {copiedId === item.file_115_id ? '已复制' : '复制节点 ID'}
                      </button>

                      <button
                        onClick={() => onOpenTree(item.share_code)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium rounded transition flex items-center gap-1"
                        title="查看该分享的完整目录树结构"
                      >
                        <Layers className="w-3 h-3 text-slate-400" />
                        目录树
                      </button>

                      <button
                        onClick={() => onReportShare(item.share_code)}
                        className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded transition"
                        title="上报失效链接"
                      >
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Search className="w-6 h-6" />
            </div>
            <h4 className="text-base font-semibold text-slate-700">未找到符合条件的文件资源</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              您可以尝试缩短搜索词、重置后缀筛选条件，或者前往「提交链接」模块添加新的 115 分享链接。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
