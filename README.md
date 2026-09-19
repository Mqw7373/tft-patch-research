# TFT Patch Research

每个云顶之弈正式数值版本，研究新阵容，并与上一版本 NA 钻石以上出场率前十的完整阵容逐组对战。比较 D(5)、D(10)、D(20)、启动速度与存活，保存可核对的输入和结果。

**这是研究工具，不是已验证的上分推荐器。** 目前有可运行的来源监测、输入审计、串行批量执行、断点续跑和伤害汇总。自动设计新阵容由可选的 Codex GitHub Action 执行，需要自己的 API 密钥。完整历史棋盘或引擎版本无法核验时，正式对战会停止并说明原因。

- [Actions：手动 Run workflow 或查看运行记录](https://github.com/Mqw7373/tft-patch-research/actions/workflows/research.yml)
- [研究规则](docs/protocol.md) · [输入合同](docs/input-contract.md) · [首次研究进展](docs/initial-research.md)
- [AlphaSim 模拟器](https://tftalphasim.com/simulator.html?locale=en) · [MetaTFT 阵容来源](https://www.metatft.com/comps)
- [配套多场分析网页](https://mqw7373.github.io/tft-replay-viewer/) · [分析器源码](https://github.com/Mqw7373/tft-replay-viewer)

## 在 GitHub 上运行

1. Fork 仓库并启用 Actions。打开 **Actions → Manual patch research → Run workflow**，选择分支后启动。研究仅手动执行，不会每天检查；代码提交和 PR 仍会运行独立的代码测试。
2. **监测不需要 OpenAI 密钥**：抓取官方补丁、当前引擎目录、严格 NA Diamond+ 前十及推荐棋格。它只报告来源变化，不把网页改字当作确定的数值更新。
3. 如需自动挖掘，在仓库 **Settings → Secrets and variables → Actions → Secrets** 添加 `OPENAI_API_KEY`。只在 GitHub Secrets 中填写，不提交到代码、Issue或聊天。[Codex Action 官方说明](https://developers.openai.com/codex/github-action/)。
4. 在同一页面的 **Variables** 中把 `ALPHASIM_RUN_ENABLED` 设为 `true`，允许已经通过校验的方案执行模拟。可选 `RESEARCH_MODEL` 指定账号可用的模型；留空使用 Codex Action 默认值。模型 API 使用自己的计费账号，仓库不提供密钥或免费模型额度。
5. 每次运行页面的 **Summary** 显示检查状态；**Artifacts → research-report-…** 下载报告。没有配置密钥时会明确显示“研究未配置”，不会生成虚构战绩。

GitHub 托管 runner 执行这些任务，不依赖你的电脑开机。研究代码也可手动运行。来源、历史配置与断点数据存 Actions 缓存，报告保存90天；缓存可能被清理，重要基线应自行备份。历史来源丢失时停止对照测试，绝不把当日棋盘改名当旧版本。源站可能拒绝云端请求，失败会显示在运行日志中。

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
