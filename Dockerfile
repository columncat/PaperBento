# syntax=docker/dockerfile:1

# ── 베이스 (glibc) — better-sqlite3 prebuild 사용 가능 ──
FROM node:20-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── 의존성 설치 (better-sqlite3 컴파일 대비 빌드툴 포함) ──
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ── 빌드 (Next standalone) ──
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 하위 경로 배포용. 비우면 뿌리에서 돈다.
# Next 가 이 값을 산출물 곳곳에 미리 심으므로 런타임에는 바꿀 수 없다.
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH
RUN npm run build

# ── 런타임 ──
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/paperbento.db
ENV UPLOAD_DIR=/app/data/uploads
ENV MIGRATIONS_DIR=/app/drizzle

RUN useradd -m -u 1001 nodejs

# standalone 출력물 + 정적 자산 + 마이그레이션 SQL
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# DB / 업로드 영속 디렉터리 (compose 볼륨으로 마운트)
# /config 는 스택의 컨테이너들이 함께 보는 자리다 — 여기서는 읽기만 한다.
RUN mkdir -p /app/data/uploads /config && chown -R nodejs:nodejs /app /config
USER nodejs

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
