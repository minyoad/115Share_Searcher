import logging
from datetime import datetime, timezone
from typing import Dict, Any, List
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.database import AsyncSessionLocal
from app.models import File, Share, ShareStatus

logger = logging.getLogger("app.seed")

DEMO_SHARES = [
    {
        "share_code": "sw38914kremux",
        "receive_code": "4k88",
        "title": "4K UHD HDR 原盘电影与高码率蓝光合集 (2024)",
        "file_count": 38,
        "folder_count": 6,
        "total_size": 1984279930880,  # ~1.8 TB
        "status": ShareStatus.ACTIVE.value,
        "files": [
            {
                "file_115_id": "cid_1001",
                "parent_115_id": "0",
                "name": "科幻电影",
                "extension": "",
                "size": 0,
                "is_dir": True,
                "sha1": "",
                "full_path": "/科幻电影",
            },
            {
                "file_115_id": "fid_2001",
                "parent_115_id": "cid_1001",
                "name": "星际穿越.Interstellar.2014.IMAX.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1.mkv",
                "extension": "mkv",
                "size": 41875928120,
                "is_dir": False,
                "sha1": "3a88fc2109db89a910248491c98fe37b1938ab01",
                "full_path": "/科幻电影/星际穿越.Interstellar.2014.IMAX.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1.mkv",
            },
            {
                "file_115_id": "fid_2002",
                "parent_115_id": "cid_1001",
                "name": "沙丘2.Dune.Part.Two.2024.2160p.DV.HDR10Plus.TrueHD.Atmos.7.1.x265-FLUX.mkv",
                "extension": "mkv",
                "size": 32212254720,
                "is_dir": False,
                "sha1": "98bf41a3cd4e2098bfe194819d93821764ab9023",
                "full_path": "/科幻电影/沙丘2.Dune.Part.Two.2024.2160p.DV.HDR10Plus.TrueHD.Atmos.7.1.x265-FLUX.mkv",
            },
            {
                "file_115_id": "fid_2003",
                "parent_115_id": "cid_1001",
                "name": "奥本海默.Oppenheimer.2023.2160p.UHD.BluRay.x265.TrueHD.7.1.Atmos.mkv",
                "extension": "mkv",
                "size": 48920194880,
                "is_dir": False,
                "sha1": "e4901928471baf8920394812398402918374ba22",
                "full_path": "/科幻电影/奥本海默.Oppenheimer.2023.2160p.UHD.BluRay.x265.TrueHD.7.1.Atmos.mkv",
            },
            {
                "file_115_id": "cid_1002",
                "parent_115_id": "0",
                "name": "4K纪录片与自然探索",
                "extension": "",
                "size": 0,
                "is_dir": True,
                "sha1": "",
                "full_path": "/4K纪录片与自然探索",
            },
            {
                "file_115_id": "fid_2004",
                "parent_115_id": "cid_1002",
                "name": "地球脉动.Planet.Earth.III.2023.S03.2160p.UHD.HDR.DoVi.HLG.mkv",
                "extension": "mkv",
                "size": 78920194880,
                "is_dir": False,
                "sha1": "a129384819283746192837461928374619283746",
                "full_path": "/4K纪录片与自然探索/地球脉动.Planet.Earth.III.2023.S03.2160p.UHD.HDR.DoVi.HLG.mkv",
            },
        ],
    },
    {
        "share_code": "sw398cslearning",
        "receive_code": "cs24",
        "title": "计算机核心课程架构师进阶与经典电子书精选",
        "file_count": 142,
        "folder_count": 12,
        "total_size": 48920194880,
        "status": ShareStatus.ACTIVE.value,
        "files": [
            {
                "file_115_id": "cid_2001",
                "parent_115_id": "0",
                "name": "分布式系统与云原生",
                "extension": "",
                "size": 0,
                "is_dir": True,
                "sha1": "",
                "full_path": "/分布式系统与云原生",
            },
            {
                "file_115_id": "fid_3001",
                "parent_115_id": "cid_2001",
                "name": "Designing Data-Intensive Applications (DDIA 数据密集型应用系统设计 中英文精校版).pdf",
                "extension": "pdf",
                "size": 45088768,
                "is_dir": False,
                "sha1": "b567891234567890abcdef1234567890abcdef12",
                "full_path": "/分布式系统与云原生/Designing Data-Intensive Applications (DDIA 数据密集型应用系统设计 中英文精校版).pdf",
            },
            {
                "file_115_id": "fid_3002",
                "parent_115_id": "cid_2001",
                "name": "PostgreSQL 15 高性能架构与内核源码剖析.pdf",
                "extension": "pdf",
                "size": 38200100,
                "is_dir": False,
                "sha1": "c8901234567890abcdef1234567890abcdef1234",
                "full_path": "/分布式系统与云原生/PostgreSQL 15 高性能架构与内核源码剖析.pdf",
            },
            {
                "file_115_id": "fid_3003",
                "parent_115_id": "cid_2001",
                "name": "Kubernetes权威指南.企业级容器云实战与调优.pdf",
                "extension": "pdf",
                "size": 65120400,
                "is_dir": False,
                "sha1": "d901234567890abcdef1234567890abcdef12345",
                "full_path": "/分布式系统与云原生/Kubernetes权威指南.企业级容器云实战与调优.pdf",
            },
            {
                "file_115_id": "cid_2002",
                "parent_115_id": "0",
                "name": "经典计算机体系结构",
                "extension": "",
                "size": 0,
                "is_dir": True,
                "sha1": "",
                "full_path": "/经典计算机体系结构",
            },
            {
                "file_115_id": "fid_3004",
                "parent_115_id": "cid_2002",
                "name": "深入理解计算机系统.CSAPP.原书第3版.中文清晰扫描版.pdf",
                "extension": "pdf",
                "size": 138400000,
                "is_dir": False,
                "sha1": "e01234567890abcdef1234567890abcdef123456",
                "full_path": "/经典计算机体系结构/深入理解计算机系统.CSAPP.原书第3版.中文清晰扫描版.pdf",
            },
        ],
    },
    {
        "share_code": "sw377flachifi",
        "receive_code": "",
        "title": "母带级 Hi-Res 24bit/96kHz 无损音乐精选集",
        "file_count": 85,
        "folder_count": 8,
        "total_size": 128994827000,
        "status": ShareStatus.ACTIVE.value,
        "files": [
            {
                "file_115_id": "cid_3001",
                "parent_115_id": "0",
                "name": "华语流行黄金年代",
                "extension": "",
                "size": 0,
                "is_dir": True,
                "sha1": "",
                "full_path": "/华语流行黄金年代",
            },
            {
                "file_115_id": "fid_4001",
                "parent_115_id": "cid_3001",
                "name": "周杰伦 - 范特西 (Fantasy 2001 24bit-96kHz FLAC Hi-Res).flac",
                "extension": "flac",
                "size": 892019480,
                "is_dir": False,
                "sha1": "f1234567890abcdef1234567890abcdef1234567",
                "full_path": "/华语流行黄金年代/周杰伦 - 范特西 (Fantasy 2001 24bit-96kHz FLAC Hi-Res).flac",
            },
            {
                "file_115_id": "fid_4002",
                "parent_115_id": "cid_3001",
                "name": "王菲 - 寓言 (Fable 2000 SACD-DSD DFF 无损抓轨).flac",
                "extension": "flac",
                "size": 1240000000,
                "is_dir": False,
                "sha1": "a234567890abcdef1234567890abcdef12345678",
                "full_path": "/华语流行黄金年代/王菲 - 寓言 (Fable 2000 SACD-DSD DFF 无损抓轨).flac",
            },
            {
                "file_115_id": "cid_3002",
                "parent_115_id": "0",
                "name": "欧美发烧名盘与交响乐",
                "extension": "",
                "size": 0,
                "is_dir": True,
                "sha1": "",
                "full_path": "/欧美发烧名盘与交响乐",
            },
            {
                "file_115_id": "fid_4003",
                "parent_115_id": "cid_3002",
                "name": "Eagles - Hotel California (2013 Remaster Hi-Res 192kHz-24bit).flac",
                "extension": "flac",
                "size": 312000000,
                "is_dir": False,
                "sha1": "b34567890abcdef1234567890abcdef123456789",
                "full_path": "/欧美发烧名盘与交响乐/Eagles - Hotel California (2013 Remaster Hi-Res 192kHz-24bit).flac",
            },
        ],
    },
]


async def seed_initial_demo_data(force: bool = False) -> Dict[str, Any]:
    """
    如果数据库为空，或当用户显式点击「一键载入示例数据」时，
    自动初始化写入 3 套真实级 115 结构化分享与文件树数据，
    避免新部署的 Docker / PostgreSQL 实例启动后任务列表、搜索和目录树为空。
    """
    now = datetime.now(timezone.utc)
    seeded_shares = 0
    seeded_files = 0

    async with AsyncSessionLocal() as db:
        share_count = (await db.execute(select(func.count(Share.id)))).scalar() or 0
        if share_count > 0 and not force:
            logger.info(f"[DB-Seed] Database already contains {share_count} shares. Skipping auto-seed.")
            return {
                "success": True,
                "message": f"数据库已存在 {share_count} 条分享，无需重复初始化",
                "shares_seeded": 0,
                "files_seeded": 0,
            }

        logger.info(f"[DB-Seed] Seeding {len(DEMO_SHARES)} initial demo shares and file trees...")

        for s_data in DEMO_SHARES:
            code = s_data["share_code"]
            # Check if share already exists
            existing_stmt = select(Share).where(Share.share_code == code)
            existing_share = (await db.execute(existing_stmt)).scalar_one_or_none()

            if not existing_share:
                new_share = Share(
                    share_code=code,
                    receive_code=s_data["receive_code"],
                    title=s_data["title"],
                    file_count=len([f for f in s_data["files"] if not f["is_dir"]]),
                    folder_count=len([f for f in s_data["files"] if f["is_dir"]]),
                    total_size=sum(f["size"] for f in s_data["files"]),
                    status=s_data["status"],
                    last_crawled_at=now,
                    created_at=now,
                )
                db.add(new_share)
                await db.flush()
                share_id = new_share.id
                seeded_shares += 1
            else:
                share_id = existing_share.id

            # Insert Files
            for f in s_data["files"]:
                file_stmt = select(File).where(File.share_id == share_id, File.file_115_id == f["file_115_id"])
                existing_file = (await db.execute(file_stmt)).scalar_one_or_none()
                if not existing_file:
                    file_obj = File(
                        share_id=share_id,
                        file_115_id=f["file_115_id"],
                        parent_115_id=f["parent_115_id"],
                        name=f["name"],
                        extension=f["extension"],
                        size=f["size"],
                        is_dir=f["is_dir"],
                        sha1=f["sha1"],
                        full_path=f["full_path"],
                    )
                    db.add(file_obj)
                    seeded_files += 1

        await db.commit()
        logger.info(f"[DB-Seed] Successfully seeded {seeded_shares} shares and {seeded_files} files.")

    return {
        "success": True,
        "message": f"成功初始化 {seeded_shares} 条分享与 {seeded_files} 个文件节点！",
        "shares_seeded": seeded_shares,
        "files_seeded": seeded_files,
    }
