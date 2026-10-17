# 安装与首次使用

Overleaf Local（v0.6.0，应用内显示为 Overleaf）是非官方的本地桌面插件：服务、项目文件与账号配置都保存在你自己的电脑上。仅安装插件不会让 Overleaf 网页版或手机端读取本机文件。

## 前提条件

- ChatGPT / Codex 桌面应用，且支持本地 stdio MCP 插件与 MCP App 视图。
- Node.js 20 或更新版本。
- Overleaf 同步需要 Git；纯本地项目不依赖 Git。
- PDF 编译需要 LaTeX 插件，或本机 Tectonic。
- PDF 页面预览需要 Poppler 中的 pdfinfo 和 pdftoppm。

更多说明见 [README.md](README.md) 的“系统要求”。

## 方式 A：从 GitHub Release 安装（推荐）

1. 打开 <https://github.com/Guns160/overleaf-in-ChatGPT/releases>，下载 v0.6.0 的附件 overleaf-0.6.0.zip。
2. 打开 ChatGPT / Codex 桌面应用的插件页，选择“添加 → 上传插件压缩包”，选择刚下载的 ZIP 文件。
3. 安装完成后刷新插件页，打开 Overleaf 插件。

### 备选：解压后用脚本安装

如果插件页不支持上传 ZIP：

1. 解压 overleaf-0.6.0.zip，得到 overleaf 文件夹。
2. 在终端进入该文件夹，运行：

   ```bash
   node scripts/install-local.cjs
   ```

3. 脚本完成后，刷新插件页并打开 Overleaf。

## 方式 B：从源码安装

```bash
git clone https://github.com/Guns160/overleaf-in-ChatGPT.git
cd overleaf-in-ChatGPT
node scripts/install-local.cjs
```

### 脚本参数

- `--dry-run`：不执行安装，只以 JSON 打印将使用的桌面命令、插件版本与安装位置，可先运行确认；输出中的 `willCopyAccounts: false` 表示不会复制账号数据。
- `--codex <命令或路径>`：脚本默认依次尝试 `codex` 命令和 macOS 桌面应用内置路径；找不到支持插件管理的命令时，用该参数显式指定，例如 `node scripts/install-local.cjs --codex /path/to/codex`。

### 脚本行为

- 在 ~/.agents/overleaf-shared-market 创建一个独立的本地插件市场，并调用桌面应用的插件管理命令安装 overleaf 插件。
- 只复制代码、界面与文档，不复制账号、令牌或论文。
- 目标位置已有旧版本时，先自动备份到 backups/ 目录再更新。

修改了界面源码时，先构建再安装：

```bash
cd ui-src
npm ci
npm run build
```

## 首次使用

### 1. 连接自己的 Overleaf 账号

1. 打开插件的“账号”入口。
2. 在浏览器登录你自己的 Overleaf，打开账户设置中的 Git 令牌页面，生成或复制 Git authentication token。
3. 回到插件，在密码框填写令牌，并填写一个你有权限的 Overleaf 项目链接进行验证。

注意：

- 令牌保存在本机系统安全存储（macOS Keychain、Windows 当前用户 DPAPI 或 Linux Secret Service），不写入项目文件，也不会进入任何安装包。不要把令牌发给任何人或粘贴到聊天窗口。
- 浏览器登录密码不能代替 Git 令牌；所选项目必须开通 Git 集成。
- 这里的“连接”只验证令牌对你填写的项目的访问权限，不会自动列出账号下的所有云端项目。

### 2. 导入 Overleaf 项目

选择 File → 导入 Overleaf，选择账号并填写项目链接和真实项目名称。导入的工作副本保存在 ~/Documents/Overleaf Local/项目ID/，之后默认约 6 秒在后台同步；出现冲突时双方内容都会保留，等待你在本地选择处理方式。插件关闭后本地文件保留，下次打开继续同步。

### 3. 打开或新建本地项目

- 打开本地项目：点击“打开本地项目”，选择文件夹或粘贴绝对路径。插件直接编辑这个文件夹，不复制源文件，也不会把原有 Git 仓库自动改成 Overleaf 仓库；遇到多个主文件时可明确选择。
- 新建项目：点击“新建项目”，填写名称、中文/英文模板和保存位置，生成 main.tex 后立即进入编辑器；目标文件夹已存在时拒绝覆盖。新建的是本地项目，不会自动创建 Overleaf 云端项目。若需要云同步，可先在 Overleaf 上建立或上传项目，再按上一步导入其链接。

## 日常使用提示

- 代码补全：输入 \fra 可补全为 \frac{…}{…}，输入 \begin{ali 可补全为 align 环境；引用标签或文献时，建议来自当前本地项目的 .tex 和 .bib 文件。
- 查看项目图片：在文件树中直接点击图片或 PDF 文件，预览出现在源码区的文件标签页；资源工具栏可翻页、缩放和重新载入，点击 .tex 标签回到源码。
- 布局：入口位于右上角 Layout。窄边栏默认显示源码，可切换为 PDF；左侧文件图标展开文件树。
- 导出：PDF 工具栏的导出按钮将结果保存到本机 Downloads/Overleaf Local 文件夹。

## 快速排障

- 脚本提示“未找到支持本地插件的 Codex 命令”：改用插件页上传 ZIP，或用 --codex 指定命令路径。
- PDF 无法预览：确认 Poppler 已安装，且 pdfinfo、pdftoppm 可在终端直接运行。
- 编译失败：确认已安装 LaTeX 插件，或本机可运行 tectonic。
- 旧版 .ai 文件无法预览：在 Illustrator 中启用“创建 PDF 兼容文件”重新保存，或导出 PNG/PDF。

## 验证范围

本版本在 macOS 上实机验证；Linux Secret Service 和 Windows DPAPI 的调用路径有单元测试，但未在对应系统实机验证。目录选择取决于宿主能力，不支持原生选择器时可粘贴本地路径。跨机器完整安装请在自己的桌面环境确认。
