# 进度（全局唯一进度文件）

## 卡 01 · 退役 Python 版，单产品入口（2026-11-21）

- **交付**：根 README 改为仅 `sites/` 一个开发入口（命令以 `sites/` 为工作目录）；根 AGENTS.md 第 2 条依赖约束、sites/README.md「黄金实现位置」两处与退役决定冲突的表述已修正；根级 Python 版已归档后移除（`app/`、`tests/`、`web/`、`run.py`、`requirements.txt`、`config.example.toml`、`models.example.toml`、`workspace/`）。
- **可恢复归档**（项目外、未压缩目录 + 逐文件清单）：`C:\Users\Administrator\AgentFlow-retire\20261121-161913`，内含 `manifest.csv`（相对路径 / 大小 / SHA-256，58 文件、517082 字节，MANIFEST_SHA256=`5771B4A9636616761928F0A5B8750A638C1034809C72D2793CA15C3E7ADA0888`）；移除前 58 文件逐一对源复核通过，读回 `app/pipeline.py`（289 行）与 `workspace/runs/r_20261119-012804-893.json` 成功，另用 sha256sum 跨工具抽查 2 对一致。
- **实测**：`sites/` 下 `node --version` = v24.15.0（满足 engines >=22.18）；`npm test` 清理前后均 37/37 pass、fail 0、exit 0（audit 11 / cards 14 / grounding 12）；绑定文件 `sites/.AgentFlow.qoder.site` SHA-256 前后一致 = `7079395f28179ca28628bf420986306bca8e11647d58e98ed1985d87dc59af8d`；research-brief 绑定未动 = `c11728141d6d125a431901837e1670ba8a474b54e2c10e28670a0c73bb941145`。
- **判定保留**：`research-brief/`（独立已发布站点快照，带线上发布 ID，用途未明）；`docs/` 8 份全部保留（`schema-v1.md` 是冻结契约参照，其余为设计/历史计划文档，均非运行指南）；未操作线上站点、远端发布、数据库；未动 `.git`、`.workbuddy`。
- **下一卡**：02。**阻塞**：无。**未测**：真实模型验证（本卡不涉及）。

## 卡 02 · v1 数据契约、演示样例与离线校验（2026-11-21）

- **桥接**：根 `agent.md`（单数，与交付包源文件 SHA-256 一致 `b00d871d…`，含产品约定/功能优先/每卡提交/双远端 SHA 核对）；`AGENTS.md` 顶部加「开发前读取同目录 agent.md」指引；`.gitignore` 增加 `*.qoder.site`（绑定内容不入库，本地保留）。
- **交付**：新增 `sites/src/experiment/`（types / claim / runs / evaluate / revision 五个纯函数模块）、`sites/tests/fixtures/experiment-demo.ts`（R01–R04 固定样例，初始恰两行）、`sites/tests/experiment.test.ts`、契约文档 `sites/docs/experiment-v1.md`（v1 冻结）。Git 侧先建 01 基线提交 `73e6322`（216 文件），本卡成果单独提交。
- **实测**：`cd sites && npm test` = **56/56 pass、fail 0、exit 0**（基线 37 例 + 新增 19 例）；覆盖：编码读回、初始两行、跨项目拒绝、runId≠revisionId、主张待澄清（下降/未变/百分数/负增幅）、unknown 绝不同值、整数百分点、两档逐档评估（回填后 +0.50/+0.20 < 2 → 增幅 fail、方向 pass）、waiting_for_run 补跑建议。基线 37 例保持全绿（旧回归未破坏）。
- **剩余项**：真实模型验证未测（本卡不涉及）；数据库与页面未做（04+ 范围）；`createNextRevision` 的持久化调用方待后续卡。**下一卡**：03。

## 卡 03 · 实验导入与配置差异（2026-11-21）

- **交付**：新增 `sites/src/experiment/import.ts`（parseTable / mapHeaders / buildRuns / previewImport / diffRunConfigs / observeAccuracyDelta 纯函数链，无 I/O、确认前不写库）；`runs.ts` 导出 `cellAt`（纯新增）；`sites/tests/import.test.ts` 20 例。未建上传页面（04+ 范围）。
- **行为要点**：BOM、CRLF/LF、尾部空行、CSV 引号/引号内分隔符/`""` 转义；首行含制表符识别 TSV（Excel 粘贴）；中英文别名自动映射，同语义双列 → needs_mapping（不静默取第一列），审核映射走 overrides 纯函数参数；未知列保留 unmapped，确认角色（config→extras 参与匹配 / metadata→note / ignored）后才核验；accuracy 默认百分数列（80%/80/80.00=80，不猜 0.8），ratio 模式显式换算（0.8→80、0.818→81.8，80 越界拒绝）；空/NaN/Infinity/越界/超两位小数按行、列报错；缺必要配置 → 不完整记录（unknown，不进严格配对）；同项目同 runId 同内容去重、异内容冲突且 blocking 整批、不覆盖旧实验；跨项目 R01 互不影响；配置差异只比规范配置（含未知项），准确率与运行名除外。
- **实测**：`cd sites && npm test` = **76/76 pass、fail 0、exit 0**（37 旧回归 + 19 卡 02 + 20 本卡）；验收点实跑：R01→R02 差异恰为 `augmentation off→on`、`lr 0.001→0.01` 两项，观测差 `+2.00 个百分点`（R02=82 vs R01=80）；样例链、带逗号备注、BOM、科学计数 `1e-2===0.01`、比例单位、同名列、重复/冲突、缺值、乱序列用例全过。
- **剩余项**：真实导入（真实 CSV 来源）与持久化未测（04+）；`npx tsc` 类型检查未跑（仓库无 tsc 依赖，遵守依赖冻结）；浏览器端未涉及。**下一卡**：04。

## 卡 04 · 匹配有效对照并生成补跑单（2026-11-21）

- **交付**：新增 `sites/src/experiment/evidence.ts`（`buildEvidencePackage`：ClaimSpec + 项目内 TrainingRun[] → 结构化证据包，确定性、乱序不改配对、仅用同项目记录）与 `sites/tests/evidence.test.ts`（15 例，逐项打印 A–F 实际输出）。
- **A–F 实测**（`cd sites && node --test tests/evidence.test.ts`，15/15 pass、exit 0）：
  - A（仅 R01/R02，目标 0.01）：`waiting_for_run`，增强贡献 `null`，仅建议补 `0.01/off`（复制 R02、仅改 augmentation、完成后与 R02 比较）；原始观测 `R02-R01 +2.00`、配置差恰为 `lr+augmentation`。
  - B（+R03）：配对 `R02-R03 提高 +0.20`，贡献 `+0.20`，`counterexample.exists=true refutingLrs=[0.01]`，覆盖 complete。
  - C（初始两行、两档）：缺 `0.001/on` 与 `0.01/off` 两格，两张补跑单（copy R01 / copy R02），无反例、覆盖不齐。
  - D（四行齐全）：`0.001 → R04-R01 +0.50`、`0.01 → R02-R03 +0.20`，两档均未达 +2 → 全称主张被反驳（反例与覆盖分列）。
  - E（R03 seed=8 / optimizer=sgd）：均不配对，该格退回缺测并重新出补跑单。
  - F（同条件旧记录）：复用 `R02-R03`、贡献 `+0.20`、零补跑单；范围外空格（lr 0.05）不入证据包。
- **附加实测**：效果 0（`0.00/未变`）与负数（`-1.00/下降`）均成反例；仅方向主张未变即反例；未知 seed → `needs_input`+`missingConfigs`、不发补跑单；乱序 deepEqual 一致；跨项目同 ID 不参与配对；重复候选列 `[R03,R05]` 且不选 99 分那条；cellId 含项目/因素/指标/学习率/开关、证据编号稳定不重复；建议与结论文字扫描无「显著/估算/估计/p 值/普遍/已证明」。
- **实测合计**：`cd sites && npm test` = **91/91 pass、fail 0、exit 0**（37 旧回归 + 19 卡 02 + 20 卡 03 + 15 本卡）。
- **剩余项**：真实模型、持久化、浏览器未测（05+）；补跑单提交后的 `requested` 持久化与用户选定重复候选的交互入口待后续卡。**下一卡**：05。

## 卡 05 · 保存研究项目与分析版本（2026-11-21）

- **平台能力复查（实际可用项，非猜测；来源=get_site 实测 + Sites 官方技能参考）**：
  - 本项目实测（get_site include backend/storage/functions）：site `active`、`access_mode=selected`、`auth_integration_status=ready`、host `agentflow-jdu3pw2qe8r.qoder.website`；**backend.status=disabled（capabilities 空）、storage=disabled、functions=[]**；`get_database_schema` 返回「Database is disabled. Enable the backend only when the user's request authorizes it.」→ 托管数据库能力存在但本项目未启用，启用需用户授权（本卡不擅自开通云端资源）。
  - 真实接口名（照抄官方参考，未猜）：数据库 `ensure_backend`（databaseAccessModel=function_backend）→ `get_database_schema`（schemaRef）→ 评审迁移计划；Function 运行时 `QODER_DATABASE` Secret + SDK2 + `Deno.serve` 入口 `index.ts`、路由 `/functions/v1/app/...`；访问身份=网关注入 `x-qoder-user-context` + 服务端 `auth.mjs` 的 `getUser/requireUser`（owner 取自请求身份，不信任浏览器提交），浏览器 `GET /__qoder_auth/me`；存储=部署注入 `_qoder/storage.mjs`（list/upload/download/remove/createSignedUrl…，需 storage 能力）；站主侧 `query_database_rows`/`get_function_logs`。
- **交付**：`src/experiment/storage.ts`（同一 `StorageBackend` 接口 + `MemoryBackend` + `DataService`：项目新建/列表按更新倒序/查询/改名、问题新建/读取/版本列表、导入预览确认、训练记录查询、版本创建与历史读取、幂等请求键、`stale_parent` 冲突、原子事务、作业状态与定稿快照分离、按访问者分区隔离、`ensureDemoProject` 幂等）；`src/experiment/storage-indexeddb.ts`（IndexedDB 适配器，标注「本机保存」，单事务原子读改写）；`evidence.ts` 增 `conclusionsFromPackage`、`import.ts` 增导出 `runContentKey`（纯新增）；`tests/storage.test.ts` 11 例；测试台 `tests/harness/`（`build.mjs` 用 Node 内置 `stripTypeScriptTypes` 剥离 + `app.js` + `harness.html` + `serve.mjs`，产物 `js/` 已入 gitignore；测试台非产品页面，未美化任何产品 UI）。
- **验收流程实测**（`cd sites && node --test tests/storage.test.ts` 11/11 pass、exit 0）：`[05-flow] 新建=1 导入=2 V1=rev_0001 重开=ok 追加=1 V2=rev_0002 读V1=一致 重复请求=created:false → 项目数=1 问题数=1 版本数=2`；V1 保存后逐字节一致、仍显示当时缺对照；V2 同 projectId/questionId、父版本 V1。
- **持久化适配器真实刷新（浏览器实测，非内存）**：`node tests/harness/build.mjs` → `node tests/harness/serve.mjs` → in-app 浏览器三轮真实页面加载（两轮 `location.reload()` + 一轮手动 reload）均读回 `{"adapter":"本机保存","projects":1,"questions":1,"revisions":2,"versionIds":["rev_0001","rev_0002"],"v1Parent":null,"v1SnapshotRuns":2,"v1StillShowsMissing":true,"ok":true}`。内存适配器仅用于离线语义测试，**不作为刷新保存证明**。
- **隔离与一致性实测**：两个访问者互不可见/不可改（存储分区执行，非前端筛选）；两项目同 runId 不串；同内容去重、异内容整批拒绝不落半行、旧实验不被覆盖；过期父版本 → `ConflictError(stale_parent)` 且无半个版本；事务回调抛错状态不变；runId 冒充 revisionId 被拒；作业状态变化与追加数据都不改写 V1 快照，`getModelInput` 返回克隆；同名项目靠 ID 区分、列表项恰五字段（projectId/name/questionCount/pendingCount/updatedAt）；demo 项目重复创建不复制。
- **云端与本机行为区别**：IndexedDB=「本机保存」，仅当前浏览器设备可见，**不写成跨设备同步**；访客数据留在本机分区，不进匿名公共表。托管适配器**未验证**，缺三件：ensure_backend 用户授权、functions/app 路由部署、schemaRef 评审迁移；接入后隔离必须在服务层按 `x-qoder-user-context` 的 `user_id` 分区执行。
- **实测合计**：`cd sites && npm test` = **102/102 pass、fail 0、exit 0**（37+19+20+15+11）。
- **剩余项**：托管数据库/Function 真实接入未验证（需授权与部署，06+）；浏览器实测在 in-app 浏览器完成，未在公开发布域名复测；`tsc` 类型检查未跑（依赖冻结无 tsc）。**下一卡**：06。
