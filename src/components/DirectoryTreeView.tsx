import React, { useState } from 'react';
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
  ChevronsUpDown
} from 'lucide-react';
import { FileRecord, ShareRecord } from '../types';

interface DirectoryTreeViewProps {
  shares: ShareRecord[];
  files: FileRecord[];
  initialShareCode?: string;
  onBackToSearch: () => void;
}

export const DirectoryTreeView: React.FC<DirectoryTreeViewProps> = ({
  shares,
  files,
  initialShareCode,
  onBackToSearch,
}) => {
  const [selectedShareCode, setSelectedShareCode] = useState<string>(
    initialShareCode || (shares[0]?.share_code || '')
  );
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    '0': true,
    'cid_1001': true,
    'cid_2001': true,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeShare = shares.find(s => s.share_code === selectedShareCode);
  const shareFiles = files.filter(f => f.share_code === selectedShareCode);

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

  // Render tree level recursively
  const renderLevel = (parentId: string, depth: number = 0) => {
    const children = shareFiles.filter(f => f.parent_115_id === parentId);
    if (children.length === 0) return null;

    return (
      <div className="space-y-1">
        {children.map(item => {
          const isExpanded = !!expandedFolders[item.file_115_id];
          // Indent: controlled to prevent overflow on small mobile screens
          const paddingLeft = `${Math.min(depth * 14 + 6, 60)}px`;

          if (item.is_dir) {
            return (
              <div key={item.id} className="space-y-1">
                <div
                  style={{ paddingLeft }}
                  onClick={() => toggleFolder(item.file_115_id)}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 cursor-pointer text-xs group transition min-h-[40px]"
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
                    <span className="font-semibold text-slate-800 truncate">{item.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">CID: {item.file_115_id}</span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(item.file_115_id);
                    }}
                    className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 px-2 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-600 transition shrink-0 min-h-[28px]"
                  >
                    {copiedId === item.file_115_id ? '已复制' : '复制CID'}
                  </button>
                </div>

                {isExpanded && renderLevel(item.file_115_id, depth + 1)}
              </div>
            );
          }

          const filePaddingLeft = `${Math.min(depth * 14 + 22, 70)}px`;

          return (
            <div
              key={item.id}
              style={{ paddingLeft: filePaddingLeft }}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 text-xs transition border-b border-slate-50 last:border-0 min-h-[38px]"
            >
              <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-2">
                <File className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-800 truncate" title={item.name}>{item.name}</span>
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

  return (
    <div className="space-y-4">
      {/* Header */}
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
              对应 115 CID/FID 树形展开与 OpenList/AList 挂载映射
            </p>
          </div>
        </div>

        {/* Share Selector Dropdown & Quick Toggles */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedShareCode}
            onChange={(e) => setSelectedShareCode(e.target.value)}
            className="flex-1 sm:flex-none px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[36px]"
          >
            {shares.map(s => (
              <option key={s.share_code} value={s.share_code}>
                {s.title || s.share_code} ({s.share_code})
              </option>
            ))}
          </select>

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
        </div>
      </div>

      {/* Share Meta Summary Card */}
      {activeShare && (
        <div className="bg-blue-50/60 p-3 sm:p-4 rounded-xl border border-blue-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-blue-900">
          <div className="space-y-0.5">
            <h3 className="font-bold text-slate-900 text-xs sm:text-sm break-all">{activeShare.title}</h3>
            <p className="text-blue-700 font-mono text-[11px] flex flex-wrap gap-2">
              <span>Code: {activeShare.share_code}</span>
              <span>| 提取码: {activeShare.receive_code || '无'}</span>
              <span>| 总大小: {formatSize(activeShare.total_size)}</span>
            </p>
          </div>

          <a
            href={`https://115.com/s/${activeShare.share_code}${activeShare.receive_code ? `?password=${activeShare.receive_code}` : ''}`}
            target="_blank"
            rel="noreferrer"
            className="self-start sm:self-auto px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition min-h-[36px]"
          >
            前往 115 页面
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Tree Content Panel */}
      <div className="bg-white rounded-xl p-3 sm:p-4 border border-slate-200 shadow-xs min-h-[360px] overflow-x-auto">
        {shareFiles.length > 0 ? (
          renderLevel('0', 0)
        ) : (
          <div className="text-center py-16 text-slate-400 text-xs">
            该分享下暂无文件节点或正在抓取中...
          </div>
        )}
      </div>
    </div>
  );
};
