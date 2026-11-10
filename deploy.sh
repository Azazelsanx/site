#!/usr/bin/env bash
# 手动部署兜底（主路径：push 到 GitHub → Cloudflare Workers Builds 自动构建）
# 资产直接取仓库根目录，.assetsignore 决定哪些不发。
#
# 用法：
#   CLOUDFLARE_API_TOKEN=xxxx ./deploy.sh
#
# Token 权限：Account → Workers Scripts → Edit
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "缺少 CLOUDFLARE_API_TOKEN"
  echo "Cloudflare Dashboard → My Profile → API Tokens → Create Token"
  echo "模板选「Edit Cloudflare Workers」"
  exit 1
fi

export NODE_OPTIONS=

npx --yes wrangler@latest deploy
