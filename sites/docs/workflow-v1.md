# 工作流服务契约 v1（workflow-v1）

状态：**v1**（2026-11-21，卡 07）。把 02–06 接成同一个端到端应用服务：
`src/workflow/service.ts` 的 `createWorkflowService({ storage, agent, now })`。
本卡无 Web UI；HTTP 路由只是这些动作的**可选映射**，不另起服务凑端点。
可运行请求样例由 `tests/workflow.test.ts` 实际驱动（见文末样例）。

## 通用约定

- **权限**：每个动作第一个参数是 `actor`（服务端验证身份，云端取
  `x-qoder-user-context` 的 `user_id`）。数据按 actor 分区；凭任意
  projectId/questionId 读取他人记录一律 `NotFoundError`，不靠前端筛选。
- **超时**：`parseClaim` / `analyze` 走模型适配器超时（`timeoutMs`，默认
  5000ms，超时 → `timeout` 错误码）；其余动作为本地存储读写，无网络超时。
- **幂等**：`analyze` / `appendRunsAndReanalyze` 以 `requestId` 为作业号：
  重复请求直接重建上次结果，不再打模型；存档再以同一键走存储幂等。
- **过期父版本**：`analyze` 可携带 `expectedParentId`（客户端最后见到的版本）；
  与当前不符 → `ConflictError('stale_parent')`，且发生在模型调用之前。

## 动作一览

| 动作 | 输入 | 输出 | 错误 | 超时 | 权限 |
| --- | --- | --- | --- | --- | --- |
| `listProjects` | — | 项目摘要列表（projectId/name/questionCount/pendingCount/updatedAt，按更新时间倒序） | — | 无 | 仅本人分区 |
| `createProject` | name, projectId? | Project | `duplicate_id` | 无 | 仅本人分区 |
| `createQuestion` | projectId, questionId?, rawClaim | Question（confirmedClaim=null → `needs_input`） | `not_found`、`duplicate_id` | 无 | 项目须属本人 |
| `parseClaim` | requestId, rawClaim | `{ok:true, source:'model', output}` 或 `{ok:false, error}` | `empty_response`/`bad_json`/`validation_failed`/`timeout`/`model_unavailable` | 模型超时 | 无状态读取（不触数据） |
| `confirmScope` | questionId, proposal, source, targetRunId?, baselineRunId?, scope?, learningRates? | 成功 → `{status, question, source}`；缺字段 → `{status:'needs_input', missing:[…], clarifyingQuestion}`（只问缺项） | `not_found`、`already_confirmed` | 无 | 问题须属本人 |
| `previewImport` | projectId, text, 可选 accuracyUnit/overrides/unknownRoles | 导入预览（新增/重复/冲突/缺配置 + 行列错误） | `not_found`（他人项目） | 无 | 项目须属本人 |
| `commitImport` | projectId, runs | 新增运行列表 | `not_found`、`run_conflict`（同 ID 异内容整批拒绝） | 无 | 项目须属本人 |
| `analyze` | requestId, questionId, expectedParentId? | `{gated:false, status, revisionId, evidence(规则报告+矩阵), modelOutput, job, analysis, events, duplicate, reusedSnapshot}`；未确认范围 → `{gated:true, modelCalled:false}` | `not_found`、`stale_parent`、`incomplete_job`、模型各类错误码（存档为 `modelOutput=failed`） | 模型超时 | 问题须属本人 |
| `appendRunsAndReanalyze` | requestId, questionId, runs | 同 `analyze`（强制新快照 → 下一版本） | 同上 + `run_conflict` | 模型超时 | 问题须属本人 |
| `getJob` | jobId | `{job, events}`（事件含 jobId/revisionId/node/at/摘要） | `not_found` | 无 | 作业须属本人 |
| `getRevision` | questionId, revisionId | 历史快照（不可变） | `null`（不存在或他人） | 无 | 问题须属本人 |
| `listRevisions` | questionId | 版本链（父→子顺序） | `not_found` | 无 | 问题须属本人 |

## 流程与状态

```
解析/人工确认范围 → 取数据快照 → 查找对照(卡04) → 规则报告+矩阵
  → 请求模型解释 → 校验引用并关联格子 → 存档(版本+作业+事件)
```

- 未确认范围 → 停在 `needs_input`，**不启动模型调用**（零成本）。
- 缺对照 → 照常输出原因、补跑单与矩阵，存档 `waiting_for_run`。
- 范围齐且有配对 → `reviewable`。
- 补入数据（`appendRunsAndReanalyze`）→ 同 questionId 的下一版本。
- 无模型服务 → `modelOutput=unavailable`，规则报告照常存档，AI 区未完成；
  配置缺项 → `modelOutput=pending`，只问缺项，不调用模型；
  模型失败 → `modelOutput=failed`，保留独立规则报告；**再次分析自动沿用
  原证据快照**，且存档时复查父版本——迟到的旧版本不会覆盖新结果。
- 草稿：`createQuestion` 即落库（`needs_input`），刷新/断线后可经
  `getRevision`/`listRevisions`/`getJob` 找回版本与作业结果。

作业状态机：`queued → running → succeeded | failed`（succeeded 仅当模型分析就绪）。
节点事件：`snapshot | rules | model | archive` × `started | completed | failed`。

## 请求样例（由 tests/workflow.test.ts 实际执行）

```ts
const wf = createWorkflowService({ storage: dataService, agent: agentService, now: clock });

await wf.createProject(ALICE, "演示", "p_demo");
await wf.createQuestion(ALICE, { projectId: "p_demo", rawClaim: "数据增强使准确率提高了 2 个百分点" });
const parsed = await wf.parseClaim("req-parse", sentence);          // 模型不可用 → model_unavailable，走人工
await wf.confirmScope(ALICE, { questionId, proposal: parsed.output, source: "model",
  targetRunId: "R02", baselineRunId: "R01", scope: "both_lrs", learningRates: [0.001, 0.01] });
const preview = await wf.previewImport(ALICE, { projectId: "p_demo", text: csv });
await wf.commitImport(ALICE, { projectId: "p_demo", runs: preview.added });
const v1 = await wf.analyze(ALICE, { requestId: "req-a", questionId });          // → waiting_for_run
const v2 = await wf.appendRunsAndReanalyze(ALICE, { requestId: "req-b", questionId, runs: [R03] });
const { job, events } = await wf.getJob(ALICE, "req-a");
const versions = await wf.listRevisions(ALICE, questionId);          // [V1, V2]
```

可选 HTTP 映射（文档性质，本卡不实现）：`GET /api/projects`、
`POST /api/projects/:id/questions/:qid/analyze` 等——若将来映射，鉴权仍取
服务端身份，动作语义与上表一致。
