import React, { useState } from 'react';
import { 
  Terminal, 
  Send, 
  Copy, 
  Check, 
  Code, 
  BookOpen,
  CheckCircle2,
  Server
} from 'lucide-react';

interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  description: string;
  sampleRequest: string;
  sampleResponse: string;
}

const ENDPOINTS: ApiEndpoint[] = [
  {
    method: 'POST',
    path: '/api/v1/shares/batch-import',
    summary: '批量提交 115 分享链接并推入 Redis 抓取队列',
    description: '接受原始链接 (https://115.com/s/xxx?password=yyy) 或标准 share_code / receive_code，自动正则提取并入队。',
    sampleRequest: `{
  "shares": [
    {
      "raw_url": "https://115.com/s/sw38914kremux?password=4k88"
    },
    {
      "share_code": "sw398cslearning",
      "receive_code": "cs24"
    }
  ]
}`,
    sampleResponse: `{
  "total_submitted": 2,
  "tasks_queued": 2,
  "ignored_duplicates": 0,
  "task_ids": [
    "b89f1a23-4c5e-4a67-8901-abcdef123456",
    "c9012345-6789-0abc-def1-234567890abc"
  ],
  "message": "已成功接收 2 条分享链接，新增进入抓取队列 2 条。"
}`
  },
  {
    method: 'GET',
    path: '/api/v1/search?keyword=Interstellar&extension=mkv&page=1&page_size=20',
    summary: 'PostgreSQL pg_trgm 全文模糊与多维筛选检索',
    description: '通过 GIN 三元倒排索引极速检索 full_path，支持扩展名、大小范围、目录筛选与分页。',
    sampleRequest: `GET /api/v1/search?keyword=Interstellar&extension=mkv&page=1&page_size=20 HTTP/1.1
Host: localhost:8000
Accept: application/json`,
    sampleResponse: `{
  "keyword": "Interstellar",
  "total": 1,
  "page": 1,
  "page_size": 20,
  "total_pages": 1,
  "items": [
    {
      "id": 102,
      "file_115_id": "fid_2001",
      "parent_115_id": "cid_1001",
      "name": "星际穿越.Interstellar.2014.IMAX.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1.mkv",
      "extension": "mkv",
      "size": 41875928120,
      "formatted_size": "39.00 GB",
      "is_dir": false,
      "sha1": "3a88fc2109db89a910248491c98fe37b1938ab01",
      "full_path": "/科幻电影/星际穿越.Interstellar.2014.IMAX.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1.mkv",
      "share_id": 1,
      "share_code": "sw38914kremux",
      "receive_code": "4k88",
      "share_title": "4K UHD HDR 原盘电影与高码率蓝光合集 (2024)",
      "share_status": 1,
      "share_url": "https://115.com/s/sw38914kremux?password=4k88",
      "openlist_mount_cid": "fid_2001"
    }
  ]
}`
  },
  {
    method: 'GET',
    path: '/api/v1/shares/sw38914kremux/files?parent_115_id=0',
    summary: '层级浏览指定 115 分享目录树',
    description: '根据 parent_115_id（根目录为 0）查询直属子目录与文件节点，用于文件树折叠展开与 WebDAV 挂载。',
    sampleRequest: `GET /api/v1/shares/sw38914kremux/files?parent_115_id=0 HTTP/1.1
Host: localhost:8000`,
    sampleResponse: `{
  "share_code": "sw38914kremux",
  "parent_115_id": "0",
  "total": 2,
  "items": [
    {
      "id": 101,
      "file_115_id": "cid_1001",
      "parent_115_id": "0",
      "name": "科幻电影",
      "extension": "",
      "size": 0,
      "formatted_size": "0 B",
      "is_dir": true,
      "sha1": "",
      "full_path": "/科幻电影"
    },
    {
      "id": 105,
      "file_115_id": "cid_1002",
      "parent_115_id": "0",
      "name": "4K纪录片与自然探索",
      "extension": "",
      "size": 0,
      "formatted_size": "0 B",
      "is_dir": true,
      "sha1": "",
      "full_path": "/4K纪录片与自然探索"
    }
  ]
}`
  },
  {
    method: 'POST',
    path: '/api/v1/shares/sw38914kremux/report',
    summary: '上报失效或被封禁的 115 分享',
    description: '标记指定分享为 EXPIRED (2) 或 BANNED (3)，在后续搜索中自动隐藏，保持索引库健康。',
    sampleRequest: `{
  "reason": "expired"
}`,
    sampleResponse: `{
  "share_code": "sw38914kremux",
  "status": 2,
  "message": "已成功标记该分享为失效状态，后续检索将自动过滤。"
}`
  }
];

export const ApiTester: React.FC = () => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const current = ENDPOINTS[selectedIdx];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600" />
            FastAPI 交互式 RESTful 接口规范 (OpenAPI 3.1)
          </h2>
          <p className="text-xs text-slate-500">
            本地部署后可直接访问 <code>http://localhost:8000/docs</code> 打开 Swagger UI 调试
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Endpoint List */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-2 space-y-1.5">
          {ENDPOINTS.map((ep, idx) => {
            const isSelected = selectedIdx === idx;
            return (
              <button
                key={idx}
                onClick={() => setSelectedIdx(idx)}
                className={`w-full text-left p-3 rounded-lg text-xs transition border ${
                  isSelected
                    ? 'bg-blue-50 border-blue-200 shadow-xs'
                    : 'bg-white border-transparent hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      ep.method === 'GET'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {ep.method}
                  </span>
                  <span className="font-mono text-slate-800 font-semibold truncate">
                    {ep.path.split('?')[0]}
                  </span>
                </div>
                <div className="text-slate-500 text-[11px] truncate">
                  {ep.summary}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Request/Response Sandbox */}
        <div className="lg:col-span-8 bg-slate-900 rounded-xl border border-slate-800 p-4 text-slate-100 space-y-4 shadow-lg">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold ${
                  current.method === 'GET'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 text-white'
                }`}
              >
                {current.method}
              </span>
              <span className="font-mono text-xs text-slate-200">
                {current.path}
              </span>
            </div>
            <button
              onClick={() => handleCopy(current.sampleResponse)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs flex items-center gap-1 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '已复制响应' : '复制 JSON'}
            </button>
          </div>

          <p className="text-xs text-slate-300 font-sans">
            {current.description}
          </p>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                请求 Payload / URL 参数
              </span>
              <pre className="mt-1 p-3 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto text-emerald-400">
                <code>{current.sampleRequest}</code>
              </pre>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                标准响应 Response JSON (HTTP 200 / 202)
              </span>
              <pre className="mt-1 p-3 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto text-cyan-300 max-h-64">
                <code>{current.sampleResponse}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
