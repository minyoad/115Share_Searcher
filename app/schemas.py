import re
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


def format_size(size_bytes: int) -> str:
    """Format bytes into human-readable string (KB, MB, GB, TB)."""
    if size_bytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    idx = 0
    size = float(size_bytes)
    while size >= 1024.0 and idx < len(units) - 1:
        size /= 1024.0
        idx += 1
    return f"{size:.2f} {units[idx]}" if idx > 0 else f"{int(size)} B"


# Robust parser for all 115 share URL variations (115.com, 115cdn.com, anxia.com, hash passwords, etc.)
def parse_115_share_url(raw_text: str) -> tuple[Optional[str], str]:
    """
    解析各种格式的 115 分享链接与提取码：
    - https://115cdn.com/s/swnsdrk3h2m?password=p783
    - https://115.com/s/sw6tcot3hbe?password=e9d7
    - https://anxia.com/s/swxxxx#yyyy
    - https://v.115.com/s/swxxxx?receive_code=yyyy
    - swxxxx#yyyy / swxxxx?password=yyyy / swxxxx
    """
    if not raw_text:
        return None, ""
    
    text = raw_text.strip()
    
    # Pattern 1: URL with /s/ (supports 115.com, 115cdn.com, anxia.com, web.115.com, etc.)
    url_match = re.search(
        r"(?:https?://)?(?:[a-zA-Z0-9.-]+\.)?(?:115(?:cdn)?|anxia)\.com/s/([a-zA-Z0-9_-]+)",
        text,
        re.IGNORECASE,
    )
    if url_match:
        share_code = url_match.group(1)
        pwd_match = re.search(
            r"(?:[?&](?:password|pwd|receive_code)=([a-zA-Z0-9]+)|#([a-zA-Z0-9]+))",
            text,
            re.IGNORECASE,
        )
        receive_code = ""
        if pwd_match:
            receive_code = pwd_match.group(1) or pwd_match.group(2) or ""
        return share_code, receive_code

    # Pattern 2: Any /s/([a-zA-Z0-9_-]+)
    any_s_match = re.search(r"/s/([a-zA-Z0-9_-]{6,64})", text, re.IGNORECASE)
    if any_s_match:
        share_code = any_s_match.group(1)
        pwd_match = re.search(
            r"(?:[?&](?:password|pwd|receive_code)=([a-zA-Z0-9]+)|#([a-zA-Z0-9]+))",
            text,
            re.IGNORECASE,
        )
        receive_code = ""
        if pwd_match:
            receive_code = pwd_match.group(1) or pwd_match.group(2) or ""
        return share_code, receive_code

    # Pattern 3: Raw share_code + optional password (e.g., swnsdrk3h2m#p783 or swnsdrk3h2m)
    code_match = re.search(
        r"^([a-zA-Z0-9_-]{6,64})(?:[?&#](?:(?:password|pwd|receive_code)=)?([a-zA-Z0-9]{2,32}))?$",
        text,
        re.IGNORECASE,
    )
    if code_match:
        share_code = code_match.group(1)
        receive_code = code_match.group(2) or ""
        return share_code, receive_code

    return None, ""


class ShareImportItem(BaseModel):
    """
    单个导入项：可传入标准 share_code / receive_code，或直接传入 raw_url 自动正则提取
    """
    share_code: Optional[str] = Field(default=None, description="115 分享代码")
    receive_code: Optional[str] = Field(default="", description="115 提取码 (如无则留空)")
    raw_url: Optional[str] = Field(default=None, description="原始分享链接或文本")

    @model_validator(mode="before")
    @classmethod
    def parse_raw_url_if_provided(cls, data: Any) -> Any:
        if isinstance(data, dict):
            raw = data.get("raw_url")
            if raw:
                sc, rc = parse_115_share_url(raw)
                if sc and not data.get("share_code"):
                    data["share_code"] = sc
                if rc and not data.get("receive_code"):
                    data["receive_code"] = rc

            # Clean share_code
            if data.get("share_code"):
                data["share_code"] = data["share_code"].strip()
            if data.get("receive_code") is None:
                data["receive_code"] = ""
            elif isinstance(data["receive_code"], str):
                data["receive_code"] = data["receive_code"].strip()
        return data


class BatchImportRequest(BaseModel):
    """批量导入分享链接请求"""
    shares: List[ShareImportItem] = Field(..., min_length=1, max_length=200, description="分享列表")
    force_crawl: bool = Field(default=True, description="是否强制重新触发爬取（若已存在或未完成则再次入队）")


class BatchImportTaskResult(BaseModel):
    """批量导入响应"""
    total_submitted: int
    tasks_queued: int
    ignored_duplicates: int
    task_ids: List[str]
    message: str


class ShareInfo(BaseModel):
    """分享元数据"""
    id: int
    share_code: str
    receive_code: str
    title: str
    file_count: int
    folder_count: int
    total_size: int
    total_size_formatted: str = ""
    status: int
    status_desc: str = ""
    last_crawled_at: Optional[datetime] = None
    created_at: datetime
    share_url: str = ""

    @model_validator(mode="after")
    def compute_fields(self) -> "ShareInfo":
        self.total_size_formatted = format_size(self.total_size)
        pwd_suffix = f"?password={self.receive_code}" if self.receive_code else ""
        self.share_url = f"https://115.com/s/{self.share_code}{pwd_suffix}"
        
        status_map = {0: "PENDING (抓取中/待抓取)", 1: "ACTIVE (抓取完成)", 2: "EXPIRED (失效/密码错误)", 3: "BANNED (违规封禁)"}
        self.status_desc = status_map.get(self.status, "UNKNOWN")
        return self


class ShareListResponse(BaseModel):
    """分享列表响应及统计信息"""
    total: int
    page: int
    page_size: int
    total_pages: int
    stats: dict
    items: List[ShareInfo]


class TriggerCrawlResponse(BaseModel):
    """手动开始/重新爬取响应"""
    share_code: str
    task_id: str
    status: str
    message: str


class SearchResultItem(BaseModel):
    """检索结果文件条目"""
    id: int
    file_115_id: str
    parent_115_id: str
    name: str
    extension: str
    size: int
    formatted_size: str
    is_dir: bool
    sha1: str
    full_path: str
    share_id: int
    share_code: str
    receive_code: str
    share_title: str
    share_status: int
    share_url: str
    openlist_mount_cid: str = Field(
        description="用于 AList / OpenList / 115 开放接口挂载或定位的目录/文件 CID/FID"
    )


class SearchResponse(BaseModel):
    """搜索结果分页响应"""
    keyword: str
    total: int
    page: int
    page_size: int
    total_pages: int
    items: List[SearchResultItem]


class FileTreeNode(BaseModel):
    """目录层级导航文件节点"""
    id: int
    file_115_id: str
    parent_115_id: str
    name: str
    extension: str
    size: int
    formatted_size: str
    is_dir: bool
    sha1: str
    full_path: str


class DirectoryBreadcrumb(BaseModel):
    name: str
    cid: str
    path: str


class DirectoryListResponse(BaseModel):
    """目录列表响应"""
    share_code: str
    share_title: str = ""
    receive_code: str = ""
    share_status: int = 1
    share_url: str = ""
    parent_115_id: str
    parent_path: str = "/"
    total: int
    folder_count: int = 0
    file_count: int = 0
    total_size: int = 0
    total_size_formatted: str = "0 B"
    breadcrumbs: List[DirectoryBreadcrumb] = []
    items: List[FileTreeNode]


class ReportShareRequest(BaseModel):
    """失效上报请求"""
    reason: Optional[str] = Field(default="expired", description="失效原因: expired, password_error, banned, other")


class ReportShareResponse(BaseModel):
    """失效上报响应"""
    share_code: str
    status: int
    message: str
