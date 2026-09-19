# 执行器输入

`LAB_DATA_DIR`默认`data/`。所有来源文件必须实际存在。监测器写入`latest-snapshot.json`和版本快照；它不会自动创建已通过的正式实验。

- `latest-snapshot.json`：`{"directory":"snapshots/<抓取时间>"}`，指向对应版本目录（相对LAB_DATA_DIR）。目录包含`alpha-champions-catalog.json`、`alpha-items-catalog.json`，必须与目标版本核验一致。
- `候选阵容.json`：结构见历史示例。每个候选有`id`、`population`、`roles`、`configurations`和明确的机制设置。角色名是`mainCarry/mainTank/secondaryCarry`。每个配置有唯一id与完整lineup；单位包含apiName/stars/position/items及已核验的机制字段。
- `执行清单.json`：`version`、`set`、`gates`、`historicalOpponents`、`matchups`。三项必要门槛为`historicalFullBoardsVerified`、`engineFullNumericParityVerified`、`pilotMechanicsVerified`；必须有相应来源/校验依据，不能为运行而直接置true。
- `historicalOpponents`恰好十项，每项结构同候选，并有`sourceVerified:true`和`source:{url,snapshotFile,version}`。旧版来源文件在LAB_DATA_DIR内；旧版必须不同于当前数值版本。全部配置均须审计。
- `研究状态.json`：至少包括`activeRun:{}`、`calibrationTrials:[]`、`completedTrials:{}`、`completedMatchups:[]`。可有`retryNotBefore`。

先准备输入并用`--pilot`验证，再经证据复核解除正式门槛。`--compile`生成并冻结笛卡尔积与哈希；`--run`每组10场、逐场保存原始响应和审计。改变输入时必须新建实验标识，不能覆盖旧trial继续计数。

`--analyze`仅分析校验局；`scripts/summarize.cjs`分析正式`battles/`目录，输出reports/battles.md/json和兼容多场查看器的gzip批次。目录中的所有回放须使用同一引擎版本。

执行器保守支持已验证的S18首领标记、永久AP/HP、野性祝福等。本接口不是官方稳定API；黑荆棘、骑乘、形态、翡翠伙伴等复杂机制必须补齐已验证请求字段和响应检查后再测。新赛季必须重新核验适配器，不得只改set/version。
