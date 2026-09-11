import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Database, 
  RotateCcw, 
  Save, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Shield, 
  Key, 
  Sliders, 
  Cpu, 
  Network,
  DollarSign,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { SystemSettingCategory, SystemSettingItem } from '../types';

interface SystemSettingsViewProps {
  onShowToast: (msg: string) => void;
  onSettingsSaved?: () => void;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({ onShowToast, onSettingsSaved }) => {
  const [categories, setCategories] = useState<SystemSettingCategory[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<string, any>>({});
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/settings');
      if (!res.ok) throw new Error('从数据库加载配置失败');
      const data = await res.json();
      setCategories(data.categories || []);
      const map: Record<string, any> = {};
      (data.categories || []).forEach((cat: SystemSettingCategory) => {
        cat.items.forEach((item: SystemSettingItem) => {
          map[item.key] = item.current;
        });
      });
      setSettingsMap(map);
    } catch (err: any) {
      console.warn('Fallback to local default settings state:', err.message);
      // Fallback display
      setCategories([
        {
          id: 'crawler',
          name: '115 爬虫与引擎频控',
          items: [
            { key: 'CRAWLER_COOKIE', title: '115 账号凭据 (VIP Cookie)', description: '用于快照与递归抓取的 115 账号 Cookie', type: 'string', category: 'crawler', default: '', current: '', is_modified: false, sensitive: true },
            { key: 'CRAWLER_CONCURRENCY', title: '爬虫最大并发协程数', description: '限制爬虫并发请求 115 API 的最大 Worker 数量', type: 'int', category: 'crawler', default: 16, current: 16, is_modified: false, sensitive: false },
            { key: 'CRAWLER_RATE_MIN', title: '单节点极小请求间隔 (秒)', description: '避免请求过于频繁触发 405 封禁', type: 'float', category: 'crawler', default: 0.15, current: 0.15, is_modified: false, sensitive: false },
            { key: 'CRAWLER_RATE_MAX', title: '单节点极大请求间隔 (秒)', description: '随机延迟浮动区间上界', type: 'float', category: 'crawler', default: 0.35, current: 0.35, is_modified: false, sensitive: false },
            { key: 'CRAWLER_PAGE_SIZE', title: '单页拉取最大节点数量', description: 'snap API 每次拉取的目录/文件数量', type: 'int', category: 'crawler', default: 100, current: 100, is_modified: false, sensitive: false }
          ]
        },
        {
          id: 'adsense',
          name: 'Google AdSense 商业化广告',
          items: [
            { key: 'ADSENSE_ENABLED', title: '启用 Google AdSense', description: '总开关。开启后将在公共页面自动注入 AdSense 脚本并展示商业化广告位', type: 'bool', category: 'adsense', default: false, current: false, is_modified: false, sensitive: false },
            { key: 'ADSENSE_CLIENT_ID', title: 'AdSense 客户 ID (Publisher ID)', description: 'Google AdSense 发布商唯一标识，格式如 ca-pub-1234567890123456', type: 'string', category: 'adsense', default: '', current: '', is_modified: false, sensitive: false },
            { key: 'ADSENSE_SLOT_ID', title: '搜索与详情页广告单元 ID (Slot ID)', description: '可选。指定固定广告单元展示代码 (如 8912345678)，留空则仅使用 Auto Ads 自动广告', type: 'string', category: 'adsense', default: '', current: '', is_modified: false, sensitive: false },
            { key: 'ADSENSE_AUTO_ADS', title: '启用全自动广告 (Auto Ads)', description: '开启后 Google AI 算法将自动识别最佳版位并在页面合适位置呈现响应式广告', type: 'bool', category: 'adsense', default: true, current: true, is_modified: false, sensitive: false },
            { key: 'ADSENSE_TEST_MODE', title: '测试广告模式 (Test Mode)', description: '开发或刚接入审核阶段建议开启 (data-adtest="on")，避免站长误点产生无效流量处罚', type: 'bool', category: 'adsense', default: false, current: false, is_modified: false, sensitive: false }
          ]
        },
        {
          id: 'worker',
          name: '后台任务调度与看门狗',
          items: [
            { key: 'WORKER_CONCURRENCY', title: '后台任务消费者并发数', description: '同时处理分享抓取的消费者进程/协程上限', type: 'int', category: 'worker', default: 4, current: 4, is_modified: false, sensitive: false },
            { key: 'STUCK_TASK_CHECK_INTERVAL', title: '死锁看门狗巡检周期 (秒)', description: '后台自动探测卡死或假死任务的检测间隔', type: 'int', category: 'worker', default: 60, current: 60, is_modified: false, sensitive: false },
            { key: 'STUCK_TASK_TIMEOUT_SECONDS', title: '任务僵死判定超时 (秒)', description: '超过此时间无进度的抓取任务将被自动释放并恢复', type: 'int', category: 'worker', default: 300, current: 300, is_modified: false, sensitive: false }
          ]
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsMap })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '保存配置失败');
      onShowToast(data.message || '系统配置已保存至 PostgreSQL 数据库并即刻热生效！');
      await fetchSettings();
      onSettingsSaved?.();
    } catch (err: any) {
      onShowToast('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (keys?: string[]) => {
    if (!window.confirm(keys ? '确定要将所选配置恢复出厂默认值吗？' : '确定要将所有系统配置项恢复为出厂预设值吗？')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/v1/admin/settings/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keys || null })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '重置失败');
      onShowToast(data.message || '已成功恢复出厂默认值！');
      await fetchSettings();
      onSettingsSaved?.();
    } catch (err: any) {
      onShowToast('重置配置失败: ' + err.message);
    } finally {
      setResetting(false);
    }
  };

  const getCategoryIcon = (id: string) => {
    switch (id) {
      case 'crawler': return <Cpu className="w-4 h-4 text-blue-600" />;
      case 'worker': return <Sliders className="w-4 h-4 text-amber-600" />;
      case 'proxy': return <Network className="w-4 h-4 text-indigo-600" />;
      case 'adsense': return <DollarSign className="w-4 h-4 text-emerald-600" />;
      default: return <Settings className="w-4 h-4 text-slate-600" />;
    }
  };

  const handleFillAdSenseDemo = () => {
    setSettingsMap(prev => ({
      ...prev,
      ADSENSE_ENABLED: true,
      ADSENSE_CLIENT_ID: 'ca-pub-1234567890123456',
      ADSENSE_SLOT_ID: '8912345678',
      ADSENSE_AUTO_ADS: true,
      ADSENSE_TEST_MODE: true,
    }));
    onShowToast('已自动填入 Google AdSense 演示测试参数，点击「保存并热生效」即可应用！');
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 border border-slate-700/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center gap-1">
              <Database className="w-3.5 h-3.5" />
              PostgreSQL 全配置项持久化
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              免 .env 零配置热更新
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight">系统与爬虫参数集中管理中心</h2>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            所有配置参数已全部迁移至 PostgreSQL 数据库 <code className="bg-slate-800 px-1 py-0.5 rounded text-blue-300 font-mono">system_settings</code> 表中存储。
            在此修改后即刻内存热生效，重启容器配置不丢失，彻底杜绝服务器手动编辑 <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300 font-mono">.env</code> 产生的加载失败风险！
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={fetchSettings}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition border border-slate-700 flex items-center gap-1.5"
            title="从数据库拉取最新数据"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            重新载入
          </button>
          <button
            onClick={() => handleReset()}
            disabled={resetting}
            className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded-xl text-xs font-semibold transition border border-rose-800/40 flex items-center gap-1.5"
            title="将全部参数恢复出厂默认值"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            恢复默认
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? '正在写入数据库...' : '保存并热生效'}
          </button>
        </div>
      </div>

      {/* Categories Nav */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3 overflow-x-auto text-xs font-medium">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-3.5 py-2 rounded-xl transition whitespace-nowrap ${
            activeCategory === 'all' ? 'bg-slate-900 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          全部配置项
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3.5 py-2 rounded-xl transition whitespace-nowrap flex items-center gap-1.5 ${
              activeCategory === cat.id ? 'bg-slate-900 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {getCategoryIcon(cat.id)}
            <span>{cat.name}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/60 text-slate-600 font-mono">
              {cat.items.length}
            </span>
          </button>
        ))}
      </div>

      {/* Category Groups */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
          正在从 PostgreSQL 读取系统全量配置...
        </div>
      ) : (
        <div className="space-y-6">
          {categories
            .filter(c => activeCategory === 'all' || activeCategory === c.id)
            .map(cat => (
              <div key={cat.id} className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    {getCategoryIcon(cat.id)}
                    <span>{cat.name}</span>
                    <span className="text-[11px] font-normal text-slate-400">({cat.items.length} 项)</span>
                  </h3>
                  <button
                    onClick={() => handleReset(cat.items.map(i => i.key))}
                    className="text-[11px] text-slate-500 hover:text-rose-600 transition"
                  >
                    重置本组默认
                  </button>
                </div>

                {cat.id === 'adsense' && (
                  <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/80 text-emerald-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-bold flex items-center gap-1.5 text-emerald-800">
                        <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
                        Google AdSense 商业化广告系统接入指南
                      </p>
                      <p className="text-emerald-700/90 text-[11px] leading-relaxed">
                        1. 登录 Google AdSense 账号获取发布商 ID (如 <code className="font-mono bg-emerald-100/60 px-1 py-0.5 rounded">ca-pub-xxxxxxxxxxxxxxxx</code>) 并填入；<br />
                        2. 开启「启用 Google AdSense」总开关，系统将自动在前端全站引入官方广告 SDK 脚本；<br />
                        3. 支持开启全自动广告 (Auto Ads) 与固定广告单元位。初次接入调试建议开启「测试模式」以防误点。
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleFillAdSenseDemo}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        填入测试预设
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {cat.items.map(item => {
                    const isMod = item.default !== undefined && settingsMap[item.key] !== item.default;
                    return (
                      <div
                        key={item.key}
                        className={`p-4 rounded-xl border transition space-y-2.5 ${
                          isMod ? 'bg-amber-50/40 border-amber-200' : 'bg-slate-50/50 border-slate-200/80'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-slate-800">{item.title}</span>
                              {isMod && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold border border-amber-200">
                                  已修改
                                </span>
                              )}
                              {item.sensitive && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 font-semibold border border-purple-200 flex items-center gap-0.5">
                                  <Key className="w-2.5 h-2.5" />
                                  敏感凭证
                                </span>
                              )}
                            </div>
                            <code className="text-[11px] font-mono text-blue-700 block mt-0.5">{item.key}</code>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-500 leading-relaxed">{item.description}</p>

                        <div className="pt-1">
                          {item.type === 'bool' ? (
                            <div className="flex items-center gap-3">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!settingsMap[item.key]}
                                  onChange={e => setSettingsMap(prev => ({ ...prev, [item.key]: e.target.checked }))}
                                  className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                              </label>
                              <span className={`text-xs font-semibold ${settingsMap[item.key] ? 'text-blue-700' : 'text-slate-500'}`}>
                                {settingsMap[item.key] ? '已启用 (True)' : '已禁用 (False)'}
                              </span>
                            </div>
                          ) : item.type === 'int' || item.type === 'float' ? (
                            <input
                              type="number"
                              step={item.type === 'float' ? '0.01' : '1'}
                              value={settingsMap[item.key] !== undefined ? settingsMap[item.key] : ''}
                              onChange={e => {
                                const val = item.type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
                                setSettingsMap(prev => ({ ...prev, [item.key]: isNaN(val) ? 0 : val }));
                              }}
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <div>
                              {item.key.includes('COOKIE') || item.key.includes('USER_AGENT') ? (
                                <textarea
                                  rows={2}
                                  value={settingsMap[item.key] || ''}
                                  onChange={e => setSettingsMap(prev => ({ ...prev, [item.key]: e.target.value }))}
                                  placeholder={item.default ? String(item.default) : '无默认值'}
                                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <input
                                  type={item.sensitive ? 'password' : 'text'}
                                  value={settingsMap[item.key] || ''}
                                  onChange={e => setSettingsMap(prev => ({ ...prev, [item.key]: e.target.value }))}
                                  placeholder={item.default ? String(item.default) : '无默认值'}
                                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-200/60 font-mono">
                          <span>出厂预设: {item.default === '' ? '（空）' : String(item.default)}</span>
                          <button
                            onClick={() => setSettingsMap(prev => ({ ...prev, [item.key]: item.default }))}
                            className="text-blue-600 hover:underline font-sans"
                            title="填入系统默认预设值"
                          >
                            填入预设
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

          {/* Bottom Save Action Bar */}
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              💡 配置保存后将自动同步并持久化存储在 PostgreSQL <strong className="text-slate-800">system_settings</strong> 表中，无需重启服务。
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchSettings}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
              >
                取消修改
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? '正在写入数据库...' : '保存全部修改至数据库 💾'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
