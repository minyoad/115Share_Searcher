import React, { useState, useEffect, useMemo } from 'react';
import { 
  Folder, 
  FolderOpen, 
  File, 
  ChevronRight, 
  ChevronDown, 
  ArrowLeft,
  Copy, 
  Check, 
  ExternalLink,
  Layers,
  Home,
  ArrowUp,
  Hash,
  Compass,
  Film,
  Music,
  BookOpen,
  Archive
} from 'lucide-react';
import { FileRecord, ShareRecord } from '../types';

interface DirectoryTreeViewProps {
  shares: ShareRecord[];
  files: FileRecord[];
  initialShareCode?: string;
  initialCid?: string;
  highlightId?: string;
  onBackToSearch: () => void;
}

interface BreadcrumbItem {
  cid: string;
  name: string;
  path: string;
}

export const DirectoryTreeView: React.FC<DirectoryTreeViewProps> = ({
  shares,
  files,
  initialShareCode,
  initialCid = '0',
  highlightId = '',
  onBackToSearch,
}) => {
  const [selectedShareCode, setSelectedShareCode] = useState<string>(
    initialShareCode || (shares[0]?.share_code || '')
  );
  const [currentCid, setCurrentCid] = useState<string>(initialCid || '0');
  const [highlightTargetId, setHighlightTargetId] = useState<string>(highlightId || '');
  const [viewMode, setViewMode] = useState<'tree' | 'folder'>('tree');
  const [filterKw, setFilterKw] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Initialize expanded folders
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    '0': true,
  });

  const activeShare = shares.find(s => s.share_code === selectedShareCode);
  const shareFiles = useMemo(() => {
    return files.filter(f => f.share_code === selectedShareCode);
  }, [files, selectedShareCode]);

  // Synchronize when initial props change
  useEffect(() => {
    if (initialShareCode) {
      setSelectedShareCode(initialShareCode);
    }
  }, [initialShareCode]);

  // Build breadcrumb trail for a given target CID
  const buildBreadcrumbs = (targetCid: string): BreadcrumbItem[] => {
    if (!targetCid || targetCid === '0') return [];
    const crumbs: BreadcrumbItem[] = [];
    let currId = targetCid;
    let safety = 0;
    while (currId && currId !== '0' && safety < 30) {
      safety++;
      const node = shareFiles.find(f => f.file_115_id === currId);
      if (!node) break;
      crumbs.unshift({
        cid: node.file_115_id,
        name: node.name,
        path: node.full_path,
      });
      currId = node.parent_115_id;
    }
    return crumbs;
  };

  // When initialCid or highlightId changes, auto expand ancestors and navigate
  useEffect(() => {
    if (initialCid !== undefined) {
      const target = initialCid || '0';
      setCurrentCid(target);
      if (target !== '0') {
        const crumbs = buildBreadcrumbs(target);
        const newExpanded: Record<string, boolean> = { '0': true };
        crumbs.forEach(c => {
          newExpanded[c.cid] = true;
        });
        newExpanded[target] = true;
        setExpandedFolders(prev => ({ ...prev, ...newExpanded }));
      }
    }
    if (highlightId !== undefined) {
      setHighlightTargetId(highlightId || '');
    }
  }, [initialCid, highlightId, selectedShareCode, shareFiles]);

  const breadcrumbs = useMemo(() => {
    return buildBreadcrumbs(currentCid);
  }, [currentCid, shareFiles]);

  const currentFolderNode = useMemo(() => {
    if (currentCid === '0') return null;
    return shareFiles.find(f => f.file_115_id === currentCid);
  }, [currentCid, shareFiles]);

  const toggleFolder = (nodeId: string) => {
    setExpandedFolders(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const expandAll = () => {
    const allDirs = shareFiles.filter(f => f.is_dir);
    const newExpanded: Record<string, boolean> = { '0': true };
    allDirs.forEach(d => { newExpanded[d.file_115_id] = true; });
    setExpandedFolders(newExpanded);
  };

  const collapseAll = () => {
    setExpandedFolders({ '0': true });
  };

  const drillDown = (cid: string) => {
    setCurrentCid(cid);
    setExpandedFolders(prev => ({ ...prev, [cid]: true, '0': true }));
  };

  const goUpOneLevel = () => {
    if (currentCid === '0') return;
    const parentId = currentFolderNode?.parent_115_id || '0';
    setCurrentCid(parentId);
  };

  const goToRoot = () => {
    setCurrentCid('0');
  };

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let s = bytes;
    while (s >= 1024 && i < units.length - 1) {
      s /= 1024;
      i++;
    }
    return `${s.toFixed(2)} ${units[i]}`;
  };

  const handleCopy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    setCopiedId(txt);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getFileIcon = (ext: string, isDir: boolean) => {
    if (isDir) return <Folder className="w-4 h-4 text-amber-500 shrink-0" />;
    if (['mkv', 'mp4', 'avi', 'mov'].includes(ext)) return <Film className="w-4 h-4 text-purple-500 shrink-0" />;
    if (['flac', 'mp3', 'wav', 'aac'].includes(ext)) return <Music className="w-4 h-4 text-emerald-500 shrink-0" />;
    if (['pdf', 'epub', 'mobi', 'txt'].includes(ext)) return <BookOpen className="w-4 h-4 text-rose-500 shrink-0" />;
    if (['zip', 'rar', '7z', 'tar', 'iso'].includes(ext)) return <Archive className="w-4 h-4 text-blue-500 shrink-0" />;
    return <File className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  // Render tree level recursively
  const renderLevel = (parentId: string, depth: number = 0) => {
    let children = shareFiles.filter(f => f.parent_115_id === parentId);
    if (filterKw.trim()) {
      const kw = filterKw.trim().toLowerCase();
      children = children.filter(c => c.name.toLowerCase().includes(kw));
    }
    if (children.length === 0) return null;

    return (
      <div className="space-y-1">
        {children.map(item => {
          const isExpanded = !!expandedFolders[item.file_115_id];
          const isCurrentDir = currentCid === item.file_115_id;
          const isHighlighted = highlightTargetId === item.file_115_id;
          const paddingLeft = `${Math.min(depth * 16 + 8, 80)}px`;

          if (item.is_dir) {
            return (
              <div key={item.id} className="space-y-1">
                <div
                  style={{ paddingLeft }}
                  onClick={() => toggleFolder(item.file_115_id)}
                  className={`flex items-center justify-between p-2 rounded-xl cursor-pointer text-xs group transition min-h-[42px] ${
                    isCurrentDir
                      ? 'bg-blue-50 border border-blue-200 shadow-2xs font-semibold'
                      : isHighlighted
                      ? 'bg-amber-50 border border-amber-300 ring-2 ring-amber-400/30 shadow-2xs'
                      : 'hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-2">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <span className="font-semibold text-slate-900 truncate">{item.name}</span>
                    
                    {isHighlighted && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 shrink-0">
                        🎯 搜索命中目标
                      </span>
                    )}

                    {isCurrentDir && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 shrink-0">
                        当前所在目录
                      </span>
                    )}

                    <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">CID: {item.file_115_id}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        drillDown(item.file_115_id);
                      }}
                      className="px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded text-[10px] font-medium text-blue-600 transition"
                      title="单独进入并浏览此目录"
                    >
                      直达此目录 ➔
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(item.file_115_id);
                      }}
                      className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 px-2 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-600 transition min-h-[28px]"
                      title="复制 115 CID"
                    >
                      {copiedId === item.file_115_id ? '已复制' : '复制CID'}
                    </button>
                  </div>
                </div>

                {isExpanded && renderLevel(item.file_115_id, depth + 1)}
              </div>
            );
          }

          const filePaddingLeft = `${Math.min(depth * 16 + 24, 90)}px`;

          return (
            <div
              key={item.id}
              style={{ paddingLeft: filePaddingLeft }}
              className={`flex items-center justify-between p-2 rounded-xl text-xs transition border-b border-slate-50 last:border-0 min-h-[40px] ${
                isHighlighted
                  ? 'bg-amber-50/90 border-2 border-amber-400 shadow-2xs font-semibold'
                  : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-2">
                {getFileIcon(item.extension, false)}
                <span className="text-slate-800 truncate" title={item.name}>{item.name}</span>
                {isHighlighted && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 shrink-0">
                    🎯 搜索命中文件
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 text-slate-500 text-[11px]">
                <span className="font-mono text-slate-700 text-[10px] sm:text-[11px]">{formatSize(item.size)}</span>
                <button
                  onClick={() => handleCopy(item.file_115_id)}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[10px] text-slate-600 transition min-h-[28px]"
                  title="复制 FID"
                >
                  {copiedId === item.file_115_id ? '已复制' : '复制FID'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Direct children for Folder View
  const currentFolderChildren = useMemo(() => {
    let list = shareFiles.filter(f => f.parent_115_id === currentCid);
    if (filterKw.trim()) {
      const kw = filterKw.trim().toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(kw));
    }
    // Sort directories first, then alphabetical
    return list.sort((a, b) => {
      if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
      return a.is_dir ? -1 : 1;
    });
  }, [shareFiles, currentCid, filterKw]);

  // Direct 115 link for current folder
  const current115Url = useMemo(() => {
    if (!activeShare) return '';
    const pwd = activeShare.receive_code ? `?password=${activeShare.receive_code}` : '';
    const cidHash = currentCid !== '0' ? `#cid=${currentCid}` : '';
    return `https://115.com/s/${activeShare.share_code}${pwd}${cidHash}`;
  }, [activeShare, currentCid]);

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBackToSearch}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition min-w-[36px] min-h-[36px] flex items-center justify-center"
            title="返回搜索页"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-600 shrink-0" />
              115 分享目录层级树
            </h2>
            <p className="text-[11px] text-slate-500 hidden sm:block">
              支持按 CID 精确直达目录、多级树状展开、AList/OpenList 挂载节点提取
            </p>
          </div>
        </div>

        {/* Share Selector Dropdown & Quick Toggles */}
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
          <select
            value={selectedShareCode}
            onChange={(e) => {
              setSelectedShareCode(e.target.value);
              setCurrentCid('0');
              setHighlightTargetId('');
            }}
            className="flex-1 sm:flex-none px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[36px]"
          >
            {shares.map(s => (
              <option key={s.share_code} value={s.share_code}>
                {s.title || s.share_code} ({s.share_code})
              </option>
            ))}
          </select>

          {/* View Mode Toggle: Tree vs Folder View */}
          <div className="flex items-center border border-slate-200 rounded-lg p-0.5 bg-slate-50 shrink-0">
            <button
              onClick={() => setViewMode('tree')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                viewMode === 'tree'
                  ? 'bg-white text-blue-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="完整树状层级展开"
            >
              🌲 树状
            </button>
            <button
              onClick={() => setViewMode('folder')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                viewMode === 'folder'
                  ? 'bg-white text-blue-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="当前目录单层浏览 (网盘管理器风格)"
            >
              📂 单层
            </button>
          </div>

          {viewMode === 'tree' && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={expandAll}
                className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg min-h-[36px]"
                title="全部展开"
              >
                全部展开
              </button>
              <button
                onClick={collapseAll}
                className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg min-h-[36px]"
                title="全部收起"
              >
                收起
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Share Meta Summary & Direct Jump Banner */}
      {activeShare && (
        <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 p-3 sm:p-4 rounded-xl border border-blue-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-900 text-xs sm:text-sm">{activeShare.title}</h3>
              <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-blue-200 font-semibold text-blue-800 text-[11px]">
                {activeShare.share_code}
              </span>
              {activeShare.receive_code && (
                <span className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                  提取码: {activeShare.receive_code}
                </span>
              )}
            </div>
            <div className="text-slate-600 flex items-center gap-3 text-[11px]">
              <span>总大小: <strong className="text-slate-800">{formatSize(activeShare.total_size)}</strong></span>
              <span>包含: <strong className="text-slate-800">{activeShare.folder_count}</strong> 文件夹 / <strong className="text-slate-800">{activeShare.file_count}</strong> 文件</span>
              {currentCid !== '0' && (
                <span className="bg-blue-100/90 text-blue-900 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                  📍 当前定位 CID: <code className="font-mono">{currentCid}</code>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {currentCid !== '0' && (
              <button
                onClick={goToRoot}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 flex items-center gap-1 transition"
                title="返回分享根目录"
              >
                <Home className="w-3.5 h-3.5" />
                <span>返回根目录</span>
              </button>
            )}

            <a
              href={current115Url}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
              title={currentCid !== '0' ? `直接在 115 网页端打开当前 CID 目录 (#cid=${currentCid})` : '打开 115 分享根目录'}
            >
              <span>{currentCid !== '0' ? '115 带 CID 直达 ↗' : '115 原网页 ↗'}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Directory Navigation & Breadcrumbs Bar */}
      <div className="bg-white rounded-xl p-3 sm:p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          {/* Breadcrumb Path Trail */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-600 font-medium overflow-x-auto max-w-full">
            <button
              onClick={goToRoot}
              className={`px-2 py-1 rounded transition flex items-center gap-1 ${
                currentCid === '0'
                  ? 'font-bold text-blue-700 bg-blue-50'
                  : 'hover:bg-slate-100 text-slate-700'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>根目录</span>
            </button>

            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.cid}>
                  <span className="text-slate-300">/</span>
                  <button
                    onClick={() => drillDown(crumb.cid)}
                    className={`px-2 py-1 rounded transition ${
                      isLast
                        ? 'font-bold text-blue-700 bg-blue-50'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                    title={`跳转到目录: ${crumb.name} (CID: ${crumb.cid})`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Quick Actions: Go up & Filter */}
          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            {currentCid !== '0' && (
              <button
                onClick={goUpOneLevel}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition flex items-center gap-1"
                title="返回上一级目录"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>返回上级</span>
              </button>
            )}

            <input
              type="text"
              value={filterKw}
              onChange={(e) => setFilterKw(e.target.value)}
              placeholder="筛选目录内名称..."
              className="px-2.5 py-1 border border-slate-200 rounded-lg text-xs w-32 sm:w-44 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Current Folder Path & CID Info Tag */}
        {currentFolderNode && (
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 truncate">
              <Folder className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-slate-500 font-mono text-[11px] truncate">
                绝对路径: <strong className="text-slate-800 font-sans">{currentFolderNode.full_path}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                CID: {currentFolderNode.file_115_id}
              </span>
              <button
                onClick={() => handleCopy(currentFolderNode.file_115_id)}
                className="px-2 py-0.5 bg-white hover:bg-slate-100 rounded border border-slate-200 text-[11px] text-slate-600 transition"
                title="复制当前目录 CID 用于 AList / OpenList 挂载"
              >
                {copiedId === currentFolderNode.file_115_id ? '已复制' : '复制当前CID'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area: Tree View or Folder View */}
      <div className="bg-white rounded-xl p-3 sm:p-4 border border-slate-200 shadow-xs min-h-[360px]">
        {shareFiles.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-xs">
            该分享下暂无文件节点或正在后台爬取中...
          </div>
        ) : viewMode === 'tree' ? (
          <div className="space-y-1">
            {renderLevel('0', 0)}
          </div>
        ) : (
          /* Folder Single Level View (Manager style) */
          <div className="space-y-2">
            {currentFolderChildren.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                当前目录下无文件或未匹配到筛选关键词
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                {currentFolderChildren.map(item => {
                  const isHighlighted = highlightTargetId === item.file_115_id;

                  return (
                    <div
                      key={item.id}
                      className={`p-3 transition flex items-center justify-between gap-3 ${
                        isHighlighted
                          ? 'bg-amber-50/90 border-2 border-amber-400 shadow-2xs font-semibold'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {item.is_dir ? (
                          <div
                            onClick={() => drillDown(item.file_115_id)}
                            className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold cursor-pointer hover:bg-amber-100 transition shrink-0"
                            title="点击进入子文件夹"
                          >
                            <Folder className="w-4 h-4 text-amber-600" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                            {getFileIcon(item.extension, false)}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {item.is_dir ? (
                              <h4
                                onClick={() => drillDown(item.file_115_id)}
                                className="text-xs sm:text-sm font-bold text-slate-900 hover:text-blue-600 cursor-pointer truncate transition"
                                title={item.name}
                              >
                                {item.name}
                              </h4>
                            ) : (
                              <h4
                                className="text-xs sm:text-sm font-medium text-slate-800 truncate"
                                title={item.name}
                              >
                                {item.name}
                              </h4>
                            )}

                            {isHighlighted && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 shrink-0">
                                🎯 搜索目标
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-slate-400">
                            {!item.is_dir && <span>大小: <strong className="text-slate-600">{formatSize(item.size)}</strong></span>}
                            <span className="font-mono text-[10px]">ID: {item.file_115_id}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {item.is_dir ? (
                          <button
                            onClick={() => drillDown(item.file_115_id)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold rounded-lg transition"
                          >
                            进入 ➔
                          </button>
                        ) : null}

                        <button
                          onClick={() => handleCopy(item.file_115_id)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded transition"
                          title="复制 115 节点 ID"
                        >
                          {copiedId === item.file_115_id ? '已复制' : '复制ID'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
