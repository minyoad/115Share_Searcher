export interface ProjectFile {
  name: string;
  path: string;
  language: string;
  content: string;
  description: string;
}

export interface ShareRecord {
  id: number;
  share_code: string;
  receive_code: string;
  title: string;
  file_count: number;
  folder_count: number;
  total_size: number;
  status: number; // 0: PENDING, 1: ACTIVE, 2: EXPIRED, 3: BANNED
  created_at: string;
  last_crawled_at: string;
}

export interface FileRecord {
  id: number;
  share_id: number;
  file_115_id: string;
  parent_115_id: string;
  name: string;
  extension: string;
  size: number;
  is_dir: boolean;
  sha1: string;
  full_path: string;
  share_code: string;
  receive_code: string;
  share_title: string;
}

export interface ProxyNodeInfo {
  url: string;
  protocol: string;
  success_count: number;
  failure_count: number;
  consecutive_failures: number;
  is_available: boolean;
  is_banned_405: boolean;
  banned_remaining_sec: number;
  last_latency_ms: number;
  recent_errors: string[];
}

export interface ProxySystemStatus {
  mode: string;
  rotation_strategy: string;
  total_proxies: number;
  available_proxies: number;
  banned_405_count: number;
  failed_count: number;
  total_success_requests: number;
  total_failed_requests: number;
  current_sticky_proxy: string | null;
  last_refresh_time: string | null;
  refresh_interval_sec: number;
  api_endpoint: string | null;
  sample_nodes: ProxyNodeInfo[];
}

export type ActiveTab = 'search' | 'tasks' | 'code' | 'crawler' | 'proxy' | 'import' | 'tree' | 'api';

