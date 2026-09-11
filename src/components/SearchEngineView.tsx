import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Folder, 
  FolderOpen,
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
  Sparkles,
  Flame,
  Clock,
  RotateCw,
  X,
  TrendingUp,
  Puzzle,
  HelpCircle,
  Trash2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { FileRecord, ShareRecord, AdSenseConfig } from '../types';
import { CidHelperModal } from './CidHelperModal';
import { AdSenseBanner } from './AdSenseBanner';

interface HotSearchItem {
  id: string;
  keyword: string;
  label: string;
  category: 'movie' | 'tech' | 'music' | 'doc';
  badge?: string;
  badgeStyle?: 'top' | 'hot' | 'new' | 'quality';
}

const ALL_HOT_SEARCHES: HotSearchItem[] = [
  { id: '1', keyword: '星际穿越', label: '星际穿越 4K', category: 'movie', badge: 'TOP 1', badgeStyle: 'top' },
  { id: '2', keyword: '奥本海默', label: '奥本海默 IMAX', category: 'movie', badge: 'HOT', badgeStyle: 'hot' },
  { id: '3', keyword: '沙丘2', label: '沙丘2 杜比视界', category: 'movie', badge: 'HOT', badgeStyle: 'hot' },
  { id: '4', keyword: 'DDIA', label: 'DDIA 数据密集型', category: 'tech', badge: '必读', badgeStyle: 'quality' },
  { id: '5', keyword: 'PostgreSQL', label: 'PostgreSQL 架构', category: 'tech', badge: '核心', badgeStyle: 'quality' },
  { id: '6', keyword: '地球脉动', label: '地球脉动 III 4K', category: 'doc', badge: '4K HDR', badgeStyle: 'quality' },
  { id: '7', keyword: 'Hans Zimmer', label: 'Hans Zimmer 原声', category: 'music', badge: '母带', badgeStyle: 'quality' },
  { id: '8', keyword: 'Beethoven', label: '贝多芬 9号交响曲', category: 'music', badge: 'Hi-Res', badgeStyle: 'quality' },
  { id: '9', keyword: 'Kubernetes', label: 'K8s 生产级实战', category: 'tech', badge: 'NEW', badgeStyle: 'new' },
  { id: '10', keyword: '4K', label: '4K 原盘合集', category: 'movie', badge: '超清', badgeStyle: 'hot' },
  { id: '11', keyword: 'FLAC', label: 'FLAC 24bit Hi-Res', category: 'music', badge: '无损', badgeStyle: 'quality' },
  { id: '12', keyword: '架构师', label: '架构师核心路线', category: 'tech', badge: '精选', badgeStyle: 'quality' },
];

const HOT_CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'movie', name: '🎬 影视' },
  { id: 'tech', name: '💻 技术' },
  { id: 'music', name: '🎵 音乐' },
  { id: 'doc', name: '🌍 纪录片' },
] as const;

interface SearchEngineViewProps {
  shares: ShareRecord[];
  files: FileRecord[];
  onOpenTree: (shareCode: string, targetCid?: string, highlightId?: string) => void;
  onReportShare: (shareCode: string) => void;
  onDeleteShare?: (shareCode: string) => void;
  adsenseConfig?: AdSenseConfig | null;
}

export const SearchEngineView: React.FC<SearchEngineViewProps> = ({
  shares,
  files,
  onOpenTree,
  onReportShare,
  onDeleteShare,
  adsenseConfig,
}) => {
  const [keyword, setKeyword] = useState('');
  const [selectedExt, setSelectedExt] = useState('');
  const [isDirFilter, setIsDirFilter] = useState(false);
  const [sizeFilter, setSizeFilter] = useState<'all' | 'small' | 'medium' | 'large' | 'huge'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<number | null>(null);
  const [isCidHelperOpen, setIsCidHelperOpen] = useState(false);
  const [shareCodeToDelete, setShareCodeToDelete] = useState<{ code: string; title: string } | null>(null);

  // Real Backend PostgreSQL Search Integration
  const [backendItems, setBackendItems] = useState<FileRecord[] | null>(null);
  const [backendTotal, setBackendTotal] = useState<number | null>(null);
  const [backendTotalPages, setBackendTotalPages] = useState<number>(1);
  const [isSearchingBackend, setIsSearchingBackend] = useState<boolean>(false);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 20;

  // Popular / Hot searches states
  const [selectedHotCat, setSelectedHotCat] = useState<'all' | 'movie' | 'tech' | 'music' | 'doc'>('all');
  const [shuffleOffset, setShuffleOffset] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('115_recent_searches');
      return stored ? JSON.parse(stored) : ['星际穿越', 'DDIA', 'Hans Zimmer'];
    } catch {
      return ['星际穿越', 'DDIA', 'Hans Zimmer'];
    }
  });

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

  // Filtered hot searches based on category and shuffle offset
  const displayedHotSearches = useMemo(() => {
    let filtered = selectedHotCat === 'all' 
      ? ALL_HOT_SEARCHES 
      : ALL_HOT_SEARCHES.filter(h => h.category === selectedHotCat);

    if (selectedHotCat === 'all' && shuffleOffset > 0) {
      const offset = shuffleOffset % filtered.length;
      filtered = [...filtered.slice(offset), ...filtered.slice(0, offset)];
    }
    return filtered;
  }, [selectedHotCat, shuffleOffset]);

  const addRecentSearch = (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const updated = [trimmed, ...prev.filter(s => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, 10);
      try {
        localStorage.setItem('115_recent_searches', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const handleSelectKeyword = (kw: string) => {
    setKeyword(kw);
    addRecentSearch(kw);
  };

  const handleHistoryClick = (kw: string) => {
    setKeyword(kw);
    addRecentSearch(kw);
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (keyword.trim()) {
      addRecentSearch(keyword.trim());
    }
  };

  const handleRemoveRecent = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentSearches(prev => {
      const updated = prev.filter(s => s !== kw);
      try {
        localStorage.setItem('115_recent_searches', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const handleClearRecent = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem('115_recent_searches');
    } catch {
      // ignore
    }
  };

  const handleShuffleHot = () => {
    setShuffleOffset(prev => prev + 3);
  };

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [keyword, selectedExt, isDirFilter, sizeFilter]);

  // Query Backend PostgreSQL /api/v1/search
  useEffect(() => {
    let isCancelled = false;
    const executeSearch = async () => {
      setIsSearchingBackend(true);
      try {
        const params = new URLSearchParams();
        if (keyword.trim()) params.set('keyword', keyword.trim());
        if (selectedExt) params.set('extension', selectedExt);
        params.set('is_dir', String(isDirFilter));
        params.set('page', String(currentPage));
        params.set('page_size', String(pageSize));

        if (sizeFilter === 'small') {
          params.set('max_size', String(100 * 1024 * 1024));
        } else if (sizeFilter === 'medium') {
          params.set('min_size', String(100 * 1024 * 1024));
          params.set('max_size', String(1024 * 1024 * 1024));
        } else if (sizeFilter === 'large') {
          params.set('min_size', String(1024 * 1024 * 1024));
          params.set('max_size', String(10 * 1024 * 1024 * 1024));
        } else if (sizeFilter === 'huge') {
          params.set('min_size', String(10 * 1024 * 1024 * 1024));
        }

        const res = await fetch(`/api/v1/search?${params.toString()}`);
        if (!isCancelled) {
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.items)) {
              setBackendItems(data.items);
              setBackendTotal(typeof data.total === 'number' ? data.total : data.items.length);
              setBackendTotalPages(data.total_pages || 1);
              setIsBackendConnected(true);
              return;
            }
          }
          // Backend offline or non-200, fallback to local search
          setBackendItems(null);
          setBackendTotal(null);
          setIsBackendConnected(false);
        }
      } catch {
        if (!isCancelled) {
          setBackendItems(null);
          setBackendTotal(null);
          setIsBackendConnected(false);
        }
      } finally {
        if (!isCancelled) {
          setIsSearchingBackend(false);
        }
      }
    };

    const timer = setTimeout(executeSearch, 250);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [keyword, selectedExt, isDirFilter, sizeFilter, currentPage]);

  // Fallback Local Filtered Results
  const localSearchResults = useMemo(() => {
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

  // Combined Results & Totals
  const searchResults = backendItems !== null ? backendItems : localSearchResults;
  const totalCount = backendTotal !== null ? backendTotal : localSearchResults.length;
  const totalPages = backendItems !== null ? backendTotalPages : Math.ceil(localSearchResults.length / pageSize) || 1;

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
    <div className="space-y-4 sm:space-y-6">
      {/* Search Header Hero Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200 shadow-xs sm:shadow-sm space-y-3 sm:space-y-4">
        {/* Search Input Bar with Submit Button */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2 sm:gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 sm:left-4 top-3.5 w-5 h-5 text-slate-400" />
            <input
              id="search-input"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="输入全路径关键词 (例如：4K, 流浪地球, Interstellar, 架构师, Hi-Res, FLAC)..."
              className="w-full pl-11 sm:pl-12 pr-14 py-3 sm:py-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base min-h-[46px]"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 px-2 py-1 text-xs font-medium bg-slate-100 rounded-md transition"
              >
                清空
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-5 sm:px-6 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl text-sm sm:text-base transition shadow-xs flex items-center justify-center gap-1.5 shrink-0 min-h-[46px]"
          >
            <Search className="w-4 h-4" />
            <span>检索</span>
          </button>
        </form>

        {/* Search History Area (搜索历史区域 - 位于搜索框正下方) */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                搜索历史:
              </span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                记录最近搜索词，点击可自动再次触发检索
              </span>
            </div>
            {recentSearches.length > 0 && (
              <button
                type="button"
                onClick={handleClearRecent}
                className="text-[11px] text-slate-400 hover:text-rose-600 flex items-center gap-1 transition px-1.5 py-0.5 rounded hover:bg-rose-50 font-medium"
                title="清空所有搜索历史"
              >
                <X className="w-3 h-3" />
                <span>清空历史</span>
              </button>
            )}
          </div>

          {recentSearches.length > 0 ? (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap scrollbar-none text-nowrap">
              {recentSearches.map((kw, i) => {
                const isActive = keyword.trim().toLowerCase() === kw.toLowerCase();
                return (
                  <div
                    key={`${kw}-${i}`}
                    className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition border shrink-0 min-h-[30px] ${
                      isActive
                        ? 'bg-blue-50 border-blue-400 text-blue-800 font-semibold ring-1 ring-blue-300/70 shadow-2xs'
                        : 'bg-slate-50 hover:bg-blue-50/60 border-slate-200 hover:border-blue-200 text-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleHistoryClick(kw)}
                      className="hover:text-blue-700 font-medium flex items-center gap-1 text-left"
                      title={`点击再次检索: ${kw}`}
                    >
                      <span>{kw}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveRecent(kw, e)}
                      className="text-slate-400 hover:text-rose-500 hover:bg-slate-200/80 p-0.5 rounded-full transition"
                      title="删除此条记录"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 py-0.5">
              暂无搜索历史，输入关键词按回车或点击「检索」后将自动记录
            </p>
          )}
        </div>

        {/* Popular / Hot Searches (热门搜索快速填入) */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 overflow-x-auto text-nowrap scrollbar-none pb-0.5">
              <span className="font-bold text-slate-800 flex items-center gap-1 shrink-0">
                <Flame className="w-4 h-4 text-orange-500 fill-orange-500/20 shrink-0" />
                热门搜索:
              </span>
              {/* Category Pills */}
              <div className="flex items-center gap-1 shrink-0">
                {HOT_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedHotCat(cat.id)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition ${
                      selectedHotCat === cat.id
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px] text-slate-400 shrink-0">
              <span className="hidden md:inline">轻触关键词即刻过滤</span>
              <button
                type="button"
                onClick={handleShuffleHot}
                className="flex items-center gap-1 text-slate-500 hover:text-orange-600 transition px-1.5 py-0.5 rounded hover:bg-orange-50 font-medium"
                title="换一批热门关键词"
              >
                <RotateCw className="w-3 h-3" />
                <span>换一批</span>
              </button>
            </div>
          </div>

          {/* Hot Search Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap scrollbar-none text-nowrap">
            {displayedHotSearches.map((item) => {
              const isActive = keyword.trim().toLowerCase() === item.keyword.toLowerCase();
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectKeyword(item.keyword)}
                  className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition border shrink-0 min-h-[32px] ${
                    isActive
                      ? 'bg-orange-50 border-orange-400 text-orange-800 font-bold shadow-xs ring-1 ring-orange-300/70'
                      : 'bg-slate-50 hover:bg-slate-100 hover:border-slate-300 border-slate-200 text-slate-700'
                  }`}
                  title={`快速填入关键词: ${item.keyword}`}
                >
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase tracking-tight ${
                      item.badgeStyle === 'top' 
                        ? 'bg-rose-500 text-white' 
                        : item.badgeStyle === 'hot' 
                        ? 'bg-orange-500 text-white' 
                        : item.badgeStyle === 'new'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filters Controls Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 text-xs border-t border-slate-100">
          {/* Extension Filters with horizontal swipe on mobile */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap text-nowrap scrollbar-none">
            <span className="font-semibold text-slate-500 flex items-center gap-1 mr-1 shrink-0">
              <Filter className="w-3.5 h-3.5" />
              后缀:
            </span>
            {quickExts.map((ext) => (
              <button
                key={ext}
                onClick={() => setSelectedExt(selectedExt === ext ? '' : ext)}
                className={`px-2.5 py-1 rounded-full font-medium transition shrink-0 ${
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
                className="text-blue-600 hover:underline font-medium ml-1 shrink-0"
              >
                重置
              </button>
            )}
          </div>

          {/* Size Range & IsDir Toggles */}
          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
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
              className="px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg border-0 focus:ring-1 focus:ring-blue-500 text-xs font-medium cursor-pointer"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1.5 flex-wrap">
          <Database className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>资源搜索结果</span>
          <span>· 共匹配: <strong className="text-blue-600 font-bold">{totalCount}</strong> 条</span>
          {isSearchingBackend && (
            <span className="flex items-center gap-1 text-slate-400">
              <RotateCw className="w-3 h-3 animate-spin text-blue-500" />
              <span>正在检索...</span>
            </span>
          )}
        </span>
        <button
          onClick={() => setIsCidHelperOpen(true)}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 hover:underline transition self-start sm:self-auto"
        >
          <Puzzle className="w-3.5 h-3.5" />
          <span>115 官方链接直达助手 (免密脚本)</span>
        </button>
      </div>

      {/* CID Jump & Notice Banner */}
      <div className="bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-slate-50 border border-blue-200/80 rounded-xl p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-2xs">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
            <Puzzle className="w-4 h-4" />
          </div>
          <div className="space-y-0.5 text-slate-700">
            <p className="font-bold text-slate-900 flex items-center gap-1.5">
              <span>为什么打开 115 官方链接时会停留在根目录？</span>
              <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">使用提示</span>
            </p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              115 官方网页由于机制限制，默认停留在根目录且验证提取码后会自动刷新重置。推荐直接使用本站<strong>「直达所在目录」</strong>展开多层文件夹，或使用<strong>「115 直达助手」</strong>实现官方网页免密并直接进入目标目录！
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsCidHelperOpen(true)}
          className="self-start sm:self-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs transition flex items-center gap-1.5 shrink-0 text-xs active:scale-95 cursor-pointer"
        >
          <span>查看解决方案</span>
        </button>
      </div>

      {/* Google AdSense Top Banner */}
      <AdSenseBanner config={adsenseConfig} slotType="banner" />

      {/* Results Cards List */}
      <div className="space-y-3">
        {searchResults.length > 0 ? (
          searchResults.map((item) => {
            const pwd = item.receive_code ? `?password=${item.receive_code}` : '';
            // 精确计算该文件所在目录的 115 CID
            const targetCid = item.is_dir ? item.file_115_id : (item.parent_115_id || '0');
            const isRoot = !targetCid || targetCid === '0';
            const cidQuery = !isRoot ? (pwd ? `&cid=${targetCid}` : `?cid=${targetCid}`) : '';
            const cidHash = !isRoot ? `#cid=${targetCid}` : '';
            const directCidUrl = item.cid_share_url || `https://115.com/s/${item.share_code}${pwd}${cidQuery}${cidHash}`;

            return (
              <div
                key={item.id}
                className="bg-white rounded-xl p-3.5 sm:p-5 border border-slate-200 hover:border-blue-300 shadow-xs hover:shadow transition space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  {/* Left Info */}
                  <div className="flex items-start gap-2.5 sm:gap-3 flex-1 min-w-0">
                    <div className="p-2 sm:p-2.5 bg-slate-50 rounded-xl border border-slate-100 shrink-0">
                      {getFileIcon(item.extension, item.is_dir)}
                    </div>

                    <div className="space-y-1 sm:space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700 shrink-0">
                          {item.is_dir ? 'DIR 目录' : item.extension || 'FILE'}
                        </span>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 break-all sm:truncate" title={item.name}>
                          {item.name}
                        </h3>
                      </div>

                      <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-400 shrink-0">路径:</span>
                        <span className="text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 break-all text-[11px] sm:text-xs">
                          {item.full_path}
                        </span>
                        <button
                          onClick={() => onOpenTree(item.share_code, targetCid, item.file_115_id)}
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline px-1.5 py-0.5 rounded bg-blue-50/70 border border-blue-100 transition"
                          title={`直达所在目录 (CID: ${targetCid})`}
                        >
                          <FolderOpen className="w-3 h-3 text-blue-600" />
                          <span>直达目录</span>
                        </button>
                      </div>

                      {/* Metadata Row */}
                      <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 text-xs text-slate-500 pt-1">
                        {!item.is_dir && (
                          <span>
                            📦 体积: <strong className="text-slate-800 font-semibold">{formatSize(item.size)}</strong>
                          </span>
                        )}
                        {item.sha1 && (
                          <span className="hidden md:inline font-mono">
                            🔑 SHA1: <span className="text-slate-700">{item.sha1.substring(0, 8)}...</span>
                          </span>
                        )}
                        <span className="truncate max-w-[200px] sm:max-w-xs">
                          📁 分享: <span className="text-slate-800 font-medium">{item.share_title}</span>
                        </span>
                        {item.receive_code && (
                          <span>
                            🔒 密码: <code className="bg-amber-50 text-amber-800 border border-amber-200 px-1 py-0.2 rounded font-mono font-semibold text-[11px]">{item.receive_code}</code>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Row / Column */}
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                    <div className="flex flex-col items-center sm:items-end w-full sm:w-auto">
                      <a
                        href={directCidUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full sm:w-auto justify-center px-3.5 py-2 sm:py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5 transition min-h-[38px] active:scale-95"
                        title={!isRoot ? `在 115 官方页面直达该目录 (#cid=${targetCid})` : '打开 115 分享根目录'}
                      >
                        直达 115 提取
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      {!isRoot && (
                        <button
                          type="button"
                          onClick={() => setIsCidHelperOpen(true)}
                          className="text-[10px] text-slate-400 hover:text-blue-600 flex items-center gap-0.5 mt-1 transition"
                          title="115 官方页面默认停留在顶层。点击了解如何免密直达目标目录！"
                        >
                          <HelpCircle className="w-3 h-3" />
                          <span>官方跳根目录？</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleCopyNodeId(item.file_115_id)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium rounded-lg transition flex items-center gap-1 min-h-[36px] active:scale-95"
                        title="复制 115 资源节点 ID"
                      >
                        {copiedId === item.file_115_id ? <Check className="w-3 h-3 text-emerald-600" /> : <Hash className="w-3 h-3 text-slate-400" />}
                        {copiedId === item.file_115_id ? '已复制' : '复制ID'}
                      </button>

                      {/* Jump directly to CID folder or open root tree */}
                      <button
                        onClick={() => onOpenTree(item.share_code, targetCid, item.file_115_id)}
                        className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold rounded-lg transition flex items-center gap-1 min-h-[36px] active:scale-95 border border-indigo-100 shadow-2xs"
                        title={item.is_dir ? '进入该文件夹' : '定位到所在父目录并高亮该文件'}
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-indigo-600" />
                        <span>{item.is_dir ? '进入该目录' : '直达所在目录'}</span>
                        {!isRoot && (
                          <span className="text-[9px] font-mono px-1 py-0.2 bg-indigo-100 rounded text-indigo-800 font-bold">
                            CID
                          </span>
                        )}
                      </button>

                      <button
                        onClick={() => onReportShare(item.share_code)}
                        className="p-2 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
                        title="上报失效链接"
                      >
                        <Flag className="w-3.5 h-3.5" />
                      </button>

                      {onDeleteShare && (
                        <button
                          onClick={() => setShareCodeToDelete({ code: item.share_code, title: item.share_title })}
                          className="p-2 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
                          title="彻底移除该分享链接并级联清理名下全部文件"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white rounded-2xl p-6 sm:p-10 border border-slate-200 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Search className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-semibold text-slate-700">未找到符合条件的文件资源</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                您可以尝试缩短搜索词、重置后缀筛选条件，或直接点击以下热门推荐快速填入：
              </p>
            </div>

            {/* Quick hot recommendations in empty state */}
            <div className="flex items-center justify-center flex-wrap gap-2 pt-2 max-w-md mx-auto">
              {ALL_HOT_SEARCHES.slice(0, 6).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectKeyword(item.keyword)}
                  className="px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shadow-2xs"
                >
                  <Flame className="w-3 h-3 text-orange-500 fill-orange-500/20" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-2xs text-xs">
          <div className="text-slate-500">
            共 <strong className="text-slate-900 font-semibold">{totalCount}</strong> 条检索结果，当前显示第 <strong className="text-blue-600 font-bold">{currentPage}</strong> / {totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCurrentPage(p => Math.max(1, p - 1));
                window.scrollTo({ top: 300, behavior: 'smooth' });
              }}
              disabled={currentPage <= 1 || isSearchingBackend}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition shadow-2xs font-medium"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>上一页</span>
            </button>
            <div className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-bold text-xs">
              {currentPage} / {totalPages}
            </div>
            <button
              type="button"
              onClick={() => {
                setCurrentPage(p => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 300, behavior: 'smooth' });
              }}
              disabled={currentPage >= totalPages || isSearchingBackend}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition shadow-2xs font-medium"
            >
              <span>下一页</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* CID Jump & Tampermonkey Modal */}
      <CidHelperModal
        isOpen={isCidHelperOpen}
        onClose={() => setIsCidHelperOpen(false)}
        onNavigateToTree={() => {
          if (searchResults.length > 0) {
            const first = searchResults[0];
            const cid = first.is_dir ? first.file_115_id : (first.parent_115_id || '0');
            onOpenTree(first.share_code, cid, first.file_115_id);
          }
        }}
      />

      {/* Delete Share Confirmation Modal */}
      {shareCodeToDelete && (
        <div 
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setShareCodeToDelete(null)}
        >
          <div 
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">彻底移除此分享与关联文件？</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                您即将从搜索数据库中彻底删除分享「<span className="font-bold text-slate-800">{shareCodeToDelete.title || shareCodeToDelete.code}</span>」（代码: <span className="font-mono font-bold text-slate-800">{shareCodeToDelete.code}</span>）。
              </p>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>级联清理提示</span>
              </div>
              <p className="leading-relaxed">
                此操作将<strong className="text-rose-700 font-bold">同步删除该分享名下的全部文件与目录记录</strong>，防止因分享失效导致搜索结果出现无效死链。
              </p>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShareCodeToDelete(null)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteShare && shareCodeToDelete) {
                    onDeleteShare(shareCodeToDelete.code);
                  }
                  setShareCodeToDelete(null);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>确认彻底移除</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
