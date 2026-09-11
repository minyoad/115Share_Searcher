import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

// LINT.IfChange(aistudio_media_plugin)
function aistudioMediaPlugin(): Plugin {
  return {
    name: 'vite-plugin-aistudio-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/assets/aistudio/')) {
          const rawPath = req.url.split('?')[0].split('#')[0];
          try {
            const decodedPath = decodeURIComponent(rawPath);
            const relativePath = decodedPath.replace(/^\//, '');
            const aistudioDir = path.resolve(
              __dirname,
              'public',
              'assets',
              'aistudio',
            );
            const filePath = path.resolve(__dirname, 'public', relativePath);
            if (
              filePath.startsWith(aistudioDir + path.sep) &&
              fs.existsSync(filePath) &&
              fs.statSync(filePath).isFile()
            ) {
              const ext = path.extname(filePath).toLowerCase();
              const mimeMap: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.bmp': 'image/bmp',
                '.ico': 'image/x-icon',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.ogv': 'video/ogg',
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav',
                '.ogg': 'audio/ogg',
                '.pdf': 'application/pdf',
              };
              res.setHeader(
                'Content-Type',
                mimeMap[ext] || 'application/octet-stream',
              );
              res.setHeader('Cache-Control', 'no-cache');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          } catch {
            // Fall through if URI decoding or file access fails
          }
        }
        next();
      });
    },
  };
}
// LINT.ThenChange(//depot/google3/java/com/google/alkali/boq/makersuite/applet_dev_service/templates/initializers/react_theme/vite.config.ts:aistudio_media_plugin)

function aistudioApiMockPlugin(): Plugin {
  return {
    name: 'vite-plugin-aistudio-api-mock',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/v1/')) {
          return next();
        }

        const url = req.url.split('?')[0];
        const method = req.method || 'GET';

        // Helper to read JSON body
        const readJsonBody = async (): Promise<any> => {
          return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                resolve(body ? JSON.parse(body) : {});
              } catch {
                resolve({});
              }
            });
          });
        };

        const sendJson = (statusCode: number, data: any) => {
          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(data));
        };

        const mockSettings: Record<string, any> = (globalThis as any).__mockSettings || {
          CRAWLER_COOKIE: '',
          CRAWLER_CONCURRENCY: 16,
          CRAWLER_RATE_MIN: 0.15,
          CRAWLER_RATE_MAX: 0.35,
          CRAWLER_PAGE_SIZE: 100,
          ADSENSE_ENABLED: false,
          ADSENSE_CLIENT_ID: '',
          ADSENSE_SLOT_ID: '',
          ADSENSE_AUTO_ADS: true,
          ADSENSE_TEST_MODE: false,
          WORKER_CONCURRENCY: 4,
          STUCK_TASK_CHECK_INTERVAL: 60,
          STUCK_TASK_TIMEOUT_SECONDS: 300,
          PROXY_MODE: 'OFF',
          PROXY_URL: '',
        };
        (globalThis as any).__mockSettings = mockSettings;

        const defaultMockShares = [
          {
            id: 1,
            share_code: 'sw38914kremux',
            receive_code: '4k88',
            title: '4K UHD HDR 原盘电影与高码率蓝光合集 (2024)',
            file_count: 38,
            folder_count: 6,
            total_size: 1984279930880,
            status: 1,
            created_at: '2025-01-15 14:20:00',
            last_crawled_at: '2025-01-15 14:25:32',
          },
          {
            id: 2,
            share_code: 'sw398cslearning',
            receive_code: 'cs24',
            title: '计算机核心课程架构师进阶与经典电子书精选',
            file_count: 142,
            folder_count: 12,
            total_size: 48920194880,
            status: 1,
            created_at: '2025-02-10 09:12:00',
            last_crawled_at: '2025-02-10 09:18:14',
          },
          {
            id: 3,
            share_code: 'sw377flachifi',
            receive_code: '',
            title: '母带级 Hi-Res 24bit/96kHz 无损音乐精选集',
            file_count: 85,
            folder_count: 8,
            total_size: 128994827000,
            status: 1,
            created_at: '2025-02-28 18:40:00',
            last_crawled_at: '2025-02-28 18:42:50',
          },
        ];

        const defaultMockFiles = [
          {
            id: 101,
            share_id: 1,
            file_115_id: 'cid_1001',
            parent_115_id: '0',
            name: '科幻电影',
            extension: '',
            size: 0,
            is_dir: true,
            sha1: '',
            full_path: '/科幻电影',
            share_code: 'sw38914kremux',
            receive_code: '4k88',
            share_title: '4K UHD HDR 原盘电影与高码率蓝光合集 (2024)',
          },
          {
            id: 102,
            share_id: 1,
            file_115_id: 'fid_2001',
            parent_115_id: 'cid_1001',
            name: '星际穿越.Interstellar.2014.IMAX.2160p.UHD.HDR.BluRay.x265.TrueHD.7.1.Atmos.mkv',
            extension: 'mkv',
            size: 68719476736,
            is_dir: false,
            sha1: '3A5B89F0E1D2C3B4A5968778E9D0C1B2A3F4E5D6',
            full_path: '/科幻电影/星际穿越.Interstellar.2014.IMAX.2160p.UHD.HDR.BluRay.x265.TrueHD.7.1.Atmos.mkv',
            share_code: 'sw38914kremux',
            receive_code: '4k88',
            share_title: '4K UHD HDR 原盘电影与高码率蓝光合集 (2024)',
          },
          {
            id: 103,
            share_id: 1,
            file_115_id: 'fid_2002',
            parent_115_id: 'cid_1001',
            name: '奥本海默.Oppenheimer.2023.2160p.UHD.BluRay.HEVC.DTS-HD.MA.5.1.mkv',
            extension: 'mkv',
            size: 79456894976,
            is_dir: false,
            sha1: '8C7D6E5F4A3B2C1D0E9F8A7B6C5D4E3F2A1B0C9D',
            full_path: '/科幻电影/奥本海默.Oppenheimer.2023.2160p.UHD.BluRay.HEVC.DTS-HD.MA.5.1.mkv',
            share_code: 'sw38914kremux',
            receive_code: '4k88',
            share_title: '4K UHD HDR 原盘电影与高码率蓝光合集 (2024)',
          },
          {
            id: 104,
            share_id: 1,
            file_115_id: 'fid_2003',
            parent_115_id: 'cid_1001',
            name: '沙丘2.Dune.Part.Two.2024.2160p.Dolby.Vision.Atmos.mkv',
            extension: 'mkv',
            size: 45097156608,
            is_dir: false,
            sha1: '1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C',
            full_path: '/科幻电影/沙丘2.Dune.Part.Two.2024.2160p.Dolby.Vision.Atmos.mkv',
            share_code: 'sw38914kremux',
            receive_code: '4k88',
            share_title: '4K UHD HDR 原盘电影与高码率蓝光合集 (2024)',
          },
          {
            id: 201,
            share_id: 2,
            file_115_id: 'cid_2001',
            parent_115_id: '0',
            name: '系统架构与分布式',
            extension: '',
            size: 0,
            is_dir: true,
            sha1: '',
            full_path: '/系统架构与分布式',
            share_code: 'sw398cslearning',
            receive_code: 'cs24',
            share_title: '计算机核心课程架构师进阶与经典电子书精选',
          },
          {
            id: 202,
            share_id: 2,
            file_115_id: 'fid_3001',
            parent_115_id: 'cid_2001',
            name: 'Designing Data-Intensive Applications (DDIA中文版深入理解分布式系统).pdf',
            extension: 'pdf',
            size: 89128960,
            is_dir: false,
            sha1: 'F1E2D3C4B5A697887766554433221100FFAABBCC',
            full_path: '/系统架构与分布式/Designing Data-Intensive Applications (DDIA中文版深入理解分布式系统).pdf',
            share_code: 'sw398cslearning',
            receive_code: 'cs24',
            share_title: '计算机核心课程架构师进阶与经典电子书精选',
          },
          {
            id: 301,
            share_id: 3,
            file_115_id: 'cid_3001',
            parent_115_id: '0',
            name: '电影原声OST',
            extension: '',
            size: 0,
            is_dir: true,
            sha1: '',
            full_path: '/电影原声OST',
            share_code: 'sw377flachifi',
            receive_code: '',
            share_title: '母带级 Hi-Res 24bit/96kHz 无损音乐精选集',
          },
          {
            id: 302,
            share_id: 3,
            file_115_id: 'fid_4001',
            parent_115_id: 'cid_3001',
            name: 'Hans Zimmer - Live in Prague (24bit-96kHz Hi-Res FLAC).flac',
            extension: 'flac',
            size: 2894069760,
            is_dir: false,
            sha1: 'A9B8C7D6E5F4A3B2C1D09E8F7A6B5C4D3E2F1A0B',
            full_path: '/电影原声OST/Hans Zimmer - Live in Prague (24bit-96kHz Hi-Res FLAC).flac',
            share_code: 'sw377flachifi',
            receive_code: '',
            share_title: '母带级 Hi-Res 24bit/96kHz 无损音乐精选集',
          }
        ];

        let mockShares: any[] = (globalThis as any).__mockShares || defaultMockShares;
        (globalThis as any).__mockShares = mockShares;

        let mockFiles: any[] = (globalThis as any).__mockFiles || defaultMockFiles;
        (globalThis as any).__mockFiles = mockFiles;

        // 1. Admin Verification
        if (url === '/api/v1/admin/verify' && method === 'POST') {
          const body = await readJsonBody();
          const token = String(body.token || '').trim();
          const validTokens = ['admin115', 'admin123', 'admin', '115share@admin'];
          
          if (validTokens.includes(token) || token.length >= 4) {
            return sendJson(200, {
              authenticated: true,
              message: '管理员授权验证通过！已解锁管理后台与系统配置。',
              token: token,
              is_initialized: true
            });
          } else {
            return sendJson(401, {
              authenticated: false,
              detail: '管理员授权口令不正确。提示：AI Studio 实例默认口令为 admin115 或 admin123'
            });
          }
        }

        // 2. Admin Status
        if (url === '/api/v1/admin/status' && method === 'GET') {
          return sendJson(200, {
            auth_enabled: true,
            authenticated: true,
            is_initialized: true,
            message: '管理鉴权就绪'
          });
        }

        // 3. Admin Init & Change Password
        if (url === '/api/v1/admin/init' && method === 'POST') {
          const body = await readJsonBody();
          const newPwd = String(body.new_password || 'admin115').trim();
          return sendJson(200, {
            authenticated: true,
            is_initialized: true,
            message: '管理密码初始化成功！',
            token: newPwd
          });
        }

        if (url === '/api/v1/admin/change-password' && method === 'POST') {
          const body = await readJsonBody();
          const newPwd = String(body.new_password || '').trim();
          return sendJson(200, {
            success: true,
            message: '管理密码修改成功！',
            new_token: newPwd
          });
        }

        // 4. Shares List GET
        if ((url === '/api/v1/shares' || url.startsWith('/api/v1/shares?')) && method === 'GET') {
          return sendJson(200, {
            total: mockShares.length,
            page: 1,
            page_size: 100,
            total_pages: 1,
            stats: {
              total_shares: mockShares.length,
              active_shares: mockShares.filter((s: any) => s.status === 1).length,
              pending_shares: mockShares.filter((s: any) => s.status === 0).length,
              expired_shares: mockShares.filter((s: any) => s.status >= 2).length,
              total_files: mockShares.reduce((acc: number, s: any) => acc + (s.file_count || 0), 0),
              total_size: mockShares.reduce((acc: number, s: any) => acc + (s.total_size || 0), 0),
            },
            items: mockShares,
          });
        }

        // 4.1 Search API GET
        if (url.startsWith('/api/v1/search') && method === 'GET') {
          const parsedUrl = new URL(req.url || '', 'http://localhost');
          const kw = (parsedUrl.searchParams.get('keyword') || '').trim().toLowerCase();
          const ext = (parsedUrl.searchParams.get('extension') || '').trim().toLowerCase();
          const isDirParam = parsedUrl.searchParams.get('is_dir');
          const isDir = isDirParam === 'true';
          const minSize = parsedUrl.searchParams.get('min_size') ? Number(parsedUrl.searchParams.get('min_size')) : null;
          const maxSize = parsedUrl.searchParams.get('max_size') ? Number(parsedUrl.searchParams.get('max_size')) : null;
          const page = Math.max(1, Number(parsedUrl.searchParams.get('page')) || 1);
          const pageSize = Math.max(1, Number(parsedUrl.searchParams.get('page_size')) || 20);

          let filtered = mockFiles.filter((f: any) => {
            if (f.is_dir !== isDir) return false;
            if (ext && f.extension.toLowerCase() !== ext) return false;
            if (minSize !== null && f.size < minSize) return false;
            if (maxSize !== null && f.size > maxSize) return false;
            if (kw) {
              const full = ((f.full_path || '') + ' ' + (f.name || '')).toLowerCase();
              return kw.split(/\s+/).every((term: string) => full.includes(term));
            }
            return true;
          });

          const total = filtered.length;
          const totalPages = Math.ceil(total / pageSize) || 1;
          const offset = (page - 1) * pageSize;
          const items = filtered.slice(offset, offset + pageSize);

          return sendJson(200, {
            keyword: kw,
            total,
            page,
            page_size: pageSize,
            total_pages: totalPages,
            items,
          });
        }

        // 4.2 Single Share Files GET
        if (url.startsWith('/api/v1/shares/') && url.includes('/files') && method === 'GET') {
          const parsedUrl = new URL(req.url || '', 'http://localhost');
          const parentCid = parsedUrl.searchParams.get('parent_115_id') || '0';
          const match = url.match(/\/api\/v1\/shares\/([^\/\?]+)\/files/);
          const shareCode = match ? decodeURIComponent(match[1]) : '';

          const shareFiles = mockFiles.filter((f: any) => f.share_code === shareCode);
          const items = shareFiles.filter((f: any) => f.parent_115_id === parentCid);

          return sendJson(200, {
            share_code: shareCode,
            parent_115_id: parentCid,
            total: items.length,
            breadcrumbs: [{ name: '根目录', cid: '0', path: '/' }],
            items,
          });
        }

        // 4.3 Trigger Crawl POST
        if (url.match(/\/api\/v1\/shares\/[^\/]+\/crawl/) && method === 'POST') {
          const match = url.match(/\/api\/v1\/shares\/([^\/\?]+)\/crawl/);
          const shareCode = match ? decodeURIComponent(match[1]) : '';
          const target = mockShares.find((s: any) => s.share_code === shareCode);
          if (target) {
            target.status = 1;
            target.file_count = target.file_count || 18;
            target.total_size = target.total_size || 10737418240;
            target.last_crawled_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
          }
          return sendJson(200, {
            share_code: shareCode,
            status: 'completed',
            message: `分享 ${shareCode} 已完成爬取与索引！`
          });
        }

        // 4.4 Batch Crawl POST
        if (url === '/api/v1/shares/batch-crawl' && method === 'POST') {
          const body = await readJsonBody();
          const codes = body.share_codes || [];
          for (const s of mockShares) {
            if (codes.includes(s.share_code)) {
              s.status = 1;
              s.file_count = s.file_count || 24;
              s.total_size = s.total_size || 12884901888;
              s.last_crawled_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
            }
          }
          return sendJson(200, {
            status: 'success',
            crawled_count: codes.length,
            message: `成功完成 ${codes.length} 个分享的重新爬取与索引！`
          });
        }

        // 4.5 Seed Demo Shares POST
        if (url === '/api/v1/shares/seed-demo' && method === 'POST') {
          mockShares.length = 0;
          mockShares.push(...defaultMockShares);
          mockFiles.length = 0;
          mockFiles.push(...defaultMockFiles);
          return sendJson(200, {
            success: true,
            shares_seeded: defaultMockShares.length,
            files_seeded: defaultMockFiles.length,
            message: `成功恢复系统演示分享数据（${defaultMockShares.length} 条分享，${defaultMockFiles.length} 个文件节点）！`
          });
        }

        // 4.6 Single Share Link Removal (Cascade delete files)
        if (url.startsWith('/api/v1/shares/') && method === 'DELETE') {
          const parts = url.split('/');
          const shareCode = decodeURIComponent(parts[parts.length - 1] || '');
          const idx = mockShares.findIndex((s: any) => s.share_code === shareCode);
          if (idx !== -1) {
            mockShares.splice(idx, 1);
          }
          const delFiles = mockFiles.filter((f: any) => f.share_code === shareCode).length;
          const remainingFiles = mockFiles.filter((f: any) => f.share_code !== shareCode);
          mockFiles.length = 0;
          mockFiles.push(...remainingFiles);

          return sendJson(200, {
            status: 'success',
            share_code: shareCode,
            deleted_files: delFiles,
            message: `已彻底移除分享链接 ${shareCode}，并级联清除其名下全部关联文件记录！`
          });
        }

        // 5. Batch Delete Shares
        if (url === '/api/v1/shares/batch-delete' && method === 'POST') {
          const body = await readJsonBody();
          const codes = body.share_codes || [];
          const remainingShares = mockShares.filter((s: any) => !codes.includes(s.share_code));
          mockShares.length = 0;
          mockShares.push(...remainingShares);

          const remainingFiles = mockFiles.filter((f: any) => !codes.includes(f.share_code));
          mockFiles.length = 0;
          mockFiles.push(...remainingFiles);

          return sendJson(200, {
            status: 'success',
            deleted_shares: codes.length,
            deleted_files: codes.length * 15,
            message: `已成功批量移除 ${codes.length} 个分享链接及名下所有文件！`
          });
        }

        // 6. Sync Root Titles
        if (url === '/api/v1/shares/sync-root-titles' && method === 'POST') {
          return sendJson(200, {
            status: 'success',
            message: '已自动同步所有分享的根目录标题！'
          });
        }

        // 7. Batch Import Shares (Support >200 chunks, returns HTTP 202)
        if (url === '/api/v1/shares/batch-import' && method === 'POST') {
          const body = await readJsonBody();
          const submittedShares = body.shares || [];
          const totalSubmitted = submittedShares.length;
          const distinctCodes = Array.from(new Set(submittedShares.map((s: any) => s.share_code).filter(Boolean)));
          
          for (const item of submittedShares) {
            if (!item.share_code) continue;
            const existing = mockShares.find((s: any) => s.share_code === item.share_code);
            if (!existing) {
              const newShare = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                share_code: item.share_code,
                receive_code: item.receive_code || '',
                title: item.title || `115 分享 (${item.share_code})`,
                file_count: 12,
                folder_count: 2,
                total_size: 5368709120,
                status: 1,
                created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
                last_crawled_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
              };
              mockShares.unshift(newShare);

              mockFiles.unshift({
                id: Date.now() + Math.floor(Math.random() * 1000),
                share_id: newShare.id,
                file_115_id: `cid_${item.share_code}`,
                parent_115_id: '0',
                name: newShare.title,
                extension: '',
                size: 0,
                is_dir: true,
                sha1: '',
                full_path: `/${newShare.title}`,
                share_code: item.share_code,
                receive_code: item.receive_code || '',
                share_title: newShare.title,
              });
            }
          }

          return sendJson(202, {
            total_submitted: totalSubmitted,
            tasks_queued: distinctCodes.length,
            ignored_duplicates: 0,
            failed_count: 0,
            batches_processed: Math.ceil(distinctCodes.length / 100) || 1,
            task_ids: distinctCodes.slice(0, 50).map((c: any) => `task_${c}`),
            message: `已成功接收处理 ${totalSubmitted} 条链接（含 ${distinctCodes.length} 条唯一分享），已成功推入后台抓取队列 ${distinctCodes.length} 条。`
          });
        }

        // 8. Public AdSense Config
        if (url === '/api/v1/public/adsense-config' && method === 'GET') {
          return sendJson(200, {
            enabled: Boolean(mockSettings.ADSENSE_ENABLED),
            client_id: String(mockSettings.ADSENSE_CLIENT_ID || '').trim(),
            slot_id: String(mockSettings.ADSENSE_SLOT_ID || '').trim(),
            auto_ads: Boolean(mockSettings.ADSENSE_AUTO_ADS !== false),
            test_mode: Boolean(mockSettings.ADSENSE_TEST_MODE),
          });
        }

        // 9. Admin Settings GET
        if (url === '/api/v1/admin/settings' && method === 'GET') {
          return sendJson(200, {
            categories: [
              {
                id: 'crawler',
                name: '115 爬虫与引擎频控',
                items: [
                  { key: 'CRAWLER_COOKIE', title: '115 账号凭据 (VIP Cookie)', description: '用于快照与递归抓取的 115 账号 Cookie', type: 'string', category: 'crawler', default: '', current: mockSettings.CRAWLER_COOKIE || '', is_modified: !!mockSettings.CRAWLER_COOKIE, sensitive: true },
                  { key: 'CRAWLER_CONCURRENCY', title: '爬虫最大并发协程数', description: '限制爬虫并发请求 115 API 的最大 Worker 数量', type: 'int', category: 'crawler', default: 16, current: Number(mockSettings.CRAWLER_CONCURRENCY) || 16, is_modified: mockSettings.CRAWLER_CONCURRENCY !== 16, sensitive: false },
                  { key: 'CRAWLER_RATE_MIN', title: '单节点极小请求间隔 (秒)', description: '避免请求过于频繁触发 405 封禁', type: 'float', category: 'crawler', default: 0.15, current: Number(mockSettings.CRAWLER_RATE_MIN) || 0.15, is_modified: mockSettings.CRAWLER_RATE_MIN !== 0.15, sensitive: false },
                  { key: 'CRAWLER_RATE_MAX', title: '单节点极大请求间隔 (秒)', description: '随机延迟浮动区间上界', type: 'float', category: 'crawler', default: 0.35, current: Number(mockSettings.CRAWLER_RATE_MAX) || 0.35, is_modified: mockSettings.CRAWLER_RATE_MAX !== 0.35, sensitive: false },
                  { key: 'CRAWLER_PAGE_SIZE', title: '单页拉取最大节点数量', description: 'snap API 每次拉取的目录/文件数量', type: 'int', category: 'crawler', default: 100, current: Number(mockSettings.CRAWLER_PAGE_SIZE) || 100, is_modified: mockSettings.CRAWLER_PAGE_SIZE !== 100, sensitive: false }
                ]
              },
              {
                id: 'adsense',
                name: 'Google AdSense 商业化广告',
                items: [
                  { key: 'ADSENSE_ENABLED', title: '启用 Google AdSense', description: '总开关。开启后将在公共页面自动注入 AdSense 脚本并展示商业化广告位', type: 'bool', category: 'adsense', default: false, current: !!mockSettings.ADSENSE_ENABLED, is_modified: !!mockSettings.ADSENSE_ENABLED, sensitive: false },
                  { key: 'ADSENSE_CLIENT_ID', title: 'AdSense 客户 ID (Publisher ID)', description: 'Google AdSense 发布商唯一标识，格式如 ca-pub-1234567890123456', type: 'string', category: 'adsense', default: '', current: mockSettings.ADSENSE_CLIENT_ID || '', is_modified: !!mockSettings.ADSENSE_CLIENT_ID, sensitive: false },
                  { key: 'ADSENSE_SLOT_ID', title: '搜索与详情页广告单元 ID (Slot ID)', description: '可选。指定固定广告单元展示代码 (如 8912345678)，留空则仅使用 Auto Ads 自动广告', type: 'string', category: 'adsense', default: '', current: mockSettings.ADSENSE_SLOT_ID || '', is_modified: !!mockSettings.ADSENSE_SLOT_ID, sensitive: false },
                  { key: 'ADSENSE_AUTO_ADS', title: '启用全自动广告 (Auto Ads)', description: '开启后 Google AI 算法将自动识别最佳版位并在页面合适位置呈现响应式广告', type: 'bool', category: 'adsense', default: true, current: mockSettings.ADSENSE_AUTO_ADS !== false, is_modified: mockSettings.ADSENSE_AUTO_ADS === false, sensitive: false },
                  { key: 'ADSENSE_TEST_MODE', title: '测试广告模式 (Test Mode)', description: '开发或刚接入审核阶段建议开启 (data-adtest="on")，避免站长误点产生无效流量处罚', type: 'bool', category: 'adsense', default: false, current: !!mockSettings.ADSENSE_TEST_MODE, is_modified: !!mockSettings.ADSENSE_TEST_MODE, sensitive: false }
                ]
              },
              {
                id: 'worker',
                name: '后台任务调度与看门狗',
                items: [
                  { key: 'WORKER_CONCURRENCY', title: '后台任务消费者并发数', description: '同时处理分享抓取的消费者进程/协程上限', type: 'int', category: 'worker', default: 4, current: Number(mockSettings.WORKER_CONCURRENCY) || 4, is_modified: mockSettings.WORKER_CONCURRENCY !== 4, sensitive: false },
                  { key: 'STUCK_TASK_CHECK_INTERVAL', title: '死锁看门狗巡检周期 (秒)', description: '后台自动探测卡死或假死任务的检测间隔', type: 'int', category: 'worker', default: 60, current: Number(mockSettings.STUCK_TASK_CHECK_INTERVAL) || 60, is_modified: mockSettings.STUCK_TASK_CHECK_INTERVAL !== 60, sensitive: false },
                  { key: 'STUCK_TASK_TIMEOUT_SECONDS', title: '任务僵死判定超时 (秒)', description: '超过此时间无进度的抓取任务将被自动释放并恢复', type: 'int', category: 'worker', default: 300, current: Number(mockSettings.STUCK_TASK_TIMEOUT_SECONDS) || 300, is_modified: mockSettings.STUCK_TASK_TIMEOUT_SECONDS !== 300, sensitive: false }
                ]
              }
            ],
            total_count: 12
          });
        }

        // 10. Admin Settings POST (Batch update)
        if (url === '/api/v1/admin/settings' && method === 'POST') {
          const body = await readJsonBody();
          const incoming = body.settings || {};
          Object.assign(mockSettings, incoming);
          return sendJson(200, {
            success: true,
            updated_count: Object.keys(incoming).length,
            applied_settings: incoming,
            message: `成功保存并应用 ${Object.keys(incoming).length} 项系统配置至 PostgreSQL 数据库，已即刻生效！`
          });
        }

        // 11. Admin Settings Reset
        if (url === '/api/v1/admin/settings/reset' && method === 'POST') {
          const body = await readJsonBody();
          const keys = body.keys;
          if (!keys || !keys.length) {
            mockSettings.ADSENSE_ENABLED = false;
            mockSettings.ADSENSE_CLIENT_ID = '';
            mockSettings.ADSENSE_SLOT_ID = '';
            mockSettings.ADSENSE_AUTO_ADS = true;
            mockSettings.ADSENSE_TEST_MODE = false;
          } else {
            for (const k of keys) {
              if (k in mockSettings) {
                if (k.startsWith('ADSENSE_')) {
                  mockSettings[k] = k === 'ADSENSE_AUTO_ADS';
                }
              }
            }
          }
          return sendJson(200, {
            success: true,
            reset_count: keys ? keys.length : 14,
            message: '成功将系统配置恢复为系统出厂默认值！'
          });
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), aistudioMediaPlugin(), aistudioApiMockPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
