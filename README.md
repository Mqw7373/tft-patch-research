# TFT Patch Research

每个云顶之弈正式数值版本，研究新阵容，并与上一版本 NA 钻石以上出场率前十的完整阵容逐组对战。比较 D(5)、D(10)、D(20)、启动速度与存活，保存可核对的输入和结果。

**这是研究工具，不是已验证的上分推荐器。** 目前有可运行的来源监测、输入审计、串行批量执行、断点续跑和伤害汇总。自动设计新阵容可选择已登录的本机 Codex（无需另填 API Key），或者使用 API Key 的 GitHub 云端模式。完整历史棋盘或引擎版本无法核验时，正式对战会停止并说明原因。

- [Actions：手动 Run workflow 或查看运行记录](https://github.com/Mqw7373/tft-patch-research/actions/workflows/research.yml)
- [研究规则](docs/protocol.md) · [输入合同](docs/input-contract.md) · [首次研究进展](docs/initial-research.md)
- [AlphaSim 模拟器](https://tftalphasim.com/simulator.html?locale=en) · [MetaTFT 阵容来源](https://www.metatft.com/comps)
- [配套多场分析网页](https://mqw7373.github.io/tft-replay-viewer/) · [分析器源码](https://github.com/Mqw7373/tft-replay-viewer)

## 使用已登录的 Codex（推荐）

克隆仓库，在自己的电脑安装依赖，打开终端执行：

```sh
npm ci
npx playwright install chromium
npm run codex:check
npm run research:codex
```

启动器自动寻找 Codex、检测登录状态和本项目绑定的研究会话。已登录 ChatGPT 的 Codex 可直接使用，无需为本项目另填 Key；如果 Codex 原本使用 API 登录，则仍沿用该账号的 API 方式。没有登录时提示先运行 `codex login`。

首次运行创建本项目研究会话，之后自动续接。模型读取 Codex 当前的有效默认配置，不写死模型名称；无显式模型配置时由 Codex 选择。不会自动接入其他项目或用户正在使用的任意会话。已占用的会话会报错，不强行抢占。只检测的 `codex:check` 不发起研究，也不消耗一次模型推理。

会话 ID 保存在忽略提交的 `.codex-session.json`；登录凭证由 Codex 自己管理，不读取或上传认证文件。需要新的研究会话可运行 `npm run research:codex -- --new`。研究仅手动启动。`Ctrl+C` 会请求中断，之后可续接；崩溃遗留 `.codex-research.lock` 时须先确认旧进程已退出，再移除锁。

找不到 Codex 时可安装 [Codex CLI](https://developers.openai.com/codex/cli/)，或通过环境变量 `CODEX_BIN` 指定可执行文件。Windows 会检测桌面应用内置程序与 PATH 上的 CLI，优先使用版本较新的程序。启动器使用官方 [App Server](https://developers.openai.com/codex/app-server/) 接口；不会打开可被其他网页调用的本地 HTTP 服务。

模拟开关仍为 `ALPHASIM_RUN_ENABLED=true`；不开启时可设计候选和准备输入，不能声称已经完成真实对战。启动器保持工作区沙箱；遇到超出权限的操作不会静默扩大权限。

## 在 GitHub 上选择执行方式

**Run workflow → backend** 有两种选项：

| 选项 | 运行位置 | 登录/模型 |
|---|---|---|
| `cloud-api` | GitHub 托管机器 | 仓库 API Key，模型由 RESEARCH_MODEL 或 Codex Action 默认配置决定 |
| `local-codex` | 你绑定的自托管 runner（Windows、macOS 或 Linux） | 该机器已经登录的 Codex，使用其默认模型 |

GitHub 托管机器无法检测你电脑上的登录或会话。要从 GitHub 按钮使用本机 Codex，需要在自己的仓库 **Settings → Actions → Runners** 添加自托管 runner，选择自己的操作系统，并加标签 `tft-codex`。先以运行 runner 的同一系统用户安装并登录 Codex、安装 Node.js 22+ 和 Playwright Chromium 及系统依赖。必须是自己信任的机器和仓库；此工作流只允许手动触发，不接受 PR 自动启动。没有在线 runner 时任务会排队，不能把它误认为已连接 Codex。

自托管模式保留同一 checkout 中的本地会话与研究数据，不上传 Codex 认证目录。仓库中的 `RESEARCH_MODEL` 只影响 cloud-api，不覆盖 local-codex 的默认配置。报告可在运行页下载。

### cloud-api 配置

1. Fork 仓库并启用 Actions。打开 **Actions → Manual patch research → Run workflow**，选择分支后启动。研究仅手动执行，不会每天检查；代码提交和 PR 仍会运行独立的代码测试。
2. **监测不需要 OpenAI 密钥**：抓取官方补丁、当前引擎目录、严格 NA Diamond+ 前十及推荐棋格。它只报告来源变化，不把网页改字当作确定的数值更新。
3. 如需自动挖掘，在仓库 **Settings → Secrets and variables → Actions → Secrets** 添加 `OPENAI_API_KEY`。只在 GitHub Secrets 中填写，不提交到代码、Issue或聊天。[Codex Action 官方说明](https://developers.openai.com/codex/github-action/)。
4. 在同一页面的 **Variables** 中把 `ALPHASIM_RUN_ENABLED` 设为 `true`，允许已经通过校验的方案执行模拟。可选 `RESEARCH_MODEL` 指定账号可用的模型；留空使用 Codex Action 默认值。模型 API 使用自己的计费账号，仓库不提供密钥或免费模型额度。
5. 每次运行页面的 **Summary** 显示检查状态；**Artifacts → research-report-…** 下载报告。没有配置密钥时会明确显示“研究未配置”，不会生成虚构战绩。

cloud-api 模式由 GitHub 托管 runner 执行，不依赖你的电脑开机；local-codex 需要绑定的机器在线。cloud-api 的来源、历史配置与断点数据存 Actions 缓存，报告保存90天；缓存可能被清理，重要基线应自行备份。历史来源丢失时停止对照测试，绝不把当日棋盘改名当旧版本。源站可能拒绝云端请求，失败会显示在运行日志中。

## 对战口径

| 项目 | 规则 |
|---|---|
| 装备 | 每队9件普通成装：主坦、主C、副C各3件 |
| 主C和主坦 | 按各自费用：1/2费三星，3费两星与三星分支，4/5费两星 |
| 其他单位 | 默认两星，包括副C |
| 对手 | 上一数值版本 NA Ranked Diamond+ 按出场率排序前十；完整推荐棋盘 |
| 数值 | 双方都使用新的正式版本，热修也视为数值版本 |
| 场数 | 每种候选配置 × 每种对手配置 × 10场；3费分支分别统计 |
| 输出 | 胜/平/负、D5/D10/D20、有效n/N、分位数、启动与存活、原始记录 |

D(t)取不晚于t的最后一个累计伤害采样。短局缺测，不补零、不拿终局伤害替代。模拟结果不是实际排位胜率。

## 本地复现

需要 Node.js 22+。

```sh
npm ci
npx playwright install chromium
npm test
npm run monitor
```

浏览器默认使用 Playwright Chromium；设置 `BROWSER_CHANNEL=msedge` 可使用本机 Edge。`LAB_DATA_DIR` 可指定研究数据目录。

监测后按[输入合同](docs/input-contract.md)建立经过核验的研究输入。`examples/s18-candidates.json` 是历史候选格式示例，不是当前版本推荐。普通监测不会自动将候选门槛设为通过。

```sh
# 仅在数据、来源和机制已核验后执行
npm run compile
# 真实网络请求需要 ALPHASIM_RUN_ENABLED=true
npm run pilot
npm run battle
node scripts/summarize.cjs
```

运行每场前检查额度，每场间隔至少5秒；429立即保存 Retry-After 并停止，之后可续跑。缓存的同一场不会计作新增场次。执行器目前基于S18接口适配，复杂特性和新赛季需要核验/扩展，不能只修改版本标签。

## 开源范围

MIT许可覆盖原创代码、研究说明与虚构示例。没有打包 AlphaSim 引擎、网站脚本、数据库、游戏图像或真实原始回放。本项目独立于 Riot、AlphaSim 与 MetaTFT。访问第三方服务应遵守其条款、额度与访问控制。详见 [第三方说明](THIRD_PARTY_NOTICES.md)。
