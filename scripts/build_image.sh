#!/usr/bin/env bash
set -e

# ==============================================================================
# 115 Share Searcher - Docker Image Build & Push Helper
# ==============================================================================

IMAGE_NAME="${1:-ghcr.io/minyoad/115share-searcher}"
TAG="${2:-latest}"
FULL_IMAGE="${IMAGE_NAME}:${TAG}"

echo "========================================================"
echo "🔨 准备构建 Docker 镜像: ${FULL_IMAGE}"
echo "========================================================"

# 检查当前目录是否存在 Dockerfile
if [ ! -f "Dockerfile" ]; then
  echo "❌ 错误: 当前目录下未找到 Dockerfile，请在项目根目录运行此脚本！"
  exit 1
fi

# 检查是否使用 buildx 跨平台构建（兼容 x86_64 与 ARM64/Oracle A1）
if docker buildx version >/dev/null 2>&1; then
  echo "🚀 使用 Docker Buildx 进行构建..."
  docker buildx build --platform linux/amd64,linux/arm64 -t "${FULL_IMAGE}" .
else
  echo "🚀 使用标准 Docker 引擎构建本地架构镜像..."
  docker build -t "${FULL_IMAGE}" .
fi

echo ""
echo "✅ 镜像构建完成: ${FULL_IMAGE}"
echo ""
echo "如需推送到 GHCR，请先登录并执行推送:"
echo "  echo \$CR_PAT | docker login ghcr.io -u minyoad --password-stdin"
echo "  docker push ${FULL_IMAGE}"
echo "========================================================"
