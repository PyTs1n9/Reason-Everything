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

## 卡 08 · 验证无界面实验核验闭环（2026-11-21）

- **交付**：`package.json` 新增入口——`npm test` → `scripts/run-tests.mjs`（显式发现 `tests/**/*.test.ts` 交给 node --test，打印文件清单；**空测试集一律 exit 1**）、`npm run verify:flow` → `scripts/verify-flow.ts`（正式服务动作驱动的演示验收，隔离项目 p_v1..p_v5、进程内后端，不碰真实研究数据）；`tests/harness/` 升级为工作流级正式适配器验证（build 扩到 agent/workflow 全链，app.js 走 12 动作）。
- **修复的真实缺陷**：原 `node --test` **空测试集退出码为 0**（实测 /tmp/empty-tests → exit 0），违反「空测试集一律失败」；改为包装入口后 0 文件 → exit 1（实测）。
- **①–⑥ 实跑**（`cd sites && npm run verify:flow`，exit 0，6 PASS / 0 FAIL）：
  - ① `矩阵(项目): 0.001/off=R01(80) 0.001/on=— 0.01/off=— 0.01/on=R02(82)`；观测=+2.00（配置差 lr+augmentation）；增强贡献(目标0.01)=**未知**；待补格=1、补跑单=1、引用 runId=[R01,R02]、waiting_for_run。
  - ② 上下文不变=true、V1可重读=true（两行+缺对照结论）、V2目标效应=+0.20、贡献=+0.20、补跑建议=0、版本数=2。
  - ③ 两档待补 2→1→0；差值 0.001=**+0.50**、0.01=**+0.20**；终态 reviewable、四格齐。
  - ④ R03(seed=8) 与 R05(S1:v2) 配对=0、补跑单=1；正确 R03 放 p_v4 → p_v3 配对仍=0、跨项目 R03 不入格。
  - ⑤ 伪造（R99/81.5/缺格测量）→ `modelOutput=failed、job=failed、规则结论保留、analysis=null、摘要="模型分析失败（validation_failed），保留独立规则报告"`；重试 `reusedSnapshot=true、ready、连回原版证据=true`，失败版本保留。
  - ⑥ 重进后 项目=5、q_a版本=2、req-1a 作业=succeeded、事件=8；重复提交后版本=2（幂等）；旧父版本冲突拦截=true 且不产生版本；刷新重试后版本=3；模型调用=11。
  - 汇总：`项目数=5 问题数=4 q_a版本=3 模型调用=11 解析调用=4`，模型模式=mock-verify（离线桩）。
- **⑥ 正式持久化适配器（非内存桩）**：`node tests/harness/build.mjs` → `serve.mjs` → in-app 浏览器三轮真实页面加载（写入→刷新→追加+重复+冲突→刷新→读回→再手动刷新），报告 `{"adapter":"本机保存","projects":1,"questions":1,"revisions":2,"v1Parent":null,"v1SnapshotRuns":2,"v1StillShowsMissing":true,"job":{"id":"req-h1","revisionId":"rev_367cf8f5…"},"events":7,"ok":true}`，两次复核均 ok=true。
- **⑦ 真实最终分析（与 npm test 分离）**：**未测**——`get_site` 实测 `backend.status=disabled、capabilities=[]、functions=[]`，`QODER_PAT` 需用户对平台自动创建 PAT 的**明确确认**（卡 06 起持续缺），本账号当前仅静态发布能力。结论句：**「本地规则通过／真实 AI 或云存储待接通」**。平台最小待办：① 用户明确确认 `ensure_backend(qoder)`（自动创建 QODER_PAT）；② 部署 `functions/app`（`Deno.serve` + `/functions/v1/app`，Function 内读 QODER_PAT 调 `api.qoder.com/api/v1/cloud`）；③ 可选云存储 `ensure_backend` database + schemaRef 评审迁移；④ 接通后用固定演示句做单次真实探针，记录脱敏任务号/结果概要并单独验收。不填假数。
- **验收表**（功能 / 预期 / 实际 / 结论 / 证据）：

| 功能 | 预期 | 实际 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 离线验收入口 | npm test 发现旧+新用例 | 发现 9 文件 131 例全过 | 通过 | `npm test` → `[run-tests] 通过：131 个用例（9 个文件）`，exit 0 |
| 空测试集 | 一律失败 | 0 文件 → exit 1（原生 node --test 空集 exit 0 为缺陷，已修） | 通过 | `node scripts/run-tests.mjs /tmp/empty-tests` → exit 1 |
| ① 初始两行 | 对角线测量、差 2.00、贡献未知、一格待补 | 完全一致 | 通过 | verify:flow `[①] PASS` |
| ② 追加 R03 | 上下文不变、V1 可读、V2=+0.20、不重复建议 | 完全一致 | 通过 | verify:flow `[②] PASS` |
| ③ 两档均有效 | 待补 2→1→0；+0.50/+0.20 | 完全一致 | 通过 | verify:flow `[③] PASS` |
| ④ 配对排除 | 换种子/评测集不配对；跨项目不串 | 配对=0（两种变体+跨项目均 0） | 通过 | verify:flow `[④] PASS` |
| ⑤ 模型伪造 | 失败+规则保留+重试连回原证据 | failed/保留/reusedSnapshot=true | 通过 | verify:flow `[⑤] PASS` |
| ⑥ 重进/重复/重试（内存段） | 计数正确 | 5 项目、2→2→3 版本、事件 8 | 通过 | verify:flow `[⑥] PASS` |
| ⑥ 正式持久化 | IndexedDB 真实刷新，非内存桩 | 三轮真实加载 ok=true | 通过 | harness 报告 JSON（浏览器实测） |
| ⑦ 真实最终分析 | 平台预览跑一次真实分析 | backend=disabled、functions=[]、PAT 待确认 | **未测** | get_site 实测 + 上方最小待办 |
| 真实验证与 npm test 分离 | 分开记录 | npm test / 浏览器段 / get_site 分列 | 通过 | 本表与上文 |

- **是否具备进入 UI（09）条件**：**具备**——02–07 正式动作闭环、离线验收入口、A–G 与 ①–⑥ 场景、正式持久化均已实测通过；**保留缺口**：真实模型（PAT 明确确认 + Function 部署）与可选云存储（backend 授权）未接通，UI 中 AI 区需如实显示未完成状态。
- **实测合计**：`npm test` **131/131 exit 0**；`npm run verify:flow` **exit 0（6 PASS/0 FAIL）**；浏览器段 **ok=true**；`tsc` 未跑（依赖冻结）。
- **下一卡**：09（UI 起步）。

## 卡 09 · 增加项目列表与实验录入（2026-11-22）

- **交付**：唯一 Web 入口 `web/index.html` 重写为研究外框（顶栏 64px、左「研论书屋」右真实保存模式「本机保存」、grid 216px+minmax 侧栏）；新增 `web/assets/study.css`（设计标尺：#F4F6F3/#FFFFFF/#18332D/#465B52/#CCD6D0/#175842、字号 26/18/15/13、焦点 2px、状态文字+形状）、`web/assets/study.js`（四视图：项目列表/项目详情/新问题录入/问题详情，走 07 工作流 + 05 存储动作）；`src/web/model.ts` 纯函数 + `tests/web-model.test.ts` 5 例；`scripts/build-web.mjs`（stripTypeScriptTypes 已验证构建路径 → `web/assets/gen/`，已 gitignore）、`scripts/serve-web.mjs`（可传端口，供同源验收）；`tests/harness/layout-probe.html` 四宽度探针；`storage.ts` 纯新增 `listQuestions`（+1 离线用例）；`package.json` 增 `build:web`。
- **本卡修复的真实缺陷**：① 生成物过期——`listQuestions` 先写后建导致浏览器 `data.listQuestions is not a function`（页面如实报错），重建后恢复；**流程结论：改 src 后必须重跑 build:web**；② 运行下拉只取本次预览新增——同项目第二问题把 R01/R02 去重后 added=0，选项为空；改为「项目已有运行+本次预览」合并；③ 未粘贴数据时下拉从不初始化——表单载入即用已有运行填充。
- **功能验收（in-app 浏览器，源 127.0.0.1:8319 真·空站点）**：空态「还没有研究项目」→ 载入演示项目=1 行（p_demo，幂等离线用例另证 ×3）→ 新建「验收项目」→ 新建研究问题 → 填主张+粘贴 R01/R02 → 映射预览「9 列全识别 / 预览通过：新增 2」→ 基线 R01、目标 R02、范围两档（0.001、0.01）→ 提交 → `#/question/5d6f2f6b-1d9c-4cb0-842d-02c6ae04269b`（URL 与页内问题编号一致），状态 ◆待补跑、版本 1（输入 R01、R02、结论 2 条、○AI 未接通=agent null 真实态）。首页 2 行无重复（验收项目 1 问题/1 待补在前，演示项目在后，按真实更新时间倒序）；搜索「验收」→1 行→清空还原 2；刷新后问题列表仍在；模型解析按钮实测返回 model_unavailable→手动确认；三次缺项提交均落草稿（◇待补充）；**双击提交只产 1 个版本**；同 CSV 二次导入显示「新增 0，重复 2」。
- **布局实测（CSS 像素，iframe 真实渲染尺寸，±2px）**：

| 宽度 | 顶栏 | 侧栏 | 主内容左/右 | 标题顶 y | 横向滚动 | 触控 |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 64 ✓ | x=0..216 ✓ | 248 / 1408 ✓ | 98（96+2，页头行高差，∈±2）✓ | 无 ✓ | — |
| 1024×768 | 64 ✓ | 隐藏、顶栏文字导航按钮 ✓ | 24 / 1000（padding24）✓ | 90 ✓ | 无 ✓ | — |
| 390×844 | 56 ✓ | 隐藏 ✓ | 16 / 374（padding16）✓ | 76 ✓ | 无（390=390）✓ | 44 ✓ |
| 320×700 | 56 ✓ | 隐藏 ✓ | 16 / 304 ✓ | 76 ✓ | 无（320=320）✓ | 44 ✓ |

- **实测合计**：`cd sites && npm test` = **137/137 pass、exit 0**（10 文件，含新 web-model 5 例与 listQuestions 1 例）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）。
- **剩余项**：真实模型（PAT 确认+Function 部署，AI 区如实显示 ○AI 未接通）；云存储（backend 授权，保存模式当前真实为「本机保存」）；问题详情的分析结果展示与补跑交互（10+）；`tsc` 未跑（依赖冻结）。**下一卡**：10。

## 卡 10 · 展示实验矩阵与版本复核（2026-11-22）

- **交付**：问题详情页全套（`web/assets/study.js` 视图 4 重写 + `web/assets/study.css` 卡 10 样式段）：顶栏（返回项目→原主张→当前范围/更改范围/版本选择器/状态徽章）+ 横排真实节点（解析主张/核对配置/查找对照/模型分析，文字区分待运行/运行中/完成/失败，状态来自 job 事件，解析节点如实按主张确认态）；两栏 `grid-template-columns: minmax(0,1fr) 344px` gap 24，1199 以下纵向堆叠（矩阵→当前证据→AI 分析→补跑/回填→版本记录）；语义表矩阵（列头 学习率/增强关/增强开、lr 升序、首列 104/74px、格 80/64px 两行=实测值+runId、实测浅绿实线/建议补跑琥珀虚线/未跑+短横线、空格不显 0%/假值、表上固定条件）；选中格 2px 轮廓、Enter/Space 可选；实测格详情=配置+来源+原始行、待补格=复制运行+固定条件+唯一变更+以后比较，详情在矩阵下「当前证据」；右栏 AI 分析（观察到什么/能否归因/下一步怎么做，每段可点击证据引用→左侧对应格或两条运行高亮+文字说明，观测差/已配对差均标百分点，规则解释与模型草稿分区，建议改写保留学生原句，模型标识保留）+ 下一组实验（目标条件/唯一变更/复制补跑配置/录入实测结果/导入新增记录）；回填抽屉 min(440px,100vw) 右侧进入、标题→字段→确认/取消、实测值必填不默认 81.8、Escape/焦点限制/关闭后焦点回触发钮、演示 R03 显式加载且标◇演示；版本记录在主体下，V1/V2 切换矩阵/文本/证据/建议同步更新。
- **纯函数与服务层**：`src/web/model.ts` 增 `buildQuestionMatrix`/`formatAccuracy`（矩阵模型只读同一份 revision 快照+卡 04 证据包，UI 不做配对/算术）；`src/experiment/storage.ts` 纯新增 `listJobs`/`updateClaim`；`src/workflow/service.ts` 纯新增 `listJobs`/`changeScope`（范围变化→同 questionId 新版本，先校验过期父版本）；`tests/web-model.test.ts` +4、`tests/storage.test.ts` +2、`tests/workflow.test.ts` +1（V1 四格逐格、两档后两处成建议、乱序/空数据、改范围新版本+stale_parent 拦截）。
- **本卡修复的真实缺陷**：① `model.ts` 误从 types.ts 导入 `ProjectSummary`（实存 storage.ts，tsc 不可见的类型错）；② 抽屉监听器在元素挂载前 `getElementById` 取空→打开即崩，改直接引用；③ 重试按钮复用旧 jobId 当 requestId 命中幂等重建、永不重试，改新 requestId；④ 等待状态分析结束才显示，改为发起前立即渲染+异步期间按 job 事件 250ms 刷新步骤行（运行中可见）；⑤ `renderQuestion` 直接重渲染不清 `main` 双矩阵叠放，补 `clear`+渲染序号防并发交错；⑥ 观测差/补跑建议事实无 runIds→点引用不高亮，在 UI 链接层按证据包既有结构补映射（范围外实测格也入链）；⑦ 320px 长 cellId 在 `.error-list`/`.plain-list` 不可断行致横向滚动，补 `overflow-wrap`。
- **功能验收（in-app 浏览器，源 127.0.0.1:8320 真·空站点，Q-A=target_lr、Q-B=target_lr 同项目）**：
  - V1 四格逐格：0.001/关=80.0%R01、0.001/开=未跑—、0.01/关=建议补跑待补、0.01/开=82.0%R02（Q-A/Q-B 双份核对）。
  - 点证据→高亮：点「原始观测差」→R01+R02 两格 linked+证据说明；模型就绪后点 pair 引用→R02+R03 两格高亮+「配对差 lr=0.01…关联运行 R02、R03」。
  - 更改问题范围→两档：新版本两处未跑均变建议补跑，0.001/开 自动选中（高亮另一空格）；切回 V1 缺口原样保留。
  - 回填 R03→产生 V2→切回 V1（Q-B）：抽屉实测值初始空（拒绝空提交「实测准确率必须由你填写，不会默认任何数值」）→显式载入演示 R03（◇演示）→V2 0.01/关=81.8%R03；规则区区分「原始观测差 +2.00 个百分点」与「已配对差 lr=0.01：R02 vs R03，差 +0.20 个百分点」；切回 V1 0.01/关=建议补跑、0.001/开=未跑（缺口保留）。
  - 模型 UI（离线 mock 注入 wfDeps.agent，输出标 mock·mock-model，非真实模型）：40s 慢模型期间步骤行「◐模型分析 · 运行中」+「已重新提交模型作业…」真实等待；超时→「模型分析失败（timeout）」+重试；伪造引用→「validation_failed」+重试；适配器拒绝→「adapter_error」+重试；三种失败下矩阵 4 格照常可用；飞行中切版本→完成时「你查看的版本未变」（新版本仅入历史）；成功草稿=三段+可点引用+建议改写保留原句+模型标识行。
  - 澄清路径：缺项提交落草稿→详情页主操作「回答澄清，确认范围」、无矩阵、四节点全「○待运行」。
  - 长运行名（R99-extra-long-…-abcdefghijklmnopqrstuvwxyz）回填 0.001/开：格内两行换行（行高 40px 自适应）、无横向滚动。
  - 焦点：抽屉初始焦点在首字段、Escape 关闭后焦点回「录入实测结果」按钮、校验失败聚焦错误字段。
- **布局实测（CSS 像素，layout-probe iframe 真实渲染）**：
  - 1440 布局视口（clientWidth=1440）：左栏 x=248..1040（792px）、右栏 x=1064..1408（344px）、gap 24、两栏顶部对齐（y=308）、面板内边距 20px、首列 104px、数据格 323×81（≥80）、四格坐标 0.001/关(374..696, 537..618)、0.001/开(696..1019, 537..618)、0.01/关(374..696, 618..699)、0.01/开(696..1019, 618..699)。
  - 1024/390/320：一律单列、堆叠顺序矩阵→当前证据→AI 分析→补跑/回填→版本记录单调、面板 20/20/16/16px（1024 档 20、手机 16）、首列 104/74/74px、格高 80/64/64px、三档均无横向滚动、节点横排窄屏换行。
- **实测合计**：`cd sites && npm test` = **144/144 pass、exit 0**（10 文件，含本卡 7 例）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）。
- **未测/受限**：真实模型调用未执行（QODER_PAT 明确确认仍缺；无权限/额度不足的具体错误码不可在本机产生，其显示与重试路径已由 adapter_error 同路径覆盖）；浏览器截图未获取（in-app 浏览器无可视表面 NATIVE_BROWSER_VIEWPORT_UNAVAILABLE，验收以 DOM 结构/坐标数据留证）；`tsc` 未跑（依赖冻结）。**下一卡**：11。

## 卡 12 · 记录比赛交付与发布验收（2026-11-22）

- **交付**：根 `README.md` 重写开头——评委 4 步上手（含站点入口与受邀访问实况）、真实命令表（`npm test` / `npm run verify:flow` / `npm run build:web` / `node scripts/serve-web.mjs 8321`）、所需平台能力表（静态托管已启用、本机保存已启用、托管数据库与真实模型未接通及原因）、演示数据声明（仅虚构标注数据）；新增 `sites/docs/release-12.md`（60 秒演示词分段计时+数据来源标注+CSV 附录、Qoder 使用记录、验收五项、真实模型/云存储接入入口）。发布物核查：`sites/web/` 构建无个人笔记/旧 PDF/ledger.db/凭据/原始模型日志（全仓 git ls-files 扫描通过；旧静态资源 app.js 内唯一 token 命中为「0 tokens」UI 文案），favicon/vendor/gen/study.* 与 `.AgentFlow.qoder.site` 平台标识保留；本地仅 `sites/` 一个活跃参赛目录、一套站点入口（research-brief 绑定未动）。
- **本机与站点流程验收（真·空站点 127.0.0.1:8321，新建「演示项目」）**：主张「数据增强使准确率提高了 2 个百分点」→ 只给 R01/R02（80.0/82.0）→ 目标学习率 0.01 → 分析 → **0.01/关=建议补跑**（复制 R02 仅改 augmentation，目标对照缺失）+ 观测差 +2.00 个百分点 + AI 区如实「AI 未接通（模型服务不可用）」+ 规则解释可用 → 录入演示 R03=81.8（◇演示，显式加载）→ V2：0.01/关=81.8%R03、**同条件配对差 +0.20 个百分点**（与观测 +2.00 分列）→ 切回 V1：缺口与补跑建议原样保留。存储=本机保存（IndexedDB），刷新后 2 版本+矩阵数值完整恢复。
- **发布（平台流程，用户批准后执行）**：Sites 草稿打包→就绪（artifactReady/dependenciesReady、无 blockers）→用户确认「批准发布 / 保持仅受邀」→ 发布 → `published=true`（同站更新，地址不变 https://agentflow-jdu3pw2qe8r.qoder.website；仅目标站点，research-brief 站未动、未改名、未公开）。
- **访客实测（发布后真实网址）**：匿名访客见 Qoder 访问门槛页（「登录后即可访问 / 此站点仅向受邀用户开放」）——访问范围按用户决定保持 selected（受邀列表为空）；**访客端核心流程未能匿名走通**，评委需受邀 Qoder 账号。核心流程已在同一构建物本机全流程实测。
- **真实模型与云存储（分开如实）**：真实模型**未接通**（backend=disabled、functions=[]、QODER_PAT 未配置），AI 区显示「AI 未接通」+确定性规则报告，未以 mock 冒充；云存储**未启用**（storage=disabled），保存模式真实为「本机保存」。接入入口：站点设置启用后端（PAT 自动创建需持有者平台确认，密钥不进聊天）→ 部署 functions/app → 可选数据库 schemaRef 迁移。
- **验收五项**：① 站点=已发布 https://agentflow-jdu3pw2qe8r.qoder.website（同构建物本机 8321）；② 核心流程=主张→R01/R02→目标学习率→缺口/补跑单→R03→+0.20→切回 V1（本机实测通过）；③ 真实模型=未接通（如实显示）；④ 存储=本机保存+刷新恢复实测 ok；⑤ 未完成=访客匿名流程（受邀门槛）、真实模型、云存储、截图。
- **实测合计**：`cd sites && npm test` = 144/144 exit 0（卡 10 后复跑）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）；发布核验 published=true；访客门槛页实测。**下一卡**：无（本卡为发布收尾卡）。

## 卡 13 · 项目列表与侧栏导航改版（2026-11-23）

- **交付**：`src/web/model.ts` 纯新增 `PROJECT_TYPES`（六项类型字典）/`normalizeProjectType`（字典外归「其他」）/`parseProjectTypes`（本机类型映射解析，坏 JSON/数组/非字符串值剔除）/`buildSideTree`（项目→问题树节点，保持顺序、空问题项目保留空文件夹）；`web/index.html` 侧栏改为单一容器 `#sideNav`；`web/assets/study.js` 视图 1 重写（内联新建行→居中 Modal：项目名+类型+创建/取消，Escape/遮罩/焦点限制/关闭回焦点；搜索移至页头右侧放大+`Ctrl K` 全局快捷键任意视图跳回聚焦；表格→瀑布流卡片网格：标签/名称/研究问题数/更新时间，`a` 卡片可键盘聚焦）+ `renderSidebar` 重写（📚 根 → 📁 项目折叠树 → 📄 问题文档，`aria-expanded/aria-current`，折叠态内存态、当前项目强制展开，空文件夹「暂无研究问题」）；`web/assets/study.css` 新增卡 13 样式段（页头动作区、Modal 居中、卡片 hover 上浮 -3px+阴影、树缩进、reduced-motion 降级、767/1199 响应式）。**类型标签只存浏览器 localStorage**（`agentflow-project-types`）：Project 存储契约三字段冻结（`assertExactKeys`），不改 schema。
- **本卡修复的真实缺陷**：① Modal 与遮罩为 body 兄弟节点——遮罩是 fixed flex 容器，兄弟不受其居中约束，实测弹窗 x=0 且被 z-index 更高的遮罩盖住（截图证实），改为 `overlay.append(modal)` 嵌套 + 遮罩点击判 `event.target === overlay`（弹窗内点击不误关）；② 旧 `sideProjects` 元素删除后底部监听器会抛空引用，改为 `#sideNav` 事件委托（树内链接点击收起移动端抽屉）。
- **功能验收（in-app 浏览器，源 127.0.0.1:8323）**：空态「还没有研究项目」+右上角放大搜索（Ctrl K 提示 kbd）+「＋ 新建项目」→ 点击弹出**居中 Modal**（项目名输入自动获焦、类型下拉六项、创建/取消），默认无内联表单；创建「增强开关归因/计算机科学」→ 跳项目页，侧栏出现 📚 研论书屋 → 📁 增强开关归因（aria-current）→「暂无研究问题」；再建「学习率对比/数学」→ 列表 2 卡片（标签各异、按更新时间倒序）→ 搜索「增强」过滤为 1 卡、清空还原；**Ctrl K 在项目详情页按下 → 跳回 #/ 且 activeElement=projectSearch**；新建研究问题（主张+R01/R02 CSV+两档范围）→ 问题页，树内出现 📄 文档节点且📁/📄 双高亮 aria-current；树折叠开关 ▾/▸ 切换 `aria-expanded`+children hidden 往返正确；**悬停卡片实测 transform=matrix(…,-3) + 阴影生效**；Escape 关弹窗且焦点回「＋ 新建项目」；点遮罩关闭、点弹窗内不关；无匹配搜索显示「没有匹配的项目」；三卡片标签经 `location.reload()` 后仍为 计算机科学/数学/医学（localStorage 持久化）；创建第三个项目「医学影像对照/医学」端到端成功。
- **布局实测（layout-probe iframe 真实渲染）**：1440×900=顶栏 64/侧栏 block/搜索 360px/网格 4 列；1024×768=侧栏 none/搜索 320/3 列；390×844=顶栏 56/搜索 358/2 列；320×700=搜索 288/1 列；**四档 scrollWidth==clientWidth 均无横向滚动**；320 下 Modal 宽 288（左右 16）、在视口内、无横向滚动。
- **实测合计**：`cd sites && npm test` = **148/148 pass、exit 0**（144 旧 + 本卡 4 例：类型字典归一/映射解析边界/树顺序与空文件夹/空输入）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）；`npm run build:web` = exit 0（改 src 后已重建 gen）。
- **未测/受限**：真实模型与云存储仍缺（卡 08 起状态不变）；浏览器视口实测在 675px 宽 in-app 窗口完成，1440 桌面宽度以 layout-probe iframe 坐标为准；`tsc` 未跑（依赖冻结）。**下一卡**：14（或用户指定）。

## 卡 14 · 工作台面板与项目网格升级（2026-11-23）

- **交付**：`src/web/model.ts` 纯新增 `quickActionMessage`（快捷操作如实提示：PDF 导入/文献抓取未实现，指向现有 CSV/TSV 入口，未知动作抛错，不伪造执行结果）；`web/assets/study.js` 视图 1 改版——「研究项目」标题下新增白色宽幅工作台面板（大搜索框整合入面板 + 快捷操作按钮区：Lucide 图标内联 SVG 的 [导入 PDF][抓取文献] 浅灰次级按钮 + [＋ 新建项目] 墨绿主按钮 + `role=status` 提示行），新增「最近更新」小标题（空库时隐藏，随列表切换）；`web/assets/study.css` 卡 14 样式段（主内容 max-width 1152px 居中、背景 #FAFAF7 极浅暖灰、面板 rounded-xl 12px + shadow-sm、卡片 rounded-xl 12px + hover 上浮 4px/shadow-md/200ms 过渡、标签浅灰底 6px 圆角、标题 700、底部 meta 12px 灰阶、网格 `grid-cols-1 md:2 lg:3` gap 24px、窄屏快捷按钮全宽）。**图标说明**：依赖冻结不引 lucide-react，采用 Lucide（ISC）图标路径手绘内联 SVG（Upload/Globe/Plus），无第三方依赖。**快捷按钮行为如实**：产品当前无 PDF 解析与外网文献抓取能力，点击显示「尚未实现」+ 指向 CSV/TSV 导入入口，不冒充已执行。
- **功能验收（in-app 浏览器，源 127.0.0.1:8324，layout-probe iframe 真实渲染）**：面板圆角 12px、shadow-sm、背景 rgb(250,249,247)；[导入 PDF]→「PDF 导入尚未实现：当前实验记录支持 CSV/TSV…」、[抓取文献]→「抓取文献尚未实现：本版本不联网…」（提示行 role=status）；主按钮 #175842 白字、次级 #F4F6F3 浅灰；建「项目甲/计算机科学」「项目乙/数学」「项目丙/医学」三卡片：标签浅灰底 6px 圆角、名称 700、meta 12px rgb(125,137,132)、圆角 12px、transition 200ms；CSS 规则核对 hover `translateY(-4px)` + 阴影 0 10px 24px；搜索过滤「项目乙」→ 1 卡；Ctrl K → activeElement=projectSearch；空库「最近更新」隐藏 + 空态「还没有研究项目」正常；320px 弹窗 288px 居中、焦点在项目名、无横向滚动。
- **布局实测（CSS 像素，layout-probe iframe）**：

| 宽度 | 主内容 x/宽 | 面板宽 | 网格列 | 横向滚动 |
| --- | --- | --- | --- | --- |
| 1440×900 | 252 / 1152（max-width 居中）✓ | 1088 ✓ | 3（346.7px×3）✓ | 无 ✓ |
| 1024×768 | 0 / 1024 ✓ | 976 ✓ | 3（309.3px）✓ | 无 ✓ |
| 390×844 | 0 / 390 ✓ | 358 ✓ | 1（342.7px）✓ | 无 ✓ |
| 320×700 | 0 / 320 ✓ | 288 ✓ | 1（272.7px）✓ | 无 ✓ |

- **实测合计**：`cd sites && npm test` = **149/149 pass、exit 0**（148 卡 13 + 本卡 1 例：快捷提示文案与未知动作抛错）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）；`npm run build:web` = exit 0。
- **未测/受限**：浏览器可见截图面仍不可用（NATIVE_BROWSER_VIEWPORT_UNAVAILABLE，与卡 10 同），以 DOM/计算样式/坐标数据留证；悬停伪类以 CSS 规则 + computed transition 核对（无可见指针面）；真实模型与云存储状态不变；`tsc` 未跑（依赖冻结）。**下一卡**：15（或用户指定）。

## 卡 15 · 首页工作台动态化与 PDF/文献导入（2026-11-24）

- **用户决策（开工前确认）**：① 卡片操作不含删除项目（`DataService` 无删除动作，跨卡面大，缓做）；② `quickActionMessage` 退役（连同卡 14 的 1 条测试移除）；③ 联网立场翻转——卡 14 记录的「本版本不联网抓取外部文献」改为「Crossref 联网获取文献元数据（不抓取全文）」，测试仍零联网（mock fetch）；④ PDF/文献元数据落 localStorage（同卡 13 类型标签先例），**摘要/全文不持久化入库**，Project 契约三字段冻结未动。
- **交付**：`src/web/model.ts` 纯新增 `computeDashboardStats`（项目数/问题总数/近 7 天更新，坏时间戳不计）/`highlightMatches`（大小写不敏感多段高亮）/`sortProjects`（置顶优先+更新倒序，不改输入）/`typeColorClass`（六类型色板）/`extractPaperTitle`（元数据优先退回首页行，截断 120），移除 `quickActionMessage`；新增 `src/web/literature.ts`（`mapCrossrefWork` 规范化+缺题名抛错、`createLiteratureClient(fetchImpl, {timeoutMs, baseUrl})`：DOI 精确查询+标题检索≤5 条、8s AbortController 超时、HTTP/网络/超时带原始原因抛错，fetch 注入可 mock）；`scripts/build-web.mjs` 登记 literature。`web/assets/study.js` 视图 1 改版——hero 深绿渐变横幅（标题+副题+KPI count-up 行+搜索框）；搜索 `<mark>` 高亮+Esc 清空+内联 SVG 插画空态；卡片改 div+整卡链接（::after 铺满，操作钮 z-index 浮层）：hover/聚焦浮出**置顶**（localStorage `agentflow-pinned-projects`，aria-pressed）与**重命名**（弹窗走 `data.renameProject`，卡片+侧栏同步）、进度条（(questionCount-pendingCount)/questionCount，aria-label 如实标待补跑）、类型多彩标签、stagger 进场（仅首屏/演示载入，搜索重绘不重播）、toast（role=status，3.2s 消失）；「载入演示项目」显示 3 卡 shimmer 骨架+新卡 flash 一次。**导入 PDF 真实化**：复用 vendored pdf.js 6.5（零新增依赖），本地解析（arrayBuffer→getDocument→逐页 getTextContent→sha256）→结果弹窗（文件/页数/字符数/SHA-256/议题名预填元数据/首页文本预览「仅展示不持久化」/复制/以题名新建项目）→创建成功记 `agentflow-paper-imports`（source/pdf/filename/pages/textChars/sha256/title）；非 PDF、无文字层（扫描件需 OCR）、解析异常一律 toast 如实报错；拖放 .pdf 走同一路径（遮罩显隐）。**抓取文献真实化**：弹窗 DOI 精确查询+标题关键词检索→结果卡（题名/作者/年份/出处/DOI）→「用此文献新建项目」预填→溯源记 source/crossref。`web/assets/study.css`：全部硬编码色收进 `:root` 令牌（--bg-app/--danger/--amber/--measured-bg/--tag-bg/--meta-ink/--overlay/--shadow/--hero-* 等），`prefers-color-scheme: dark` 整套暗色覆写+六类型暗色标签，hero/KPI/toast/骨架/卡片操作条/进度条/弹窗（--wide/import-facts/fetch-*/drop-overlay）新样式，reduced-motion 全降级。
- **本卡修复的真实缺陷**：① `.drop-overlay` 的 `display:flex` 覆盖 `[hidden]` UA 样式→拖放遮罩常驻遮全页（截图证实），补 `.drop-overlay[hidden]{display:none}`；② `scripts/serve-web.mjs` MIME 表缺 `.mjs`→pdf.js 动态导入被严格 MIME 检查拒绝（console 实证 octet-stream），补 `text/javascript`；③ 搜索每按键重建 KPI 重放 count-up（快照抓到 0/0/0 中间帧），改数值不变跳过重绘；④ `dragleave` 判 `relatedTarget === null` 过严（合成事件 undefined 时遮罩卡住不消失），改 `!event.relatedTarget`。
- **功能验收（in-app 浏览器，源 127.0.0.1:8326，浏览器 dark 偏好）**：空态→建「项目甲/计算机科学」「学习率对比/数学」（弹窗预选/预填/跳项目页正常）→首页 KPI=2/0/2 count-up；搜索「学习」→1 卡+`<mark>学习</mark>`（DOM 断言）、Esc 清空还原 2 卡、「zzz」→插画空态「没有匹配的项目」；置顶「项目甲」→排首位+aria-pressed=true+toast「已置顶…」+localStorage 持久（刷新后仍首位）；重命名→弹窗预填→「项目甲改」卡片+侧栏同步+toast；KPI 过滤时稳定 2/0/2 不回零；**PDF 导入端到端**（生成 1 页文字层样例 PDF）：本地解析弹窗=文件名/页数 1/字符数 22/SHA-256/议题名「Local Parse Demo Paper」（取自 PDF metadata Title）/首页预览→以题名新建项目（预填）→创建→`agentflow-paper-imports` 记 source/pdf/sha256/title；非 PDF→toast「只支持 PDF 文件」；**文献抓取真实联网**：DOI 10.1038/nature14539→「共 1 条结果」= Deep learning / Yann LeCun、Yoshua Bengio、Geoffrey Hinton · 2015 · Nature / DOI 回显（Crossref CORS 实测通过）→用此文献新建项目（预填「Deep learning」）→溯源记 source/crossref；坏 DOI→「抓取失败：HTTP 404」如实报错；Escape 关弹窗、遮罩居中、拖放遮罩 dragover 显/dragleave/drop 隐；675px 视口 scrollWidth==clientWidth 无横向滚动；骨架屏=3 shimmer 卡+「载入中…」→演示项目卡载入。
- **实测合计**：`cd sites && npm test` = **158/158 pass、exit 0**（149 − 1 退役用例 + 本卡 10 例：统计/高亮/置顶排序/类型配色/PDF 题名 + literature 5 例 mock fetch 全路径）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）；`npm run build:web` = exit 0。
- **未测/受限**：浅色模式未在可见面渲染（in-app 浏览器 dark 偏好，截图面中途转 NATIVE_BROWSER_VIEWPORT_UNAVAILABLE，浅色以 CSS 令牌/规则留证）；hover 操作条 opacity 以 CSS 规则核对（无可见指针面）；真实拖放文件仅合成事件验证遮罩显隐（解析路径与文件按钮同一已验证函数）；扫描件 OCR 提示路径无样本未实测；真实模型与云存储状态不变；`tsc` 未跑（依赖冻结）。**下一卡**：16（或用户指定）。

## 卡 16 · 首页项目删除与改名行修复（2026-11-24）

- **用户决策（开工前确认）**：① 卡 15 缓做的「卡片操作不含删除项目」本卡补上（用户指定），二级确认由本卡自行设计——采用删除确认弹窗（先点卡片删除钮，再在弹窗点「确认删除」，含级联警示与不可恢复提示；取消/Escape/点遮罩可退出，初始焦点在「取消」防误触）；② 第二条「保存/取消没功能」复核后定位为 CSS 显示缺陷而非缺功能，按缺陷修复并补空名可见报错。
- **交付**：`src/experiment/storage.ts` 纯新增 `deleteProject`（项目及其问题/运行/版本/作业/分析/事件/幂等键单事务级联清除，`requireProject` 不存在与跨访问者均 NotFound，四身份契约未动）；`tests/storage.test.ts` +3 例；`web/assets/study.js` 卡片动作区新增删除按钮（Lucide Trash2 手绘内联 SVG，同卡 14 依赖冻结做法）+ 删除确认弹窗（项目名/研究问题数/级联清除与不可恢复警示文案）+ 删除成功后清本机 UI 元数据（置顶/类型标签/导入溯源三处 localStorage）+ toast + 网格与侧栏刷新；项目页改名行空名提交显示可见「请填写项目名」（field-error+role=alert+aria-invalid，不再只给红框）；`web/assets/study.css` 新增 `.toolbar[hidden]{display:none}`、`.btn-danger`/`.card-action--danger`/`.modal-warn` 样式。
- **本卡修复的真实缺陷**：`.toolbar` 的 `display:flex` 覆盖 `[hidden]` UA 样式 → 项目页改名行常驻显示、点「取消」看似无反应（与卡 15 `.drop-overlay` 同因，当时漏修 `.toolbar`；此前被误判为「按钮没加功能」）；空名保存仅红框无文字提示。
- **功能验收（in-app 浏览器，源 127.0.0.1:8327；指针面 NATIVE_BROWSER_VIEWPORT_UNAVAILABLE 同卡 10，以脚本派发真实 DOM 事件驱动）**：卡片动作区=置顶/重命名/删除三钮（hover 浮出以 CSS 规则核对）；删除弹窗标题「删除项目」+警示「将删除项目「X」（研究问题 N 个），并连带清除其下全部研究问题、实验记录与分析版本。此操作不可恢复。」+按钮「确认删除/取消」+初始焦点在取消；取消与 Escape 均关弹窗且卡片仍在；确认删除→卡片消失+toast「已删除「X」」+localStorage 置顶/类型/导入溯源三处同步清空；**级联实测（IndexedDB 正式适配器）**：带 1 草稿问题的项目删除后读回 `partitions/local` 仅剩他项、questions/runs/revisions/jobs/analyses/jobEvents/idempotency 全 0；改名行：初始 `hidden` display=none（修复生效）、点「改名」display=flex、空名保存→可见「请填写项目名」+aria-invalid+行不收起、正确保存→标题更新+行收起 display=none。
- **实测合计**：`cd sites && npm test` = **161/161 pass、fail 0、exit 0**（158 卡 15 + 本卡 3 例：级联清除全链/幂等键随删清除后同请求键可建新版本/不存在与他人项目不可删）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）；`npm run build:web` = exit 0（改 src 后已重建 gen）。
- **未测/受限**：hover 浮出操作条无可见指针面（CSS 规则+脚本直接触发核对，同卡 14/15）；真实模型与云存储状态不变（卡 08 起）；`tsc` 未跑（依赖冻结）。**下一卡**：17（或用户指定）。

## 卡 17 · 返回按钮滚动跟随（2026-11-24）

- **用户决策（开工前确认）**：项目页「← 返回项目列表」与新建研究问题页「← 返回项目」（用户口称“返回列表”）在用户滚动到下方内容时跟随，免去回滚找按钮；实现方式由本卡自选。
- **交付**：`web/assets/study.js` 两页返回链接移出 `page-head` 成 `main` 首个子项（sticky 包含块必须跨全页），类名增 `back-link--follow`；`web/assets/study.css` 新增 `.back-link--follow`（`position:sticky` 吸顶于顶栏下 8px、`z-index:20` 低于顶栏 30 不盖顶栏、`align-self:flex-start`、胶囊底色 `var(--surface)`+1px 边框防下方内容穿透、负外边距抵消 `.content` 间距保持与标题原 6px），≤767px 断点 `top:64px`+`margin-bottom:-10px`；`tests/web-follow.test.ts` 4 例（吸顶=顶栏高+8px 语义断言、z-index 低于顶栏、负 margin 抵消间距=6px、≤767 断点覆写、两页接线为 main 首子项）。纯 CSS 实现、零 JS 滚动监听、零新依赖；问题详情页「← 返回项目」（视图 4）不在本卡指定范围，未动。
- **本卡修复的真实缺陷**：无（纯新增行为）。
- **功能验收（in-app 浏览器，源 127.0.0.1:8330，iframe 真实渲染+真实滚动）**：项目页（p_demo）与新建研究问题页滚动后返回链接精确停在吸顶位（1440/1024→72px=顶栏 64+8，390/320→64px=顶栏 56+8），滚回顶部复位原位（96/88/72）；点击项目页按钮→`#/`、新问题页按钮→`#/project/p_demo` 真实跳转；吸顶时胶囊底色不透明（暗色令牌 rgb(28,38,44) 实测）。
- **布局实测（CSS 像素，iframe 真实渲染；新问题页表单真实滚动 1078/1302px，项目页矮视口 175/159/179/215px）**：

| 宽度 | 静止 linkTop | 吸顶 linkTop | 与标题间距 | 横向滚动 |
| --- | --- | --- | --- | --- |
| 1440 | 96 ✓ | 72 ✓ | 项目页 8（设计 6+页头行居中 2，±2）/新问题页 6 ✓ | 无 ✓ |
| 1024 | 88（padding24 档）✓ | 72 ✓ | — | 无 ✓ |
| 390 | 72 ✓ | 64 ✓ | 6 ✓ | 无 ✓ |
| 320 | 72 ✓ | 64 ✓ | 6 ✓ | 无 ✓ |

- **实测合计**：`cd sites && npm test` = **165/165 pass、fail 0、exit 0**（161 卡 16 + 本卡 4 例）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL）；`npm run build:web` = exit 0。
- **未测/受限**：浅色模式胶囊以 CSS 令牌留证（in-app 浏览器 dark 偏好，同卡 15）；问题详情页返回按钮未改（超出本卡指定范围，可下卡补）；真实模型与云存储状态不变（卡 08 起）；`tsc` 未跑（依赖冻结）。**下一卡**：18（或用户指定）。

## 卡 18 · 顶栏「本机保存」存储信息弹层（2026-11-24）

- **用户决策（开工前确认）**：「保存中/已保存」实时状态不做（须 hook 全部写路径，改动面与测试成本大）；其余由本卡自选——把顶栏「本机保存」从静态标签升级为可点的存储信息弹层。
- **交付**：`src/web/model.ts` 纯新增 `buildSaveModeInfo`（四行如实信息：存储方式「本机保存（IndexedDB）」/数据库名/当前数据量/云端同步「未接入」+ 同步边界说明句；云端状态如实写未接入，不冒充）；`web/index.html` 顶栏 span 改 `button`（`aria-expanded`/`aria-controls`/`role=note` 弹层容器，默认 `hidden`）；`web/assets/study.js` 新增弹层段（点击切换开合、内容异步读 `wf.listProjects` 真实计数、读取失败如实显示「读取失败：…」不吞异常、Escape 关闭且焦点回按钮、点外部关闭（按钮与弹层本体不误关）、`render()` 导航时收起）；`web/assets/study.css` `.save-mode-wrap`/`.save-mode` 胶囊按钮（hover/aria-expanded 变主色）/`.save-mode-pop`（absolute、`right:0`、`width:min(320px, calc(100vw - 32px))` 防越界、`.save-mode-pop[hidden]{display:none}` 显式防 display 覆盖——卡 15/16 同类教训的预防）；`tests/web-savemode.test.ts` 5 例。弹层文案固定四行+说明，**不做「保存中/已保存」写路径状态**（用户明确排除）。
- **本卡修复的真实缺陷**：无（纯新增行为；原标签如实但无任何交互）。
- **功能验收（in-app 浏览器，源 127.0.0.1:8331）**：初始弹层 `hidden`+display=none+aria-expanded=false；点按钮展开四行=「存储方式 本机保存（IndexedDB）/数据库 agentflow-study/当前数据 0 个项目 · 0 个研究问题/云端同步 未接入」+说明「数据只保存在当前浏览器，不跨设备同步…」；**计数随真实数据变化**：载入演示项目后=1 个项目 · 0 个研究问题，`createQuestion` 再开=1 个项目 · 1 个研究问题；Escape 关闭且 `activeElement` 回按钮；再开后点外部关闭、aria-expanded=false；载入数据后弹层 320px 宽右对齐、在视口内；320px 窄视口 iframe 实测弹层 288px（=320-32 约束生效）、left≥0、无横向滚动。
- **实测合计**：`cd sites && npm test` = **170/170 pass、fail 0、exit 0**（165 卡 17 + 本卡 5 例：纯函数两组/HTML 接线/JS 接线/CSS 约束）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL，⑦ 未测单列）；`npm run build:web` = exit 0（改 src 后已重建 gen）。测试断言适配 CRLF 行尾（仓库 checkout 为 CRLF，首跑 1 例因 `\n` 字面量失配，改行尾不敏感后全绿——测试缺陷，非产品缺陷）。
- **未测/受限**：读取失败路径以文案断言覆盖（浏览器未破坏 IndexedDB 模拟失败）；弹层无 tooltip/hover 态（点击交互足够，未扩大面）；真实模型与云存储状态不变（卡 08 起）；`tsc` 未跑（依赖冻结）。**下一卡**：19（或用户指定）。

## 卡 19 · 表单必选表达统一与问题详情可读性（2026-11-24）

- **用户决策（开工前确认）**：①「问题范围」**保持无默认选中**（否决默认值方案），改为必选表达；②「数据输入」与「问题范围」采用同一方案（两组均无默认 + 必选徽标 + 空态提示 + 提交兜底）；③随后按代办清单开工，本卡含 cellId 可读化、未接通/失败状态区分、本地服务根路径重定向（导出/导入备份留下一卡）。
- **交付**：① 表单（`web/assets/study.js`/`study.css`）——数据输入 radio 去默认（移除 `checked`、`entry.dataMode` 初始与 `resetEntry` 均为 `""`、粘贴框初始 `hidden`），两组标题加 `.req-badge`「必选」徽标，radio 下 `.choice-hint` 空态提示（「请选择输入方式（二选一）」/「请选择验证范围（二选一）」，选中即 `hidden`），提交缺项在显示层补「数据输入方式」（`missing.unshift`，`model.ts` 的 `evaluateEntryMissing` 契约与原用例不动）；② 问题详情可读性——`src/web/model.ts` 纯新增 `describeCellId`（六段 cellId→「0.001/增强开」，格式不符原样返回）与 `humanizeCellIds`（句内全量替换），`study.js` 显示层替换六处：问题编号 `shortId`+title 全量、当前缺口列表、规则结论（`cell@` 规则号→「格 …」+ detail）、证据条目 condition/action、补跑建议两处「同档另一格」fallback、证据说明关联格；③ 未接通/失败区分——`STEP_TEXT`/`STEP_GLYPH` 增 `unavailable`（○未接通），新增 `modelStepState` 按工作流事件摘要「模型服务不可用」把模型节点失败改为中性未接通，AI 提示按 `modelOutput` 分样式（unavailable=中性 `notice` +「AI 未接通（模型服务未配置）」，failed 仍 `notice-error`），未接通时重试按钮 `disabled` +「需先在站点接入模型服务」提示，`.step-unavailable` 中性色；④ `scripts/serve-web.mjs` 根路径 302 → `/web/index.html`。
- **本卡修复的真实缺陷**：① `.field{display:flex}` 覆盖 `[hidden]` UA 样式——浏览器截图实证修复前粘贴框与文件选择框**同时常显**（DOM 属性是 hidden 但 computed display=flex，卡 09 起的既有缺陷，历卡 DOM 断言只查属性未查可见性），补 `.field[hidden]{display:none}`（卡 15/16/18 同类教训第四例）；② `humanizeCellIds` 正则未排除中文冒号 `：`，`cell@…：cell…` 处跨界吞段（新用例首跑抓到 `0.01/off：cell`），排除后全过。
- **功能验收（in-app 浏览器 127.0.0.1:8340，dark 偏好）**：根路径 302→`/web/index.html` 样式完整、console 零 404；表单初始四 radio 全未选、双提示可见、粘贴框不可见，选「粘贴」→提示收起+文本框显+文件框隐（互斥），选「两档都验证」→提示收起+lrHost「两档学习率：0.001、0.01」，刷新重置回无默认；仅填主张提交→「还缺：数据输入方式、训练数据（CSV/TSV）、目标运行、基线运行、问题范围」；问题详情（`8f4f9c9a…`）：编号「问题编号 8f4f9c9a-d391-…」（title=完整 UUID）、步骤行「○模型分析 · 未接通」（`step-unavailable` 非红，其余三节点 ●完成）、缺口「0.001/增强开 未测」「0.01/增强关 未测」、AI 提示中性类+「AI 未接通（模型服务未配置）」+重试 disabled+接入提示、结论「[insufficient_data] 格 0.001/增强开：0.001/增强开 未测，缺测值为 null」、全页 `innerText` 无 `cell:p_demo` 裸串、证据条目点击→详情「编号 cell:p_demo:au…（title 全量）· 关联格 0.001/增强开」正常。
- **实测合计**：`cd sites && npm test` = **179/179 pass、fail 0、exit 0**（170 卡 18 + 本卡 9 例 `web-ux.test.ts`：describeCellId/humanize 边界、表单无默认、徽标提示接线、提交兜底+纯函数契约、详情可读化接线、状态区分、CSS hidden、服务 302）；`npm run verify:flow` = exit 0（6 PASS/0 FAIL，⑦ 未测单列）；`npm run build:web` = exit 0（model.ts 改后已重建 gen）。
- **未测/受限**：问题详情截图中途遇 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`（同卡 10/14/15/16），该页以 DOM 断言/computed style 留证（表单页截图已留存）；浅色模式徽标以令牌留证（浏览器 dark 偏好）；failed（超时/校验失败）分支保留原红色路径，由文本断言覆盖、未在浏览器复现失败态；真实模型与云存储状态不变（卡 08 起）；`tsc` 未跑（依赖冻结）。**下一卡**：20（项目导出/导入 JSON 备份，代办清单 P0）。

## 卡 20 · PDF 全文入库与候选研究问题（2026-11-24）

- 逐页保存 PDF 的可提取文字，保留空页位置。项目页可翻页和查阅带页码的原文摘录。旧 PDF 项目可通过文件指纹核对后补录原 PDF。
- 导入确认时默认发起模型生成，可取消勾选。长文逐批发送至同源模型接口，候选须通过原文定位。用户可编辑问句，确认后创建研究问题，原主张、验证方法和出处持续可查。文献记录与实验业务契约分别维护。
- `npm test` 187 项通过，退出码 0。`npm run verify:flow` 6 个离线场景通过，退出码 0。`npm run build:web` 和 `git diff --check` 退出码 0。使用现有 PDF.js 在 Node 中提取了三页合成 PDF，确认第 2 页为空而第 3 页原文可读。本地同源接口实测未配置时返回 HTTP 503，接入本地模拟上游时返回 HTTP 200。
- 浏览器点击和刷新未验证。Computer Use 无法核验当前浏览器地址并中止；真实模型依赖服务端配置，Qoder Sites 路由和发布待验证。OCR、原版面查看及表格结构化留待后续。

## 卡 21 · PDF 扫描识别与原版面定位（2026-11-25）

- **交付**：复用既有 PDF.js 逐页读取物理页序，仅将没有可用文字层的页标记为待识别；新增可替换 OCR 适配层、同源 `/functions/v1/app/paper-ocr` 服务端路由与 Windows WinRT 本机 OCR 脚本，外部服务密钥只从服务端环境读取。原 PDF 字节、逐页文字/来源/失败原因/OCR 区域写入 IndexedDB，扫描件可在 OCR 未配置或未执行时先保存并查看原页。
- **识别状态与重试**：导入默认不勾选 OCR，必须显式确认才发送待识别页；项目页区分文字层、OCR、待识别、失败，支持全部待识别页与单页识别/重试。成功保存文字与区域，失败保存真实错误且不抹掉其他页；候选生成只读取文字层或成功 OCR 页，OCR 后自动生成会重新读取最新入库文本。
- **原版定位**：原页查看器支持前后翻页、缩放、适合宽度；文字层按 PDF.js 仿射变换定位，OCR 按词区域定位，跨行/跨词引文映射多个矩形。重复摘录或缺少坐标时退回页级精度，不伪造高亮；旧文字项目可补传同一 SHA-256 的原 PDF，已有问题、候选与引文关系保留。
- **本卡修复的真实缺陷**：① 浏览器像素核对发现文字层矩形落在基线下方，改为覆盖字体上升区域后，正向页高亮内暗色像素由 2 增至 104，旋转页由 0 增至 181；② 新建导入弹窗把可选自动生成节点直接交给 `append`，出现 `undefined/null` 文本，改为条件展开并补静态回归断言。
- **离线测试**：新增 `tests/paper-ocr.test.ts` 18 例与 `tests/web-paper-ocr.test.ts` 6 例，覆盖请求/区域校验、同源与密钥边界、503/502/504、临时文件清理、字节与 OCR 跨实例恢复、失败重试、旧项目补传、候选排除未识别页、跨行/旋转/缩放/重复引文。`npm test` = **219/219 pass、fail 0、exit 0**；`npm run verify:flow` = 全部离线场景通过、exit 0（真实模型未接通单列）；`npm run build:web` = exit 0。
- **浏览器实测（127.0.0.1:18766，IndexedDB 正式适配器）**：纯扫描 PDF 以 0 字符、1 页待识别保存，刷新后原字节与 pending 状态完整，原页可渲染且生成按钮禁用；混合 PDF 只识别无文字层页，真实 Windows OCR 返回 `SCANNED PAGE TWO/THREE`，刷新后文字、区域、来源均恢复；模拟 503 后显示实际失败原因并可重试成功；旧项目补传后 1 个问题、候选引文和确认关系不变，原 PDF 44,508 字节可读；OCR 区域高亮 3 块，缩放后百分比坐标不变；文字层唯一引文精确高亮，重复 `page` 退回「该页有 2 处相同摘录」；90° 旋转页高亮覆盖字形，放大后仍与暗色像素重合。
- **未测/受限**：in-app 浏览器视口为 0×0 且不可见，未获取可见截图；本轮以 DOM 快照、真实事件、IndexedDB 读回和 Canvas 像素核对留证。外部托管 OCR 供应商未配置，仅以 mock 覆盖服务端协议；真实模型候选生成未接通；`tsc` 未跑（依赖冻结）。**下一卡**：22 或用户指定。

## 卡 23 · 问题研究记录与验证结果（2026-11-25）

- **交付**：`StoreState` 仅新增可选附属集合 `researchRecords`，旧 IndexedDB 分区缺键时惰性初始化，不改 `Project / Question / TrainingRun / AnalysisRevision` 四种冻结契约。`DataService` 新增按问题读取研究记录、保存/编辑阅读笔记、手动新建或从笔记转换待验证事项、追加验证结果；来源只接受当前问题已有论文候选引文，跨问题/跨项目关联返回 `invalid_source`。验证结果 append-only，同事项可先记「证据不足」再记「不支持」，状态更新为「已记录结果」但历史结果全部保留。删除项目在同一事务级联清理研究记录与文献。
- **页面**：问题详情新增「研究记录」面板，覆盖论文正式问题、未明确、已确认未分析、已分析四类状态；笔记可关联一处或多处带物理页码的引文，也可保存无引用个人思考；事项保留来源笔记与引文；结果时间线提供「查看事项 / 来源笔记 / 原文第 N 页」逐级追溯。原文路由携带 `paperSha256`，多论文项目不会打开默认文献。样式沿用现有令牌、暗色模式、键盘焦点、弹窗焦点限制、窄屏单列与减少动效偏好。
- **离线测试**：新增 `tests/research-records.test.ts` 8 项，覆盖旧分区兼容、创建/更新时间与克隆隔离、单篇/多篇引文、跨项目拒绝、笔记转事项、多次验证历史、问题/访问者隔离、删除级联、原实验导入/矩阵/版本不回归、输入边界和页面接线；`node --test tests/research-records.test.ts` = **8/8 pass、exit 0**。
- **浏览器实测（127.0.0.1:8323，IndexedDB 正式适配器）**：在 `HEAD` 干净副本上仅叠加卡 23 文件后验收。带两处页码引文的笔记→转事项→进行中→保存「证据不足」→同事项再保存「不支持」，两条历史结果共存；刷新后 1 笔记 / 1 事项 / 2 结果完整恢复；结果追溯可聚焦事项和来源笔记；来源链接打开指定 SHA 文献并停在 PDF 第 1 页；合法旧问题可新增无引用个人思考且与其他问题隔离；跨项目引文返回 `invalid_source` 且未写入。
- **级联与清理**：浏览器删除自建验收项目，删除前 2 笔记 / 1 事项 / 2 结果 / 1 文献；删除后对应计数全部为 0，无悬空研究问题或结果事项，临时保留项目仍存在，随后临时项目也已清理。
- **验收命令**：干净交付快照 `node --test tests/research-records.test.ts` exit 0（8/8）；`npm test` exit 0（**195/195 pass**）；`npm run verify:flow` exit 0（全部离线场景通过，真实模型未接通单列）；`npm run build:web` exit 0；根目录 `git diff --check` 与 `git diff --cached --check` exit 0。混合工作区中的前序未提交改动不纳入本卡提交。
- **未测/受限**：in-app 浏览器视口为 0×0 且不可见，指针点击与可见截图无法完成（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`）；本轮以 DOM 快照、脚本派发真实事件、IndexedDB 读回与页面路由核验，未声称可见布局验收。真实模型与云存储仍未接通；`tsc` 未跑（依赖冻结）。**下一卡**：24（或用户指定）。

## 卡 R · 首页项目卡片操作区常显（2026-11-25）

- **交付**：`web/assets/study.css` 将 `.card-actions` 默认 `opacity` 从 0 改为 1，置顶/重命名/删除三钮不再依赖 hover 或 `hover: none` 才可见；`tests/web-ux.test.ts` 新增回归断言，校验默认常显、无 `opacity: 0` 隐藏规则及三钮接线。未改 JS、业务 schema 或依赖。
- **浏览器实测（127.0.0.1:8343）**：修复前同环境未悬停时操作区计算样式为 `opacity: 0`，且 `matchMedia('(hover: none)')` 为 false；修复后 390×844 iframe 中为 `opacity: 1`，三钮均 26×26、`elementFromPoint` 命中、位于卡片内，横向溢出为 0。重命名按钮可打开弹窗并聚焦输入框，取消后关闭；验收后已删除本轮载入的演示项目。
- **验收命令**：`node --test --test-name-pattern="项目卡片操作区" tests/web-ux.test.ts` = 1/1 pass、exit 0；`npm run build:web` = exit 0；`npm run verify:flow` = exit 0；根目录 `git diff --check` = exit 0。`npm test` = **265/269 pass、exit 1**；4 个失败均非本卡范围：`web-paper-compare` 的项目标题旧类名断言、`web-sidebar` 的 `.nav-btn` 旧正则、`web-ux` 的旧模型提示文案与根路径旧条件，未越界修改。
- **未测/受限**：in-app 浏览器指针视口为 0×0，原生点击/截图不可用，本轮以脚本派发真实 DOM 事件、计算样式与命中测试留证；真实模型与云存储状态不变。**本次没做**：未修上述前序/并发改动导致的旧断言，未提交卡 24 或其他未提交文件，未改站点访问范围。

## 卡 R2 · 研究库可拖动侧栏、树木拖动条与透明 PNG 素材（2026-11-25）

- **交付**：研究库按钮常显；≥1200px 侧栏支持 Pointer Events 拖动调宽（默认 248px、范围 208–420px）、左右键 / Home / End 微调及宽度/收起状态持久化，桌面收起将网格轨道和侧栏宽度归零；≤1199px 保留 260px 抽屉，Escape 关闭并回焦，≤767px 按钮为 44×44px。用户提供的树木、羽毛与银杏叶已处理并导入 `sidebar-winding-tree.png`（337×2048）、`sidebar-feather.png`（768×1024）、`sidebar-leaf.png`（1024×1024）：按行估计背景色后生成 Alpha、清除右下角水印、移除孤立背景颗粒、裁掉透明边距并按网页尺寸重采样；树木底部因原图截断做透明淡出。位图加载后替换 SVG 回退，拖动时从树梢生成落叶（每 90ms 最多 2 片、同时最多 12 片、1100ms 后清理）。支持减少动效、减少透明度及粗指针降级。
- **离线测试**：`src/web/sidebar.ts` 与 `tests/web-sidebar.test.ts` 共 11 项，覆盖宽度边界/坏值、键盘、状态分流、持久化、Pointer Events 与多点保护、ARIA、响应式、PNG 接线、落叶上限及构建接线；新增 Node 内置 `zlib` 解码三张正式 PNG，核对 RGBA、尺寸、透明像素比例、四边全透明与右下角无水印。隔离快照 `node --test tests/web-sidebar.test.ts` = **11/11 pass、exit 0**。
- **浏览器实测（最新远端隔离快照 127.0.0.1:8371，同源 iframe，临时页与服务均已关闭）**：1440×900 下三张 PNG 全部加载，SVG 羽毛隐藏，树木框 144×876px、`object-fit: cover`、把手宽 24px；拖动宽度 248→308px，受控序列生成 6 片真实银杏叶，手动派发 `animationend` 后全部清理；收起后网格 0/1440px、侧栏宽 0。390×844 下按钮 44×44px、抽屉宽 260px、top 56px、把手隐藏、Escape 回焦、横向溢出 0；控制台无 error/warn。
- **验收命令**：上述定向测试、`npm run build:web`、`npm run verify:flow`（全部离线场景通过，真实模型未测单列）、`node --check web/assets/study.js`、`git diff --check` 均 exit 0。隔离快照 `npm test` = **239/239 pass、exit 0**。
- **未测/受限**：最终素材的浅色/深色合成预览已目视检查；in-app 浏览器视口仍为 0×0，截图返回 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，未声称取得可见页面截图。隐藏 iframe 的 CSS 动画时间停在 0，因此本轮以手动 `animationend` 验证清理，不冒充自然播放证明；拖动使用脚本 PointerEvent 并临时补齐合成事件的 pointer capture，不冒充物理鼠标证明。真实模型、云存储与 `tsc` 未测（依赖冻结）。**本次没做**：未改业务 schema、模型服务、其他页面、依赖、站点访问范围或其他卡冻结契约，未纳入并发未提交改动。

## 卡 R3 · 顶栏高度统一与项目返回入口前移（2026-11-25）

- **交付**：全站顶栏统一为 56px，文章阅读路由不再形成不同的页头高度；项目页「← 返回项目列表」从正文独立行移到常驻顶栏空白区域，项目标题与文献内容整体上移，新建研究问题页原有跟随链接保留。顶栏返回入口仅在项目路由显示，≤767px 缩短为「← 返回」并保持 44px 触控高度，≤360px 压缩间距避免与「本机保存」重叠。
- **离线测试**：`tests/web-follow.test.ts` 增加常驻顶栏接线、隐藏态、主内容首子项、全站顶栏高度与窄屏缩写断言；主工作区 `node --test tests/web-follow.test.ts tests/web-reader-layout.test.ts` = **13/13 pass、exit 0**；最新远端隔离快照 `node --test tests/web-follow.test.ts` = **5/5 pass、exit 0**，完整 `npm test` = **231/231 pass、exit 0**。
- **浏览器实测（隔离快照 127.0.0.1:8321，真实 IndexedDB 项目页 + 同源静态克隆 iframe）**：1440/1024/768/390/360/320px 顶栏均为 56px，项目正文首个子项为项目标题节点，无独立返回行、无横向溢出；320px 返回入口与保存状态间距 25px。真实路由点击返回可回首页且入口隐藏，重新进入项目恢复显示；新建问题页顶栏同为 56px，跟随链接吸顶位为 64px。
- **验收命令**：隔离快照上述定向测试、`npm test`、`npm run verify:flow`、`npm run build:web`、`node --check web/assets/study.js` 与 `git diff --cached origin/main --check` 均 exit 0；`verify:flow` 全部离线场景通过，真实模型未测单列。当前并发工作区完整测试仍有 `web-ux.test.ts` 的旧模型提示文案与旧 `if (path === "/")` 两项既有失败，不属于本卡范围。
- **未测/受限**：in-app 浏览器视口 0×0，原生截图返回 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，以真实 DOM、计算样式、坐标与路由事件留证；真实模型与云存储未接通；`tsc` 未跑（依赖冻结）。**本次没做**：未修上述既有失败、未改业务 schema、依赖、模型服务、发布或站点访问范围，未纳入其他未提交卡片成果。

## 卡 27 · 项目标题就地改名（2026-11-25）

- **交付**：按用户要求删除项目详情独立「改名」按钮与「新的项目名」面板，主标题始终为绑定 `project.name` 的输入框。Enter 与失焦保存，Escape 恢复已保存名称，空名和保存失败在标题下显示可访问错误；保存中防重复提交并标记 `aria-busy`。PDF 项目仍以项目名为主标题，文献题名、文件名与页数作为次要说明；首页卡片重命名弹窗保持不变。
- **离线测试**：新增 `tests/web-project-rename.test.ts` 5 项，覆盖旧控件移除、键盘与输入法组词、trim/防重/刷新、错误与可访问状态、标题排版和焦点样式；干净交付快照定向测试 **9/9 pass、exit 0**，完整 `npm test` **225/225 pass、exit 0**。`npm run build:web`、`npm run verify:flow`、`node --check web/assets/study.js`、`git diff --cached --check` 均 exit 0。
- **浏览器实测（127.0.0.1:2255，IndexedDB 正式适配器）**：自建普通与 PDF 临时项目，确认旧改名按钮/面板不存在；Escape 还原、空名提示与 `aria-invalid`、Enter 去空白保存、侧栏同步、刷新恢复、失焦保存均通过。PDF 项目标题保持项目名，次要信息显示文献题名/文件名/2 页；标题输入框计算样式为 24px/600，与 h1 一致。验收后已删除临时项目、关闭临时页并停止 2255 服务。
- **当前混合工作区**：`npm test` = **295/297 pass、exit 1**；两项失败均为前序既有 `web-ux.test.ts` 静态断言漂移（旧模型提示文案、旧 `if (path === "/")`），未越界修改。干净交付快照不受这些并发改动影响。
- **未测/受限**：in-app 浏览器视口为 0×0，未获取可见截图或真实焦点视觉，交互以 DOM 事件、计算样式与 IndexedDB 读回留证；真实模型、云存储与 `tsc` 未测（依赖冻结）。**本次没做**：未改业务 schema、依赖、模型服务、首页卡片改名弹窗、站点访问范围或其他并行未提交成果。

## 卡 R4 · 全站品牌更名为研论书屋（2026-11-25）

- **交付**：页面标题、顶栏品牌、根 README、开发约定、进度记录、前端注释、工作流示例与存储测试中的旧品牌统一改为「研论书屋」；新增 `tests/brand.test.ts` 2 项，检查页面品牌并扫描产品源码与文档中的旧名称残留。`AgentFlow` 内部项目名、站点绑定元数据、业务 schema 与依赖未动。
- **浏览器实测（127.0.0.1:8356）**：`document.title` 与顶栏链接均为「研论书屋」，品牌可见，页面正文不含旧名称。
- **验收命令**：`node --test tests/brand.test.ts tests/storage.test.ts tests/workflow.test.ts` = 30/30 pass、exit 0；`npm run verify:flow`、`npm run build:web`、`node --check web/assets/study.js`、`git diff --check` 均 exit 0。隔离交付快照 `npm test` = 222/222 pass、exit 0。当前并发工作区全量 `npm test` = 295/297 pass、exit 1；两项失败与修改前基线相同，均为 `web-ux.test.ts` 的旧模型提示文案与旧根路径条件断言。
- **未测/受限**：未发布线上站点；真实模型与云存储状态不变；本地 `.workbuddy` 历史探针不属于产品源码，未修改。**本次没做**：未修既有失败、未改其他卡片成果、未纳入并发暂存内容。**交付状态**：已按用户确认将本地卡 27/R4 变基到远端 R2；重放后全量 237/237 通过，双推结果在回执中报告。

## 卡 R8 · 羽毛迁移与树木拖动命中区（2026-11-25）

- **交付**：项目卡片右上角改为透明 `sidebar-feather.png`，移除卡片羽毛 SVG；删除侧栏右下羽毛及其 SVG/PNG 回退，保留「研究库」旁的小羽毛标记。去掉侧栏右边框、拖动条伪元素线、焦点框与悬停高亮；树木贴图宽 144px，拖动命中区宽 136px，水平方向各内缩 4px。Pointer Events、键盘、宽度持久化、落叶、桌面收起与窄屏抽屉逻辑不变。
- **离线测试**：`tests/web-sidebar.test.ts` 在隔离快照覆盖卡片 PNG 无障碍属性、侧栏羽毛移除、无分隔线/高亮、136/144px 命中区与透明素材，`node --test tests/web-sidebar.test.ts` = **12/12 pass、exit 0**；当前混合工作区与 `tests/web-home-glass.test.ts` 联合 = **16/16 pass、exit 0**。隔离快照 `npm test` = **240/240 pass、exit 0**；`npm run verify:flow`、`npm run build:web`、`node --check web/assets/study.js`、`git diff --check` 均 exit 0。
- **浏览器实测**：当前混合工作区 1440×900 同源 iframe 中卡片羽毛为已加载的 768×1024 PNG、无 SVG；树木框 144×876px、命中区 136×844px，中心命中把手，侧栏导航仍可点击；脚本 PointerEvent 拖动 248→308px 并生成 2 片落叶，Home/ArrowRight/End 分别到 208/224/420px。隔离快照 127.0.0.1:8373 复测卡片羽毛与操作区不重叠（桌面约 3px、手机约 22px 间距），390×844 下羽毛 60px、按钮 44×44px、抽屉 260px、Escape 回焦、横向溢出 0；两轮控制台均无 error/warn，临时演示项目、iframe、页面与服务已清理。
- **未测/受限**：in-app 浏览器视口为 0×0，截图仍返回 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`；以真实 DOM、计算样式、坐标与脚本事件留证，未声称可见截图或物理鼠标验收。当前混合工作区 `npm test` = **297/299 pass、exit 1**，两项均为前序既有 `web-ux.test.ts` 旧提示文案与旧根路径条件断言，未越界修改。真实模型、云存储与 `tsc` 未测（依赖冻结）。**本次没做**：未改业务 schema、模型服务、依赖、站点访问范围，未纳入其他未提交卡片成果。
