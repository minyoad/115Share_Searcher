import enum
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ShareStatus(int, enum.Enum):
    PENDING = 0      # 待抓取 / 抓取中
    ACTIVE = 1       # 抓取完成，有效
    EXPIRED = 2      # 已过期 / 提取码错误 / 资源不存在
    BANNED = 3       # 违规屏蔽 / 违规分享


class Share(Base):
    """
    115 分享链接元数据表 (shares)
    """
    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    share_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    receive_code: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    title: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    file_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    folder_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    status: Mapped[int] = mapped_column(SmallInteger, default=ShareStatus.PENDING.value, nullable=False, index=True)
    
    last_crawled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    # 关联文件集合 (级联删除)
    files: Mapped[List["File"]] = relationship(
        "File",
        back_populates="share",
        cascade="all, delete-orphan",
        passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<Share(id={self.id}, code='{self.share_code}', title='{self.title}', status={self.status})>"


class File(Base):
    """
    115 目录与文件节点元数据表 (files)
    """
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    share_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("shares.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    file_115_id: Mapped[str] = mapped_column(String(64), nullable=False)  # 115 的 fid (文件) 或 cid (文件夹)
    parent_115_id: Mapped[str] = mapped_column(String(64), default="0", nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    extension: Mapped[str] = mapped_column(String(32), default="", nullable=False, index=True)
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False, index=True)
    is_dir: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    sha1: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    full_path: Mapped[str] = mapped_column(Text, nullable=False)

    # 关联分享
    share: Mapped["Share"] = relationship("Share", back_populates="files")

    __table_args__ = (
        # 保证同一分享内的 115 节点 ID 唯一，支持幂等 Upsert
        UniqueConstraint("share_id", "file_115_id", name="uq_share_file_115_id"),
        # PostgreSQL GIN 索引，配合 pg_trgm 支持毫秒级全文/模糊路径搜索
        Index(
            "ix_files_full_path_trgm",
            "full_path",
            postgresql_using="gin",
            postgresql_ops={"full_path": "gin_trgm_ops"},
        ),
        # 复合索引优化常用过滤: 扩展名 + 大小
        Index("ix_files_ext_size", "extension", "size"),
    )

    def __repr__(self) -> str:
        return f"<File(id={self.id}, name='{self.name}', is_dir={self.is_dir}, size={self.size})>"
