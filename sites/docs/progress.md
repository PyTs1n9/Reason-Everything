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

## 卡 06 · 接入模型分析与证据校验（2026-11-21）

- **平台核对（真实动作，未猜）**：`get_context`（参数 `{}`）→ 返回形状含 `runtime.cloudAgents = { apiOrigin: "https://api.qoder.com", apiPathPrefix: "/api/v1/cloud", configured: true }`、`host.mode=desktop`；任务 ID **未提供**（该读取动作不产生任务号）。运行时路径（官方技能确认）= 浏览器 → 同源 Sites Function → QCA，Function 内读平台 Secret `QODER_PAT`。
- **精确缺项（为何本卡不打真实调用）**：① 本项目 `functions: []`、`backend=disabled`（卡 05 实测）→ 路径中段不存在；② 启用 `ensure_backend(qoder)` 会自动创建 Qoder PAT，平台要求对此**单独明确确认**，本卡未包含该确认，故不执行；③ 无 `QODER_PAT`、无已部署 Function 路由、模型服务 Secret 未配置。备选路径（Function 调项目已授权模型服务）同样被 ①③ 阻塞。**真实预览探针：未执行**（无可用服务/配置），provider/model/任务号等字段按约定写「未提供」，mock 输出未记入 live 验收。
- **已确认可用项**：cloudAgents origin（上行实测 configured=true）；官方 bundled 客户端 `createCloudAgentsClient({ origin })`（assets/cloud-agents.mjs，Function 目录用）；Managed API 路径 `/api/v1/cloud/*`；`ensure_backend(qoder)` + `QODER_PAT`（待确认后开通）。
- **交付**：`src/agent/prompts.ts`（两条版本化 system 提示词资源：`parse-v1`/`analysis-v1`，测试可定位）；`src/agent/adapter.ts`（可切换 `ModelAdapter` 契约 + `MockAdapter` 桩 + `withTimeout`，不碰凭据）；`src/agent/facts.ts`（由卡 04 证据包预注册事实编号：cellId/pairId/suggestionId + 条件/运行/数值/贡献，`RULES_VERSION=evidence-v1`）；`src/agent/validate.ts`（服务端校验）；`src/agent/service.ts`（提示词装入、超时、解析→手动回退→确认、按 requestId 年等、最多修复重试一次、失败保留规则报告、脱敏调用记录）；`tests/agent.test.ts` 19 例。
- **校验规则（确定性）**：调用一——字段集合恰为 factor/metric/scope/expectedDeltaPp/clarifyingQuestion、只用给定字典、scope 未经学生确认必须 null 且追问、增幅必须与原句百分点一致（拒绝 5≠2）、原句未写增幅必须 null、百分数不清必须追问、多余字段（实验数值）拒绝；调用二——四段 `{text, evidenceIds}` 结构与类型、引用必须存在于预注册事实、正文运行号必须真实（拒 R99）、正文数字必须绑定已注册事实（拒 83.7）、缺测时禁止出现增强贡献数值且 observation 必须引用缺格/未满足条件、有补跑单时 nextAction 必须引用动作事实；修复重试最多一次，仍失败 → `model 分析失败` + `ruleReport`（证据包原样）；自由文本仅视为建议草稿。
- **实测**（`cd sites && node --test tests/agent.test.ts` 19/19 pass、exit 0）：正常、空响应、坏 JSON、超时（timeoutMs=20）、伪造编号（引用+正文双拒）、错误增幅、缺证据、重复回调（`analyzeCalls` 保持 1）、修复成功（2 次调用带 repairFeedback）、修复失败（规则报告保留）全过；记录字段= requestId/kind/promptVersion/rulesVersion/revisionId/jobId/provider/model/result/attempts，序列化后不含访客原句与模型自由文本；提示词真实装入请求（systemPrompt 断言）。
- **实测合计**：`cd sites && npm test` = **121/121 pass、fail 0、exit 0**（37+19+20+15+11+19）。
- **剩余项**：真实模型调用未执行（缺项如上，待 PAT 确认与 Function 部署后用固定演示句做单次探针并记录脱敏任务号）；矩阵数据来源仍是卡 04，前端高亮与图表不在本卡；`tsc` 未跑（依赖冻结）。**下一卡**：07。

## 卡 07 · 串联实验归因工作流（2026-11-21）

- **交付**：新增 `src/workflow/service.ts`（`createWorkflowService`：12 个动作
  `listProjects/createProject/createQuestion/parseClaim/confirmScope/previewImport/commitImport/analyze/getJob/getRevision/listRevisions/appendRunsAndReanalyze`，复用 02–06 现有函数不重复封装）；`docs/workflow-v1.md`（每动作输入/输出/错误/超时/权限表 + 可运行请求样例 + 可选 HTTP 映射说明，本卡未起第二套服务）；`tests/workflow.test.ts` 10 例。
- **存储层纯新增**（`experiment/storage.ts`）：`confirmClaim`（needs_input→已确认，重复确认冲突）、`putAnalysis/getAnalysis`（模型四段产物 + 引用→格子/运行关联，与定稿快照分开）、`appendJobEvent/getJobEvents`（节点事件）、状态字段 `analyses/jobEvents` 入 `StoreState`（`defaultStoreState` 同步）。卡 02 冻结契约（四身份结构）未动。
- **行为要点**：未确认范围 → `gated:true` 停在 needs_input，**零模型调用**；显式 `expectedParentId` 过期 → `stale_parent` 冲突发生在模型调用之前；同 requestId 重复 → 重建结果不再打模型；缺配置 → `modelOutput=pending` 只问缺项不调模型；无模型服务 → `unavailable` 规则照常存档；模型失败 → `failed` 保留规则报告，**再次分析自动沿用原证据快照**，存档事务内复查父版本（迟到旧版本不覆盖新结果）；事件含 jobId/revisionId/node/at/可读摘要；权限全走 actor 分区。
- **验收实测**（`cd sites && node --test tests/workflow.test.ts` 10/10 pass、exit 0）：
  - **A→B 摘要（去敏）**：`questionId=q_0001 | V1=rev_3a853c35… status=waiting_for_run model=ready cells=4 missing=2 | V2=rev_32520121… parent=V1 pairs=1(lr=0.01, delta=+0.20) missing=1 status=waiting_for_run | 变化=补入 R03 后 0.01 档由缺测变为已配对（+0.20），0.001/开 仍缺`。
  - C 历史 R03 直接复用（该格零补跑单）；D「两个学习率下都提高了吗」→ 两档四格全覆盖；E agent=null → 规则可用+`unavailable`+job failed+事件摘要「模型服务不可用」；F 缺 seed 行 → `missingConfigs` 恰 `[R03:seed]`、模型零调用；G 同请求重放（模型调用数不变）+ 旧父版本冲突 + 刷新重试 → 版本数 2 正确；权限：BOB 对 alice 的项目/问题/作业全 NotFound；新服务实例恢复版本与事件；模型失败重试沿用 2 行原证据（V1 失败版本保留不被覆盖）。
- **实测合计**：`cd sites && npm test` = **131/131 pass、fail 0、exit 0**（37+19+20+15+11+19+10）。另修 `agent/validate.ts` 一处边界：增强贡献约束仅在存在缺格时生效（两档齐全的包不再出现无合法文本）。
- **剩余项**：真实模型/HTTP 映射/浏览器 UI 未做（08/09+，PAT 确认仍缺）；`tsc` 未跑（依赖冻结）。**下一卡**：08。
