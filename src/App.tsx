import React, { useState } from 'react';
import { 
  Search, 
  ListChecks,
  FileCode, 
  FolderTree, 
  PlusCircle, 
  Layers, 
  BookOpen, 
  Download, 
  Database, 
  Server, 
  ShieldCheck, 
  Sparkles,
  ExternalLink,
  HardDrive
} from 'lucide-react';
import { INITIAL_SHARES, INITIAL_FILES } from './data/mockDatabase';
import { SearchEngineView } from './components/SearchEngineView';
import { ShareTaskManager } from './components/ShareTaskManager';
import { CodeExplorer } from './components/CodeExplorer';
import { CrawlerVisualizer } from './components/CrawlerVisualizer';
import { ImporterView } from './components/BatchImportModal';
import { DirectoryTreeView } from './components/DirectoryTreeView';
import { ApiTester } from './components/ApiTester';
import { ProxyManagerView } from './components/ProxyManagerView';
import { ActiveTab, FileRecord, ShareRecord } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('search');
  const [shares, setShares] = useState<ShareRecord[]>(INITIAL_SHARES);
  const [files, setFiles] = useState<FileRecord[]>(INITIAL_FILES);
  const [treeShareCode, setTreeShareCode] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };

  const handleImportSuccess = (newShare: ShareRecord, newFiles: FileRecord[]) => {
    setShares(prev => {
      const exists = prev.find(s => s.share_code === newShare.share_code);
      if (exists) {
        return prev.map(s => s.share_code === newShare.share_code ? { ...s, status: 0 } : s);
      }
      return [newShare, ...prev];
    });
    setFiles(prev => [...newFiles, ...prev]);
    showToast(`成功收录分享：${newShare.title}`);
  };

  const handleTriggerCrawl = (shareCode: string, receiveCode: string) => {
    setShares(prev =>
      prev.map(s => (s.share_code === shareCode ? { ...s, status: 0 } : s))
    );
    showToast(`已开始后台爬取任务：${shareCode}`);

    // Simulate crawler completion after 1.5s
    setTimeout(() => {
      setShares(prev =>
        prev.map(s => {
          if (s.share_code === shareCode) {
            return {
              ...s,
              status: 1,
              file_count: s.file_count > 0 ? s.file_count : 18,
              folder_count: s.folder_count > 0 ? s.folder_count : 3,
              total_size: s.total_size > 0 ? s.total_size : 10737418240,
              last_crawled_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
            };
          }
          return s;
        })
      );
      showToast(`分享 ${shareCode} 抓取并索引完成！`);
    }, 1500);
  };

  const handleOpenTree = (shareCode: string) => {
    setTreeShareCode(shareCode);
    setActiveTab('tree');
  };

  const handleSearchByShare = (shareCode: string) => {
    setActiveTab('search');
    // We can also notify user
    showToast(`正在检索分享：${shareCode}`);
  };

  const handleReportShare = (shareCode: string) => {
    setShares(prev =>
      prev.map(s => (s.share_code === shareCode ? { ...s, status: 2 } : s))
    );
    showToast(`已将分享 ${shareCode} 标记为失效并从搜索中过滤`);
  };

  const pendingCount = shares.filter(s => s.status === 0).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Global Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & Title */}
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
                115
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                  115 分享资源搜索服务
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    FastAPI + PostgreSQL
                  </span>
                </h1>
                <p className="text-[11px] text-slate-500 hidden sm:block">
                  递归爬取 · BFS 目录树 · pg_trgm 全文检索 · OpenList/AList 节点映射
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center space-x-1 sm:space-x-1.5 overflow-x-auto py-2">
              <button
                id="nav-search-tab"
                onClick={() => setActiveTab('search')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'search'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                资源检索
              </button>

              <button
                id="nav-tasks-tab"
                onClick={() => setActiveTab('tasks')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition relative ${
                  activeTab === 'tasks'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <ListChecks className="w-3.5 h-3.5" />
                任务监控
                {pendingCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                )}
              </button>

              <button
                id="nav-import-tab"
                onClick={() => setActiveTab('import')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'import'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                提交链接
              </button>

              <button
                id="nav-crawler-tab"
                onClick={() => setActiveTab('crawler')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'crawler'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                爬虫引擎
              </button>

              <button
                id="nav-proxy-tab"
                onClick={() => setActiveTab('proxy')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'proxy'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                代理池矩阵
              </button>

              <button
                id="nav-tree-tab"
                onClick={() => setActiveTab('tree')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'tree'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                层级目录
              </button>

              <button
                id="nav-code-tab"
                onClick={() => setActiveTab('code')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'code'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                项目源码
              </button>

              <button
                id="nav-api-tab"
                onClick={() => setActiveTab('api')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'api'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                REST API
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'search' && (
          <SearchEngineView
            shares={shares}
            files={files}
            onOpenTree={handleOpenTree}
            onReportShare={handleReportShare}
          />
        )}

        {activeTab === 'tasks' && (
          <ShareTaskManager
            shares={shares}
            onTriggerCrawl={handleTriggerCrawl}
            onOpenTree={handleOpenTree}
            onSearchByShare={handleSearchByShare}
            onReportShare={handleReportShare}
            onOpenImport={() => setActiveTab('import')}
          />
        )}

        {activeTab === 'import' && (
          <ImporterView 
            onImportSuccess={handleImportSuccess} 
            onNavigateToTasks={() => setActiveTab('tasks')}
          />
        )}

        {activeTab === 'crawler' && <CrawlerVisualizer />}
        
        {activeTab === 'proxy' && <ProxyManagerView />}

        {activeTab === 'tree' && (
          <DirectoryTreeView
            shares={shares}
            files={files}
            initialShareCode={treeShareCode}
            onBackToSearch={() => setActiveTab('search')}
          />
        )}

        {activeTab === 'code' && <CodeExplorer />}

        {activeTab === 'api' && <ApiTester />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">115 Share Search Service</span>
            <span>·</span>
            <span>Python 3.11 + FastAPI + PostgreSQL (pg_trgm) + Redis</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <span>BFS Traversal Engine</span>
            <span>·</span>
            <span>OpenList / AList Compatible</span>
          </div>
        </div>
      </footer>

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl z-50 animate-bounce">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
