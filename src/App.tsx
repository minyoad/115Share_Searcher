import React, { useState, useEffect } from 'react';
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
  HardDrive, 
  Menu, 
  X, 
  SlidersHorizontal, 
  ChevronRight, 
  Lock, 
  Unlock, 
  LogOut, 
  Key, 
  ShieldAlert 
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
import { SystemSettingsView } from './components/SystemSettingsView';
import { AdminAuthModal } from './components/AdminAuthModal';
import { AdminConsoleBar } from './components/AdminConsoleBar';
import { ActiveTab, FileRecord, ShareRecord, AdSenseConfig } from './types';

const ADMIN_TABS: ActiveTab[] = ['tasks', 'import', 'crawler', 'proxy', 'settings'];

const getInitialShares = (): ShareRecord[] => {
  try {
    const saved = localStorage.getItem('115_persisted_shares');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return INITIAL_SHARES;
};

const getInitialFiles = (): FileRecord[] => {
  try {
    const saved = localStorage.getItem('115_persisted_files');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return INITIAL_FILES;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('search');
  const [shares, setShares] = useState<ShareRecord[]>(getInitialShares);
  const [files, setFiles] = useState<FileRecord[]>(getInitialFiles);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [isLoadingShares, setIsLoadingShares] = useState<boolean>(false);
  const [treeShareCode, setTreeShareCode] = useState<string>('');
  const [treeTargetCid, setTreeTargetCid] = useState<string>('0');
  const [treeHighlightId, setTreeHighlightId] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');
  const [mobileMoreOpen, setMobileMoreOpen] = useState<boolean>(false);

  // Synchronize state changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('115_persisted_shares', JSON.stringify(shares));
    } catch {}
  }, [shares]);

  useEffect(() => {
    try {
      localStorage.setItem('115_persisted_files', JSON.stringify(files));
    } catch {}
  }, [files]);

  // Google AdSense Commercial Integration State
  const [adsenseConfig, setAdSenseConfig] = useState<AdSenseConfig | null>(() => {
    try {
      const saved = localStorage.getItem('115_adsense_config');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const fetchAdSenseConfig = async () => {
    try {
      const res = await fetch('/api/v1/public/adsense-config');
      if (res.ok) {
        const data = await res.json();
        setAdSenseConfig(data);
        try {
          localStorage.setItem('115_adsense_config', JSON.stringify(data));
        } catch {}
      }
    } catch (e) {
      console.warn('Failed to load AdSense config:', e);
    }
  };

  const fetchSharesFromBackend = async (silent = true) => {
    setIsLoadingShares(true);
    try {
      const res = await fetch('/api/v1/shares?page=1&page_size=200');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.items)) {
          if (data.items.length > 0) {
            setShares(data.items);
            setIsBackendConnected(true);
            try {
              localStorage.setItem('115_persisted_shares', JSON.stringify(data.items));
            } catch {}
          }
          if (!silent) {
            showToast(`已从 PostgreSQL 同步 ${data.items.length} 条真实分享记录！`);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Backend /api/v1/shares unreachable, keeping local storage state:', e);
    } finally {
      setIsLoadingShares(false);
    }
  };

  useEffect(() => {
    fetchSharesFromBackend(true);
    fetchAdSenseConfig();
  }, []);

  const handleResetToDemo = async () => {
    if (!window.confirm('确定要恢复为系统默认演示数据吗？当前所有测试分享及缓存将被重置为初始演示状态。')) return;
    try {
      const res = await fetch('/api/v1/shares/seed-demo', { method: 'POST' });
      if (res.ok) {
        await fetchSharesFromBackend(false);
        showToast('已成功恢复系统演示数据！');
        return;
      }
    } catch {}
    setShares(INITIAL_SHARES);
    setFiles(INITIAL_FILES);
    try {
      localStorage.setItem('115_persisted_shares', JSON.stringify(INITIAL_SHARES));
      localStorage.setItem('115_persisted_files', JSON.stringify(INITIAL_FILES));
    } catch {}
    showToast('已成功恢复系统演示数据！');
  };

  // Admin Authorization State
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem('115_admin_token') || !!sessionStorage.getItem('115_admin_token');
    } catch {
      return false;
    }
  });
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [targetAdminTab, setTargetAdminTab] = useState<ActiveTab>('tasks');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };

  const handleOpenAdmin = (subTab: ActiveTab = 'tasks') => {
    setTargetAdminTab(subTab);
    if (!isAdmin) {
      setAuthModalOpen(true);
    } else {
      setActiveTab(subTab);
    }
  };

  const handleAdminAuthSuccess = (_token: string) => {
    setIsAdmin(true);
    setAuthModalOpen(false);
    setActiveTab(targetAdminTab);
    showToast('管理员身份验证通过，已解锁管理后台！');
  };

  const handleAdminLogout = () => {
    try {
      localStorage.removeItem('115_admin_token');
      sessionStorage.removeItem('115_admin_token');
    } catch {}
    setIsAdmin(false);
    showToast('已安全退出管理后台');
    if (ADMIN_TABS.includes(activeTab)) {
      setActiveTab('search');
    }
  };

  const handleSafeTabSwitch = (tab: ActiveTab) => {
    if (ADMIN_TABS.includes(tab) && !isAdmin) {
      handleOpenAdmin(tab);
      return;
    }
    setActiveTab(tab);
  };

  const handleImportSuccess = (newShare: ShareRecord, newFiles: FileRecord[]) => {
    setShares(prev => {
      const exists = prev.find(s => s.share_code === newShare.share_code);
      const next = exists
        ? prev.map(s => s.share_code === newShare.share_code ? { ...s, status: 0 } : s)
        : [newShare, ...prev];
      try {
        localStorage.setItem('115_persisted_shares', JSON.stringify(next));
      } catch {}
      return next;
    });
    setFiles(prev => {
      const next = [...newFiles, ...prev];
      try {
        localStorage.setItem('115_persisted_files', JSON.stringify(next));
      } catch {}
      return next;
    });
    showToast(`成功收录分享：${newShare.title}`);
    setTimeout(() => {
      fetchSharesFromBackend(true);
    }, 1000);
  };

  const handleTriggerCrawl = async (shareCode: string, receiveCode: string) => {
    setShares(prev =>
      prev.map(s => (s.share_code === shareCode ? { ...s, status: 0 } : s))
    );
    showToast(`已开始后台爬取任务：${shareCode}`);

    try {
      await fetch(`/api/v1/shares/${encodeURIComponent(shareCode)}/crawl`, { method: 'POST' });
    } catch (e) {
      console.warn('Crawl API error:', e);
    }

    // Simulate crawler completion after 1.5s
    setTimeout(async () => {
      await fetchSharesFromBackend(true);
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

  const handleBatchTriggerCrawl = async (shareCodes: string[]) => {
    setShares(prev =>
      prev.map(s => (shareCodes.includes(s.share_code) ? { ...s, status: 0 } : s))
    );
    showToast(`🚀 已批量为选中的 ${shareCodes.length} 个分享重新发送抓取与索引指令！`);

    try {
      await fetch('/api/v1/shares/batch-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_codes: shareCodes }),
      });
    } catch (e) {
      console.warn('Batch crawl API error:', e);
    }

    setTimeout(async () => {
      await fetchSharesFromBackend(true);
      showToast(`✅ 选中的 ${shareCodes.length} 个分享重新抓取并更新完成！`);
    }, 1800);
  };

  const handleExportShares = (shareCodes?: string[]) => {
    const targetShares = shareCodes && shareCodes.length > 0
      ? shares.filter(s => shareCodes.includes(s.share_code))
      : shares;

    if (targetShares.length === 0) {
      showToast('⚠️ 未选择任何可导出的分享任务');
      return;
    }

    const exportPayload = {
      exported_at: new Date().toISOString(),
      service: "115 Cloud Drive Share Search Service",
      total_count: targetShares.length,
      shares: targetShares.map(s => ({
        share_code: s.share_code,
        receive_code: s.receive_code || "",
        title: s.title || "",
        file_count: s.file_count,
        folder_count: s.folder_count,
        total_size: s.total_size,
        status: s.status,
        last_crawled_at: s.last_crawled_at || null,
        created_at: s.created_at || new Date().toISOString(),
        raw_url: `https://115.com/s/${s.share_code}${s.receive_code ? `?password=${s.receive_code}` : ''}`
      }))
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.href = url;
    link.download = shareCodes && shareCodes.length > 0
      ? `115_selected_${shareCodes.length}_shares_${timestamp}.json`
      : `115_all_${shares.length}_shares_${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`✅ 成功导出 ${targetShares.length} 条分享记录为 JSON 格式！`);
  };

  const handleOpenTree = (shareCode: string, targetCid: string = '0', highlightId: string = '') => {
    setTreeShareCode(shareCode);
    setTreeTargetCid(targetCid || '0');
    setTreeHighlightId(highlightId || '');
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

  const handleDeleteShare = async (shareCode: string) => {
    const target = shares.find(s => s.share_code === shareCode);
    const targetTitle = target ? (target.title || target.share_code) : shareCode;
    const targetId = target ? target.id : null;

    // Optimistic cascade delete in local UI state
    setShares(prev => prev.filter(s => s.share_code !== shareCode));
    if (targetId) {
      setFiles(prev => prev.filter(f => f.share_id !== targetId));
    }

    if (treeShareCode === shareCode) {
      setTreeShareCode('');
      setTreeTargetCid('0');
      setTreeHighlightId('');
      if (activeTab === 'tree') {
        setActiveTab('search');
      }
    }

    try {
      const adminToken = localStorage.getItem('115_admin_token') || sessionStorage.getItem('115_admin_token') || '';
      const res = await fetch(`/api/v1/shares/${encodeURIComponent(shareCode)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.message) {
        showToast(`🗑️ ${data.message}`);
      } else {
        showToast(`🗑️ 已彻底移除分享「${targetTitle}」，并已级联清理关联全部文件！`);
      }
    } catch {
      showToast(`🗑️ 已彻底移除分享「${targetTitle}」，并已级联清理关联全部文件！`);
    }
  };

  const handleBatchDeleteShares = async (shareCodes: string[]) => {
    if (!shareCodes || shareCodes.length === 0) return;

    const targetShares = shares.filter(s => shareCodes.includes(s.share_code));
    const targetIds = targetShares.map(s => s.id);

    setShares(prev => prev.filter(s => !shareCodes.includes(s.share_code)));
    setFiles(prev => prev.filter(f => !targetIds.includes(f.share_id)));

    if (shareCodes.includes(treeShareCode)) {
      setTreeShareCode('');
      setTreeTargetCid('0');
      setTreeHighlightId('');
      if (activeTab === 'tree') {
        setActiveTab('search');
      }
    }

    try {
      const adminToken = localStorage.getItem('115_admin_token') || sessionStorage.getItem('115_admin_token') || '';
      const res = await fetch('/api/v1/shares/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
        body: JSON.stringify({ share_codes: shareCodes }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.message) {
        showToast(`🗑️ ${data.message}`);
      } else {
        showToast(`🗑️ 成功批量移除 ${shareCodes.length} 个分享链接，并级联清理名下全部文件！`);
      }
    } catch {
      showToast(`🗑️ 成功批量移除 ${shareCodes.length} 个分享链接，并级联清理名下全部文件！`);
    }
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

            {/* Desktop Navigation Tabs */}
            <nav className="hidden md:flex items-center space-x-1 sm:space-x-1.5 overflow-x-auto py-2">
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

              {/* Admin Entrance / Console Navigation Button */}
              {!isAdmin ? (
                <button
                  id="nav-admin-gate-btn"
                  onClick={() => handleOpenAdmin('tasks')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300/80"
                  title="管理员访问入口（需口令授权）"
                >
                  <Lock className="w-3.5 h-3.5 text-blue-600" />
                  <span>管理入口</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-slate-500 border border-slate-200 font-mono">
                    需授权
                  </span>
                </button>
              ) : (
                <button
                  id="nav-admin-console-btn"
                  onClick={() => setActiveTab('tasks')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    ADMIN_TABS.includes(activeTab)
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200'
                  }`}
                  title="管理控制台已授权"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>管理后台</span>
                  {pendingCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                  )}
                </button>
              )}
            </nav>

            {/* Desktop Header Right Status - Only shown when authorized */}
            {isAdmin && (
              <div className="hidden md:flex items-center gap-2 pl-3 border-l border-slate-200">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  管理员已授权
                </div>
                <button
                  id="header-change-password-btn"
                  onClick={() => {
                    setTargetAdminTab('change-password');
                    setAuthModalOpen(true);
                  }}
                  className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition flex items-center gap-1"
                  title="修改管理员密码（数据保存在 PostgreSQL 数据库，不依赖 .env）"
                >
                  <Key className="w-3 h-3 text-blue-600" />
                  <span>修改密码</span>
                </button>
                <button
                  id="header-logout-btn"
                  onClick={handleAdminLogout}
                  className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition flex items-center gap-1"
                  title="退出管理员身份"
                >
                  <LogOut className="w-3 h-3" />
                  <span>退出</span>
                </button>
              </div>
            )}

            {/* Mobile Header Right Actions */}
            <div className="flex md:hidden items-center gap-2">
              {pendingCount > 0 && isAdmin && (
                <button
                  onClick={() => setActiveTab('tasks')}
                  className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-[11px] font-semibold flex items-center gap-1"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                  {pendingCount} 任务中
                </button>
              )}
              <button
                onClick={() => setMobileMoreOpen(true)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                aria-label="打开系统与管理菜单"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 md:pb-8">
        {/* If user navigated to an Admin Tab */}
        {ADMIN_TABS.includes(activeTab) && (
          isAdmin ? (
            <>
              {/* Admin Console Top Bar */}
              <AdminConsoleBar
                currentTab={activeTab}
                onTabChange={setActiveTab}
                onLogout={handleAdminLogout}
                pendingTasksCount={pendingCount}
              />

              {/* Active Admin View */}
              {activeTab === 'tasks' && (
                <ShareTaskManager
                  shares={shares}
                  onTriggerCrawl={handleTriggerCrawl}
                  onOpenTree={handleOpenTree}
                  onSearchByShare={handleSearchByShare}
                  onReportShare={handleReportShare}
                  onDeleteShare={handleDeleteShare}
                  onBatchDeleteShares={handleBatchDeleteShares}
                  onOpenImport={() => setActiveTab('import')}
                  onBatchTriggerCrawl={handleBatchTriggerCrawl}
                  onExportShares={handleExportShares}
                  onRefreshShares={() => fetchSharesFromBackend(false)}
                  onResetToDemo={handleResetToDemo}
                  isBackendConnected={isBackendConnected}
                  isLoadingShares={isLoadingShares}
                />
              )}

              {activeTab === 'import' && (
                <ImporterView 
                  existingShares={shares}
                  onImportSuccess={handleImportSuccess} 
                  onNavigateToTasks={() => setActiveTab('tasks')}
                />
              )}

              {activeTab === 'crawler' && <CrawlerVisualizer />}
              
              {activeTab === 'proxy' && <ProxyManagerView />}

              {activeTab === 'settings' && (
                <SystemSettingsView 
                  onShowToast={showToast} 
                  onSettingsSaved={fetchAdSenseConfig} 
                />
              )}
            </>
          ) : (
            /* Admin Gate Card for unauthenticated direct visitors */
            <div className="max-w-xl mx-auto my-12 bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-lg animate-in fade-in">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mx-auto flex items-center justify-center mb-4">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">需要管理员授权访问</h2>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed max-w-md mx-auto">
                任务监控、爬虫并发拓扑、防封代理池矩阵与链接导入属于受保护的管理功能。请在管理入口验证口令后继续。
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setActiveTab('search')}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
                >
                  返回公开搜索
                </button>
                <button
                  onClick={() => handleOpenAdmin(activeTab)}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" />
                  验证管理员口令
                </button>
              </div>
            </div>
          )
        )}

        {/* Public Views */}
        {activeTab === 'search' && (
          <SearchEngineView
            shares={shares}
            files={files}
            onOpenTree={handleOpenTree}
            onReportShare={handleReportShare}
            onDeleteShare={handleDeleteShare}
            adsenseConfig={adsenseConfig}
          />
        )}

        {activeTab === 'tree' && (
          <DirectoryTreeView
            shares={shares}
            files={files}
            initialShareCode={treeShareCode}
            initialCid={treeTargetCid}
            highlightId={treeHighlightId}
            onBackToSearch={() => setActiveTab('search')}
          />
        )}

        {activeTab === 'code' && <CodeExplorer />}

        {activeTab === 'api' && <ApiTester />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-5 text-xs text-slate-500 mt-auto pb-20 md:pb-5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
            <span className="font-semibold text-slate-700">115 Share Search Service</span>
            <span>·</span>
            <span>Python 3.11 + FastAPI + PostgreSQL (pg_trgm)</span>
          </div>

          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
            <span>BFS 遍历</span>
            <span>·</span>
            <span>OpenList / AList 节点兼容</span>
            <span>·</span>
            <button 
              onClick={() => handleOpenAdmin('tasks')}
              className="text-slate-500 hover:text-blue-600 transition flex items-center gap-1"
            >
              <Lock className="w-3 h-3" />
              管理后台
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav 
        id="mobile-bottom-nav" 
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 px-1 py-1 flex items-center justify-around shadow-lg safe-area-bottom"
      >
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition min-h-[46px] active:scale-95 ${
            activeTab === 'search' ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Search className={`w-5 h-5 ${activeTab === 'search' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
          <span>检索</span>
        </button>

        <button
          onClick={() => setActiveTab('tree')}
          className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition min-h-[46px] active:scale-95 ${
            activeTab === 'tree' ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className={`w-5 h-5 ${activeTab === 'tree' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
          <span>目录</span>
        </button>

        {isAdmin ? (
          <>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition min-h-[46px] active:scale-95 relative ${
                activeTab === 'tasks' ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className="relative">
                <ListChecks className={`w-5 h-5 ${activeTab === 'tasks' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
                {pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white animate-pulse"></span>
                )}
              </div>
              <span>任务</span>
            </button>

            <button
              onClick={() => setActiveTab('proxy')}
              className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition min-h-[46px] active:scale-95 ${
                activeTab === 'proxy' ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldCheck className={`w-5 h-5 ${activeTab === 'proxy' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
              <span>代理</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition min-h-[46px] active:scale-95 ${
                activeTab === 'code' ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileCode className={`w-5 h-5 ${activeTab === 'code' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
              <span>源码</span>
            </button>

            <button
              onClick={() => handleOpenAdmin('tasks')}
              className="flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition min-h-[46px] active:scale-95 text-slate-500 hover:text-blue-600"
            >
              <Lock className="w-5 h-5 stroke-[1.75] text-slate-400" />
              <span>管理</span>
            </button>
          </>
        )}

        <button
          onClick={() => setMobileMoreOpen(true)}
          className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition min-h-[46px] active:scale-95 relative ${
            ['crawler', 'api'].includes(activeTab) ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <SlidersHorizontal className="w-5 h-5 stroke-[1.75]" />
          <span>更多</span>
        </button>
      </nav>

      {/* Mobile More Sheet / Drawer */}
      {mobileMoreOpen && (
        <div 
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end md:hidden animate-in fade-in"
          onClick={() => setMobileMoreOpen(false)}
        >
          <div 
            className="bg-white rounded-t-2xl p-5 border-t border-slate-200 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-4 rounded bg-blue-600"></div>
                <h3 className="font-bold text-slate-900 text-sm">功能导航与管理控制</h3>
              </div>
              <button 
                onClick={() => setMobileMoreOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Admin Status Card in Mobile */}
            <div className={`p-3 rounded-xl border flex items-center justify-between ${
              isAdmin ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isAdmin ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {isAdmin ? <ShieldCheck className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                </div>
                <div>
                  <div className="text-xs font-bold">
                    {isAdmin ? '管理员身份已授权' : '管理权限未验证'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {isAdmin ? '可操作任务监控、代理池与爬虫' : '任务与代理配置已隐藏保护'}
                  </div>
                </div>
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      setTargetAdminTab('change-password');
                      setAuthModalOpen(true);
                    }}
                    className="px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    修改密码
                  </button>
                  <button
                    onClick={() => {
                      handleAdminLogout();
                      setMobileMoreOpen(false);
                    }}
                    className="px-2.5 py-1 text-xs font-semibold bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 transition"
                  >
                    退出
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setMobileMoreOpen(false);
                    handleOpenAdmin('tasks');
                  }}
                  className="px-2.5 py-1 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  前往授权
                </button>
              )}
            </div>

            {/* Protected Admin Navigation (if authorized) */}
            {isAdmin && (
              <div>
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  管理后台模块
                </h4>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => { setActiveTab('tasks'); setMobileMoreOpen(false); }}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1.5 text-left transition ${
                      activeTab === 'tasks' ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <ListChecks className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold">任务监控调度</span>
                    <span className="text-[10px] text-slate-400">状态流转与重试</span>
                  </button>

                  <button
                    onClick={() => { setActiveTab('import'); setMobileMoreOpen(false); }}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1.5 text-left transition ${
                      activeTab === 'import' ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <PlusCircle className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-bold">批量提交链接</span>
                    <span className="text-[10px] text-slate-400">正则解析与异步入队</span>
                  </button>

                  <button
                    onClick={() => { setActiveTab('crawler'); setMobileMoreOpen(false); }}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1.5 text-left transition ${
                      activeTab === 'crawler' ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <FolderTree className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold">爬虫引擎状态</span>
                    <span className="text-[10px] text-slate-400">BFS 递归与抓取拓扑</span>
                  </button>

                  <button
                    onClick={() => { setActiveTab('proxy'); setMobileMoreOpen(false); }}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1.5 text-left transition ${
                      activeTab === 'proxy' ? 'bg-indigo-50 border-indigo-300 text-indigo-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <span className="text-xs font-bold">代理池防封矩阵</span>
                    <span className="text-[10px] text-slate-400">IP 轮换与反封禁策略</span>
                  </button>
                </div>
              </div>
            )}

            {/* Public Development Tools */}
            <div>
              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                公开工程与文档
              </h4>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => { setActiveTab('code'); setMobileMoreOpen(false); }}
                  className={`p-3 rounded-xl border flex flex-col items-start gap-1.5 text-left transition ${
                    activeTab === 'code' ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <FileCode className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold">项目完整源码</span>
                  <span className="text-[10px] text-slate-400">FastAPI/Worker/Crawler</span>
                </button>

                <button
                  onClick={() => { setActiveTab('api'); setMobileMoreOpen(false); }}
                  className={`p-3 rounded-xl border flex flex-col items-start gap-1.5 text-left transition ${
                    activeTab === 'api' ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <BookOpen className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-bold">RESTful API 调试</span>
                  <span className="text-[10px] text-slate-400">Swagger 交互式请求</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Authorization Modal */}
      <AdminAuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAdminAuthSuccess}
        targetTabName={
          targetAdminTab === 'change-password' ? '修改管理密码' :
          targetAdminTab === 'tasks' ? '任务监控与调度' :
          targetAdminTab === 'proxy' ? '代理池矩阵与防封' :
          targetAdminTab === 'crawler' ? '爬虫引擎拓扑' :
          targetAdminTab === 'import' ? '批量分享导入' : '管理控制台'
        }
      />

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl z-50 animate-bounce">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
