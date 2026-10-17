# Overleaf Local · ChatGPT/Codex 桌面端本地 LaTeX 编辑器

Overleaf Local（v0.7.0）是非官方、本地优先的 LaTeX 编辑器插件，以插件视图运行在 ChatGPT / Codex 桌面应用中（插件在应用内显示为 Overleaf）。文件树、源码编辑器与 PDF 预览三栏并排，布局接近 Overleaf 网页版；支持本地 LaTeX 代码补全、项目图片与 PDF 预览，并可用你自己的 Overleaf 账号 Git 令牌同步项目（默认自动后台同步，也可切换为手动）。

论文、令牌与编译结果都保存在你自己的电脑上，插件不收集、不上传论文内容。

> **非官方项目**：本项目与 Overleaf 及其所属公司无关。Overleaf 名称与 O 形标志归其所有者，详见文末[免责声明](#免责声明)。

## 目录

- [功能亮点](#功能亮点)
- [安装](#安装)
- [安全与隐私](#安全与隐私)
- [系统要求](#系统要求)
- [从源码构建界面](#从源码构建界面)
- [测试](#测试)
- [源码导览](#源码导览)
- [已知限制](#已知限制)
- [免责声明](#免责声明)

## 功能亮点

### 接近 Overleaf 的三栏工作区

深色菜单、活动栏、文件树与文件大纲、文件标签页、代码工具栏及 PDF 工具栏，按 Overleaf 编辑页组织。文件栏、树/大纲和源码/PDF 之间的分隔条可拖动；窄边栏下可在源码与 PDF 之间切换。文件大纲随编辑更新，点击章节直接跳转到源码对应位置。

### LaTeX 代码补全（本地运行）

- 输入反斜杠自动弹出命令建议，Ctrl+Space 手动触发。
- Tab 或 Enter 接受建议；Tab / Shift+Tab 切换片段参数，Esc 关闭建议。
- 环境补全自动插入配对的 begin/end。例如输入 \begin{ali} 补全为 align 环境，输入 \fra 补全为 \frac{…}{…}。
- 建议来源覆盖项目内标签、BibTeX 引用键、自定义命令、宏包、文档类型与文件路径。
- 补全完全在本地运行，不调用在线模型。定义索引最多读取 250 个源文件、合计 4 MB；超出范围时仍可补全当前文件。

### 编译与 PDF 预览

- 修改约 0.9 秒后自动保存到本地，或按 ⌘S；支持自动编译或按 ⌘Enter 编译。
- 编译优先使用已安装的 LaTeX 插件；未安装时可直接调用本机 Tectonic，在独立副本中生成 PDF。
- PDF 连续滚动、按需载入页面，支持翻页与缩放；右侧论文 PDF 与源码并排保留。
- 导出 PDF 保存到本机 Downloads/Overleaf Local，文件名包含时间与随机后缀，避免覆盖同名文件。

### 项目图片与 PDF 预览（0.6.0 新增）

点击文件树中的 PNG、JPEG、GIF、WebP、BMP、PDF 或 PDF 兼容的 Illustrator (.ai) 文件，即可在文件标签页打开只读预览：PDF 支持翻页，图片支持缩放与适合窗口，右侧论文 PDF 不受影响。打开预览前先保存源码，点击 .tex 标签即可返回编辑。预览使用独立缓存，不修改原文件。

- 图片预览上限 12 MB，PDF/AI 为 32 MB；按内容指纹缓存页面，翻页请求限制为两个并行渲染。
- 未内嵌兼容 PDF 的旧版 .ai 文件会显示说明：请在 Illustrator 中以“创建 PDF 兼容文件”重新保存，或导出 PNG/PDF。
- 不在浏览器中执行 SVG，也不调用 Illustrator 编辑文件。

### 本地项目与 Overleaf 同步

- 打开已有文件夹：直接编辑所选目录，不复制文件、不初始化 Git、不更改原有 Git 远端；多个主文件时明确选择。
- 新建项目：填写名称、中文/英文模板与保存位置，生成 main.tex 后立即进入编辑器；目标目录已存在时拒绝覆盖。本地项目不要求登录、无需 Git、不自动上传；新建的不是 Overleaf 云端项目。
- 已导入的 Overleaf 项目默认自动后台同步：保存后默认等待约 3 秒即推送，等待时长可在设置中调整为 1–60 秒；失败约 30 秒后重试。同步先获取远端更新，再合并、提交，不强制推送；冲突时保留双方内容等待你选择。插件关闭后本地文件保留，下次打开继续同步。
- 同步模式可在"编辑器设置"中切换：自动同步（默认）保存后自动推送；手动同步则只在点击顶栏同步按钮（立即同步）时推送。顶栏同步按钮在两种模式下都可随时手动触发一次同步。
- 不同文件与项目的撤销记录隔离；保存携带内容版本，拒绝覆盖另一窗口的新修改。

### 性能

打开项目时先载入主文件，再后台建立补全索引；编译开始时更快查询状态，较长编译逐步降低查询频率；普通正文输入不触发全篇定义扫描，同一文档版本的建议复用已建立的定义。

## 安装

| 方式 | 适用人群 | 概述 |
| --- | --- | --- |
| Release ZIP 手动上传 | 普通用户（推荐） | 从 GitHub Release 下载 overleaf-0.7.0.zip，在桌面应用插件页上传安装 |
| 源码安装 | 开发者 | git clone 本仓库后运行 node scripts/install-local.cjs |

完整步骤（含 --dry-run、--codex 参数说明与首次使用引导）见 [INSTALL.md](INSTALL.md)。

## 安全与隐私

- 本地优先：论文源文件、编译结果与缓存全部保存在本机；插件不收集、不上传论文内容。
- Git 令牌只保存在本机系统安全存储：macOS Keychain、Windows 当前用户 DPAPI、Linux Secret Service；不使用明文令牌文件。
- 同步设置（自动/手动模式与防抖秒数）保存在 ~/.config/overleaf-mcp/settings.json，仅含使用偏好，不含任何凭据或论文内容。
- 安装包（Release ZIP）只包含代码、界面与文档，不含任何账号、令牌、论文、项目登记或缓存。
- 纯本地项目无需登录；只有导入 Overleaf 项目时才需要连接你自己的账号。

数据保存位置：

| 数据 | 位置 |
| --- | --- |
| 账号元数据 | ~/.config/overleaf-mcp/accounts.json |
| 远端项目登记（兼容旧 Overleaf MCP） | ~/.config/overleaf-mcp/projects.manifest.json |
| 本地项目登记 | ~/.config/overleaf-mcp/local-projects.json |
| Git 令牌 | 系统安全存储（Keychain / DPAPI / Secret Service） |
| 导入的远端工作副本 | ~/Documents/Overleaf Local/项目ID/ |
| 既有本地项目 | 用户自选目录 |

环境变量 OVERLEAF_PROJECTS_MANIFEST、OVERLEAF_WORKSPACE_ROOT、OVERLEAF_EDITOR_STATE、OVERLEAF_PANEL_CACHE 可覆盖对应路径。

## 系统要求

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| 桌面宿主 | ChatGPT / Codex 桌面应用 | 需支持本地 stdio MCP 插件与 MCP App 视图 |
| Node.js | 20 或更新版本 | 运行插件服务与安装脚本 |
| LaTeX 编译 | LaTeX 插件或 Tectonic（二选一） | 两者都没有时无法编译，但仍可编辑源码 |
| PDF 页面预览 | Poppler | 需要其中的 pdfinfo 与 pdftoppm |
| Overleaf 同步 | Git | 纯本地项目不依赖 Git |

## 从源码构建界面

界面源码位于 ui-src/，构建产物为 assets/editor.bundle.js（esbuild 打包，已随仓库附带）：

```bash
cd ui-src
npm ci
npm run build
```

服务器运行本身无需 npm 依赖；只有在修改界面并需要重新打包时才执行上述命令。

## 测试

```bash
node tests/registry.test.cjs
node tests/workspace.test.cjs
node tests/completion.test.mjs
node tests/settings.test.cjs
node tests/scheduling.test.cjs
node tests/cache-cleanup.test.cjs
node tests/performance-index.test.cjs
node tests/performance-preview.test.cjs
node tests/resource-preview.test.cjs    # 需要 Poppler
node tests/compiler-fallback.test.cjs   # 需要 Tectonic 与 Poppler
```

除最后两项外，其余测试自带模拟，不依赖外部命令。compiler-fallback 会真实调用 Tectonic 编译并渲染页面；resource-preview 需要可用的 pdfinfo 与 pdftoppm。

## 源码导览

- server/registry.js：独立账号、项目登记、本地目录识别和新建模板。
- server/credentials.js：系统凭据库；server/credential-helper.cjs：Git 认证桥。
- server/workspace.js：本地文件、原子保存和后台同步。
- server/resource-preview.js：项目图片、PDF 与 PDF 兼容 AI 的只读预览及缓存。
- ui-src/resource-viewer.mjs：资源标签页、翻页与缩放。
- server/latex-index.js：本地标签与引用键索引。
- ui-src/completion.mjs：LaTeX 建议与片段；ui-src/outline.mjs：文件大纲。
- server/preview.js：从本地快照编译和渲染。
- server/server.js：MCP 工具、桌面目录选择协议及视图入口。
- ui-src/：可编辑界面源码；assets/editor.bundle.js：已打包的离线界面。

## 已知限制

- 平台：macOS 已实机验证；Windows（DPAPI）与 Linux（Secret Service）凭据实现有单元测试，但未在对应系统实机验证，跨机器完整安装需自行确认。
- PDF 按页渲染为图像：支持连续滚动、翻页和缩放，不支持选择 PDF 文字与内部引用跳转；字体和排版可能与 Overleaf 在线环境不同。
- 未实现 Visual 富文本模式、多人协同评论和 Overleaf 云端历史界面。
- Overleaf 连接验证的是令牌对你指定项目的访问权限，不自动枚举云端全部项目；浏览器登录密码不能代替 Git 令牌，所选项目需开通 Git 集成。
- 目录选择取决于宿主能力；不支持原生选择器时可粘贴本地绝对路径。

## 免责声明

本项目是非官方的个人集成项目，与 Overleaf、Digital Science 或其他相关公司没有隶属、合作或授权关系。Overleaf 名称与 O 形标志归其所有者所有；图标来源与使用方式，以及 CodeMirror 等第三方组件的许可信息，均见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目按“现状”提供，不附带任何明示或默示的保证。使用本插件（包括同步到 Overleaf 的操作）产生的任何后果由使用者自行承担。
