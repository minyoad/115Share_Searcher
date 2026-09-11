# ==============================================================================
# Multi-Stage Dockerfile for 115 Share Search Service
# Stage 1: Build modern React 18 + Tailwind + Lucide frontend
# Stage 2: Python 3.11-slim FastAPI backend + Embedded React SPA
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Frontend Build Environment
# ------------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /build

# Copy dependency specifications and install
COPY package.json bun.lock* ./
RUN npm install

# Copy frontend source code and compile production SPA into /build/dist
COPY . .
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Python 3.11 Production Runtime
# ------------------------------------------------------------------------------
FROM python:3.11-slim

# Prevent Python from writing .pyc files & enable unbuffered logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Copy compiled React frontend assets from Stage 1 into /app/dist
# This guarantees actual Docker deployments look 100% identical to AI Studio preview!
COPY --from=frontend-builder /build/dist /app/dist

# Expose API port
EXPOSE 8000

# Default entrypoint for web API service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

