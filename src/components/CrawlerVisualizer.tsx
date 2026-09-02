import React, { useState } from 'react';
import { 
  Play, 
  RotateCcw, 
  CheckCircle, 
  FolderTree, 
  ArrowRight, 
  Database, 
  Server, 
  Clock, 
  ShieldCheck, 
  Cpu
} from 'lucide-react';

export const CrawlerVisualizer: React.FC = () => {
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const steps = [
    {
      title: '1. 任务调度与队列出栈',
      desc: 'Worker 从 Redis 队列 (115_share_crawl_queue) 通过 BRPOP 非阻塞拉取抓取任务 payload: { share_code: "sw38914k", receive_code: "4k88" }。',
      queue: ['cid: 0 (根目录 /)'],
      activeCid: '0',
      status: 'Queue Popped',
    },
    {
      title: '2. 115 Snapshot API 请求与抖动限速',
      desc: '调用 https://webapi.115.com/share/snap?share_code=sw38914k&cid=0，执行 0.3s~0.8s 随机延迟抖动以规避 115 频率风控。',
      queue: ['cid: 0 (处理中)'],
      activeCid: '0',
      status: 'Fetching HTTP Snap API',
    },
    {
      title: '3. 解析根目录响应与抽取元数据',
      desc: '提取 share_title ("4K UHD HDR 原盘电影")，发现子目录 "科幻电影" (cid: 1001) 与 "纪录片" (cid: 1002)，计算全路径并压入 BFS deque。',
      queue: ['cid: 1001 (/科幻电影)', 'cid: 1002 (/4K纪录片)'],
      activeCid: '1001',
      status: 'BFS Queue Push',
    },
    {
      title: '4. 下钻子目录遍历与文件属性提取',
      desc: '出队 cid: 1001，请求 snap API 获取列表：提取到 Interstellar (fid: 2001, 39GB, sha1) 与 Dune (fid: 2002, 30GB)。',
      queue: ['cid: 1002 (/4K纪录片)'],
      activeCid: '1001 -> Files Extracted',
      status: 'Path Resolution',
    },
    {
      title: '5. 批量 Upsert 入库与 pg_trgm 倒排索引生成',
      desc: '执行 PostgreSQL 批量 INSERT ON CONFLICT (share_id, file_115_id) DO UPDATE，自动维护 GIN 全文与模糊三元索引，更新 Share 状态为 ACTIVE。',
      queue: ['BFS Queue Empty (完成)'],
      activeCid: 'All Finished',
      status: 'Indexed & Committed',
    },
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      setStep(0);
    }
  };

  const handleAutoPlay = () => {
    setIsPlaying(true);
    setStep(0);
    let current = 0;
    const interval = setInterval(() => {
      current++;
      if (current >= steps.length) {
        clearInterval(interval);
        setIsPlaying(false);
      } else {
        setStep(current);
      }
    }, 1800);
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-3">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <FolderTree className="w-5 h-5 text-blue-600" />
          115 Snapshot API BFS 递归爬虫引擎工作原理
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          115 网盘分享接口采用快照树模型（Snapshot）。爬虫利用 <code>collections.deque</code> 实现非阻塞广度优先搜索，
          在内存中跟踪 <code>(current_cid, current_virtual_path)</code> 构造标准化绝对路径，彻底避免深层嵌套目录栈溢出。
        </p>

        {/* Architecture Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-blue-600 shrink-0" />
            <div>
              <div className="text-[11px] font-bold text-slate-800">BFS 队列</div>
              <div className="text-[10px] text-slate-500">collections.deque</div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <div className="text-[11px] font-bold text-slate-800">智能抖动限速</div>
              <div className="text-[10px] text-slate-500">0.3s - 0.8s Jitter</div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <div className="text-[11px] font-bold text-slate-800">指数退避重试</div>
              <div className="text-[10px] text-slate-500">Exponential Backoff</div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2.5">
            <Database className="w-4 h-4 text-purple-600 shrink-0" />
            <div>
              <div className="text-[11px] font-bold text-slate-800">PostgreSQL Upsert</div>
              <div className="text-[10px] text-slate-500">500 条/批次写入</div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Step-by-Step Simulation */}
      <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 text-white space-y-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <span className="text-xs uppercase font-bold text-blue-400 tracking-wider">
              BFS 动态状态机步进模拟
            </span>
            <h3 className="text-base font-bold text-slate-100 mt-0.5">
              {steps[step].title}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAutoPlay}
              disabled={isPlaying}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {isPlaying ? '运行中...' : '自动播放演示'}
            </button>
            <button
              onClick={handleNext}
              disabled={isPlaying}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border border-slate-700"
            >
              下一步 <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setStep(0)}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
              title="重置步骤"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Step Progress Indicators */}
        <div className="grid grid-cols-5 gap-2">
          {steps.map((s, idx) => (
            <button
              key={idx}
              onClick={() => setStep(idx)}
              className={`h-2 rounded-full transition-all ${
                idx === step
                  ? 'bg-blue-500 shadow-sm shadow-blue-500/50'
                  : idx < step
                  ? 'bg-emerald-500/80'
                  : 'bg-slate-800'
              }`}
              title={s.title}
            />
          ))}
        </div>

        {/* Step Content Card */}
        <div className="bg-slate-950/60 rounded-xl p-5 border border-slate-800/80 space-y-4 font-mono text-xs">
          <p className="text-slate-300 font-sans text-sm leading-relaxed">
            {steps[step].desc}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="bg-slate-900 p-3.5 rounded-lg border border-slate-800 space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400">
                当前 BFS 内存队列 (collections.deque)
              </span>
              <div className="space-y-1">
                {steps[step].queue.map((q, i) => (
                  <div key={i} className="text-amber-400 font-semibold flex items-center gap-2">
                    <span className="text-slate-500">[{i}]</span> {q}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 p-3.5 rounded-lg border border-slate-800 space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400">
                处理状态 & 节点追踪
              </span>
              <div className="text-emerald-400 font-semibold">
                Status: {steps[step].status}
              </div>
              <div className="text-slate-300">
                Target Node: <code className="text-cyan-400">{steps[step].activeCid}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
