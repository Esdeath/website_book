# Labook 书房

网站：<https://book.labook.cn> · 仓库：<https://github.com/Esdeath/website_book>

144 本 HTML 书籍，按原目录划分为 14 个主题。首页支持书名和作者搜索、主题筛选、排序、收藏、最近阅读；书籍保留原有阅读界面，并增加返回书房入口。收藏和最近阅读保存在当前浏览器，不跨设备同步。

## 本地预览

需要 Node.js 22 或更新版本。无第三方运行时依赖。

```sh
npm ci
npm run build
npm run check
npm run preview
```

打开 <http://localhost:4173>。预览服务器仅监听本机地址。

## 更新与发布

把 HTML 书籍放进对应的 `01-…` 到 `14-…` 目录，或修改 `site/` 中的首页文件，然后运行：

```sh
./deploy.sh "feat(library): 新增书籍"
```

也可以直接运行 `./deploy.sh` 使用默认提交说明。脚本会构建、检查书籍与图片引用、暂存明确的网站文件、提交、拉取远端并变基，最后推送到 `origin/main`。Cloudflare Pages 通过 GitHub 集成自动构建发布。脚本不会强制推送；如果暂存区已有改动、分支错误或出现冲突，会停止并给出说明。

首次使用的电脑需要配置 GitHub SSH 访问权限和 Git 用户名、邮箱。

在 macOS 上，脚本会自动使用系统已启用的 SOCKS 代理完成 Git 传输，不修改系统或全局 Git 配置。需要直连时运行 `LABOOK_USE_SYSTEM_PROXY=0 ./deploy.sh`，也可以通过 `GIT_SSH_COMMAND` 自定义 SSH 连接方式。

## Cloudflare Pages 配置

| 项目 | 值 |
| --- | --- |
| Pages 项目 | `labook-book` |
| Pages 地址 | `https://labook-book.pages.dev` |
| GitHub 仓库 | `Esdeath/website_book` |
| 生产分支 | `main` |
| 框架 | None |
| 根目录 | 仓库根目录 |
| 构建命令 | `npm run build && npm run check` |
| 输出目录 | `dist` |
| Node.js | 22（`.node-version`） |
| 自定义域名 | `book.labook.cn` |

已在 Pages 项目中绑定 `book.labook.cn`，阿里云 DNS 对应记录为 `book CNAME labook-book.pages.dev`（TTL 600）。迁移项目时，需先在新 Pages 项目添加自定义域名，再修改 DNS；仅添加 DNS 记录不能完成 Pages 域名绑定。

## 构建与目录

- `01-…/` 至 `14-…/`：原始书籍，构建不修改这些文件。
- `site/`：书房首页、样式、交互、阅读页增强脚本。
- `scripts/build.mjs`：从 HTML 标题提取书名和作者，将内嵌图片去重并提取到独立资源，生成书籍页面、索引、站点地图和无 JavaScript 的书目列表。
- `scripts/check.mjs`：检查所有书籍、图片引用、返回书房入口、文件数量和大小。
- `dist/`：构建产物，不提交 Git。

原始内容约 676 MiB，首次 Git 推送较大。构建将图片拆分并去重，以适配 Cloudflare Pages 单文件 25 MiB、免费版 20,000 文件限制。原始书籍路径决定阅读 URL；重命名或移动书籍会改变该书 URL。

Cloudflare 自动构建与 GitHub Actions 都会执行构建和检查。官方文档：[Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)、[自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)、[发布限制](https://developers.cloudflare.com/pages/platform/limits/)。
