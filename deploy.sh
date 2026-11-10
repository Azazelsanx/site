#!/usr/bin/env bash
# 手动部署到 Cloudflare Pages（兜底方案；主路径是 Git 集成自动部署）
#
# 用法：
#   CLOUDFLARE_API_TOKEN=xxxx CF_PAGES_PROJECT=site ./deploy.sh
#
# Token 权限：Account → Cloudflare Pages → Edit
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${CF_PAGES_PROJECT:-site}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "缺少 CLOUDFLARE_API_TOKEN"
  echo "Cloudflare Dashboard → My Profile → API Tokens → Create Token"
  echo "模板选「Edit Cloudflare Workers」，或自定义 Account / Cloudflare Pages / Edit"
  exit 1
fi

export NODE_OPTIONS=

echo "→ 部署到 https://$PROJECT.pages.dev"
npx --yes wrangler@latest pages deploy . \
  --project-name="$PROJECT" \
  --branch=main \
  --commit-dirty=true
