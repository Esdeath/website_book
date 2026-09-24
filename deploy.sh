#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
expected='git@github.com:Esdeath/website_book.git'
if [[ "$(git remote get-url origin)" != "$expected" ]]; then
  echo "origin 不是预期仓库 $expected，已停止。" >&2; exit 1
fi
branch="$(git symbolic-ref --short HEAD)"
if [[ "$branch" != main ]]; then
  echo "请在 main 分支部署；当前是 $branch。" >&2; exit 1
fi
if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo '请先解决 Git 冲突。' >&2; exit 1
fi
if ! git diff --cached --quiet; then
  echo '暂存区已有改动，请先提交或取消暂存，再运行 deploy.sh。' >&2; exit 1
fi
# macOS 的系统代理不会自动应用于 Git SSH；沿用已启用的 SOCKS 配置。
# 显式设置 GIT_SSH_COMMAND 或 LABOOK_USE_SYSTEM_PROXY=0 可以覆盖此行为。
if [[ -z "${GIT_SSH_COMMAND:-}" && "${LABOOK_USE_SYSTEM_PROXY:-1}" != 0 ]] && command -v scutil >/dev/null 2>&1; then
  proxy_config="$(scutil --proxy)"
  socks_enabled="$(awk '/SOCKSEnable :/ {print $3}' <<< "$proxy_config")"
  socks_host="$(awk '/SOCKSProxy :/ {print $3}' <<< "$proxy_config")"
  socks_port="$(awk '/SOCKSPort :/ {print $3}' <<< "$proxy_config")"
  if [[ "$socks_enabled" == 1 && "$socks_host" =~ ^[a-zA-Z0-9._-]+$ && "$socks_port" =~ ^[0-9]+$ ]]; then
    export GIT_SSH_COMMAND="ssh -o ConnectTimeout=20 -o ServerAliveInterval=30 -o 'ProxyCommand=nc -X 5 -x $socks_host:$socks_port %h %p'"
    echo "Git 使用已启用的系统 SOCKS 代理：$socks_host:$socks_port"
  fi
fi
npm run build
npm run check
git status --short
git diff --stat
# 明确限定网站源文件和书籍目录，不暂存本地配置或构建产物。
paths=(site scripts .github package.json package-lock.json .node-version .gitignore deploy.sh README.md)
for dir in [0-9][0-9]-*/; do [[ ! -d "$dir" ]] || paths+=("$dir"); done
git add -- "${paths[@]}"
git diff --cached --stat
if ! git diff --cached --quiet; then
  git commit -m "${1:-chore(site): update library}"
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo '仍有未提交的已跟踪改动，已停止变基；请先处理。' >&2; exit 1
fi
git fetch origin
if git show-ref --verify --quiet refs/remotes/origin/main; then
  git rebase origin/main
fi
git push --progress --set-upstream origin main
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git ls-remote origin refs/heads/main | cut -f1)"
[[ "$local_sha" == "$remote_sha" ]] || { echo '远端提交校验失败。' >&2; exit 1; }
echo "GitHub 已同步：$local_sha"
echo 'Cloudflare Pages 连接此仓库后，会自动构建发布。域名：https://book.labook.cn'
