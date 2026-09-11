import React from 'react';
import { 
  ShieldCheck, 
  ListChecks, 
  PlusCircle, 
  FolderTree, 
  Layers, 
  LogOut, 
  Search,
  SlidersHorizontal,
  Lock,
  Sparkles
} from 'lucide-react';
import { ActiveTab } from '../types';

interface AdminConsoleBarProps {
  currentTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onLogout: () => void;
  pendingTasksCount: number;
  proxyBannedCount?: number;
}

export const AdminConsoleBar: React.FC<AdminConsoleBarProps> = ({
  currentTab,
  onTabChange,
  onLogout,
  pendingTasksCount,
  proxyBannedCount = 0
}) => {
  const adminTabs: { id: ActiveTab; name: string; icon: any; badge?: number | string; badgeColor?: string }[] = [
    { 
      id: 'tasks', 
      name: '任务监控', 
      icon: ListChecks, 
      badge: pendingTasksCount > 0 ? `${pendingTasksCount} 进行中` : undefined,
      badgeColor: 'bg-amber-500 text-white'
    },
    { 
      id: 'import', 
      name: '提交链接', 
      icon: PlusCircle 
    },
    { 
      id: 'crawler', 
      name: '爬虫引擎', 
      icon: FolderTree 
    },
    { 
      id: 'proxy', 
      name: '代理池矩阵', 
      icon: ShieldCheck,
      badge: proxyBannedCount > 0 ? `${proxyBannedCount} 封禁` : undefined,
      badgeColor: 'bg-rose-500 text-white'
    },
    {
      id: 'settings',
      name: '系统配置',
      icon: SlidersHorizontal
    }
  ];

  return (
    <div 
      id="admin-console-bar"
      className="bg-slate-900 text-white rounded-2xl p-3 sm:p-4 mb-5 shadow-md border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-in fade-in"
    >
      {/* Left: Admin Status & Identity */}
      <div className="flex items-center justify-between md:justify-start gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600/30 border border-blue-400/40 text-blue-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs sm:text-sm text-white tracking-wide">
                管理控制台
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                已授权
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              任务队列调度 · 分布式爬虫并发 · 代理池防封矩阵
            </p>
          </div>
        </div>

        {/* Mobile quick logout button */}
        <button
          onClick={onLogout}
          className="md:hidden px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs flex items-center gap-1 transition"
          title="退出管理"
        >
          <LogOut className="w-3.5 h-3.5 text-rose-400" />
          <span>退出</span>
        </button>
      </div>

      {/* Middle: Admin Sub-tabs */}
      <div className="flex items-center gap-1 sm:gap-1.5 bg-slate-950/70 p-1 rounded-xl border border-slate-800 overflow-x-auto">
        {adminTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.name}</span>
              {tab.badge && (
                <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold ${tab.badgeColor}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Right: Desktop Actions */}
      <div className="hidden md:flex items-center gap-2">
        <button
          onClick={() => onTabChange('search')}
          className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition border border-slate-700"
          title="回到公开搜索"
        >
          <Search className="w-3.5 h-3.5 text-blue-400" />
          <span>返回搜索</span>
        </button>

        <button
          onClick={onLogout}
          className="px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-rose-200 border border-rose-800/40 text-xs font-medium flex items-center gap-1.5 transition"
          title="锁定管理后台并清除授权凭证"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>退出管理</span>
        </button>
      </div>
    </div>
  );
};
