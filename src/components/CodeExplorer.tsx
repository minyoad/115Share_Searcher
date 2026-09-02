import React, { useState } from 'react';
import JSZip from 'jszip';
import { 
  FileCode, 
  Copy, 
  Check, 
  Download, 
  Folder, 
  Terminal, 
  Cpu, 
  Database,
  FileText,
  Server
} from 'lucide-react';
import { PROJECT_FILES } from '../data/projectFiles';
import { ProjectFile } from '../types';

export const CodeExplorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<ProjectFile>(PROJECT_FILES[0]);
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();
      
      // Add all project files into zip
      PROJECT_FILES.forEach(file => {
        zip.file(file.path, file.content);
      });

      // Add Docker environment template & init files
      zip.file('.env.example', `POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres123
POSTGRES_DB=db_115share
POSTGRES_PORT=5432
REDIS_PASSWORD=redis123
REDIS_PORT=6379
API_PORT=8000
CRAWLER_COOKIE=
`);
      zip.file('app/__init__.py', '"""115 Cloud Drive Share Search Service"""\n__version__ = "1.0.0"\n');

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '115-share-search-service.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to generate zip:', error);
    } finally {
      setIsZipping(false);
    }
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith('.py')) return <FileCode className="w-4 h-4 text-emerald-500" />;
    if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) return <Server className="w-4 h-4 text-amber-500" />;
    if (fileName.endsWith('.html')) return <FileText className="w-4 h-4 text-orange-500" />;
    if (fileName === 'Dockerfile') return <Cpu className="w-4 h-4 text-cyan-500" />;
    if (fileName.includes('requirements') || fileName.includes('config')) return <Database className="w-4 h-4 text-purple-500" />;
    return <FileCode className="w-4 h-4 text-blue-500" />;
  };

  return (
    <div id="code-explorer-container" className="space-y-4">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-4 rounded-xl border border-slate-200 gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Folder className="w-5 h-5 text-blue-600" />
            完整项目工程源码 (Python 3.11 + FastAPI + PostgreSQL + Redis)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            符合企业级规范的模块化分层代码结构，包含数据库连接池、异步爬虫引擎、GIN 倒排索引与容器编排
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="download-zip-btn"
            onClick={handleDownloadZip}
            disabled={isZipping}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 shadow-sm transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isZipping ? '打包中...' : '一键打包下载 (.zip)'}
          </button>
        </div>
      </div>

      {/* Main File Explorer Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Sidebar: File Tree */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">项目文件清单</span>
            <span className="text-xs text-slate-400">{PROJECT_FILES.length} 个文件</span>
          </div>
          
          <div className="p-2 space-y-1 overflow-y-auto max-h-[640px]">
            {PROJECT_FILES.map((file) => {
              const isSelected = selectedFile.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs transition font-mono ${
                    isSelected
                      ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    {getFileIcon(file.name)}
                    <span className="truncate">{file.path}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-sans shrink-0 ml-2">
                    {file.language}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 mb-1">
              <Terminal className="w-3.5 h-3.5 text-blue-600" />
              本地启动命令：
            </div>
            <code className="block p-2 bg-slate-900 text-emerald-400 rounded text-[11px] font-mono select-all">
              docker-compose up -d --build
            </code>
          </div>
        </div>

        {/* Right Code Viewer */}
        <div className="lg:col-span-8 bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden shadow-lg">
          {/* Code Viewer Header */}
          <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-slate-300">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-medium text-slate-200 px-2 py-0.5 rounded bg-slate-800">
                {selectedFile.path}
              </span>
              <span className="text-xs text-slate-400 hidden sm:inline">
                — {selectedFile.description}
              </span>
            </div>
            <button
              id="copy-code-btn"
              onClick={handleCopy}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition border border-slate-700"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '已复制代码' : '复制代码'}
            </button>
          </div>

          {/* Code Body */}
          <div className="p-4 overflow-x-auto overflow-y-auto max-h-[640px] text-xs font-mono leading-relaxed text-slate-100 selection:bg-blue-500 selection:text-white">
            <pre className="whitespace-pre">
              <code>{selectedFile.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
