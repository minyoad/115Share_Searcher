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

        // 4. Single Share Link Removal (Cascade delete files)
        if (url.startsWith('/api/v1/shares/') && method === 'DELETE') {
          const parts = url.split('/');
          const shareCode = decodeURIComponent(parts[parts.length - 1] || '');
          return sendJson(200, {
            status: 'success',
            share_code: shareCode,
            deleted_files: 18,
            message: `已彻底移除分享链接 ${shareCode}，并级联清除其名下全部关联文件记录！`
          });
        }

        // 5. Batch Delete Shares
        if (url === '/api/v1/shares/batch-delete' && method === 'POST') {
          const body = await readJsonBody();
          const codes = body.share_codes || [];
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
