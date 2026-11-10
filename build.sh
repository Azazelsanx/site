#!/usr/bin/env bash
# 构建：把要上线的文件收进 dist/。Cloudflare Workers Builds 的构建命令填 `bash build.sh`
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist
cp -R index.html 404.html robots.txt styles.css _headers dist/
cp -R articles assets admin dist/

echo "→ dist/ 就绪：$(find dist -type f | wc -l | tr -d ' ') 个文件，$(du -sh dist | cut -f1)"
