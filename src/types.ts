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

export type ActiveTab = 'search' | 'code' | 'crawler' | 'import' | 'api' | 'tree';
