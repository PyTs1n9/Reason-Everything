# 实验业务契约 v1（experiment-v1）

状态：**v1 冻结**（2026-11-21，卡 02）。字段与取值改动必须先修改本文档并评审，
实现卡不得顺手变更。实现位于 `sites/src/experiment/`，样例位于
`sites/tests/fixtures/experiment-demo.ts`，离线用例 `sites/tests/experiment.test.ts`。

## 四种身份

### Project

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| projectId | string | 项目标识 |
| name | string | 项目名 |
| updatedAt | string | ISO 时间 |

项目列表只显示项目；每次分析创建的是 revision，**不产生新项目**。

### Question

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| questionId | string | 问题标识 |
| projectId | string | 所属项目 |
| rawClaim | string | 用户原句 |
| confirmedClaim | ClaimSpec \| null | 已确认的结构化主张；未确认为 null |
| currentRevisionId | string \| null | 当前版本 |
| status | QuestionStatus | 见状态表 |

疑问范围变化或追加记录都在**同一 questionId** 下产生新 revision。

### TrainingRun

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| runId | string | **项目内**唯一；不同项目可各自拥有 R01 |
| projectId | string | 所属项目 |
| config | RunConfig | 见下 |
| source | `demo` \| `real` | 演示/真实来源必须分开标识 |
| metrics.accuracy | number | 0–100，最多两位小数 |
| metadata | { experimentNo?, note?, importedAt } | 元数据 |

RunConfig 必要列：`model`、`evalSplit`（含版本）、`seed`、`lr`、`augmentation`；
可选列 `optimizer`、`epochs` 及 `extras` 附加列**参与匹配**。
`experimentNo`（实验编号）、`note`（备注）、`metrics`、`importedAt`（导入时间）
是元数据，**永不参与匹配**。

### AnalysisRevision（不可变）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| revisionId | string | 与 runId 不同域，**runId 不能冒充 revisionId** |
| questionId | string | 继承自问题 |
| parentId | string \| null | 前一版本；首版为 null |
| createdAt | string | ISO 时间 |
| inputSnapshot | { claim: ClaimSpec; runs: TrainingRun[] } | 不可变输入快照 |
| conclusions | RuleConclusion[] | 规则结论 |
| evidenceRefs | EvidenceRef[] | 证据引用（runId + projectId） |
| suggestions | string[] | 补跑建议等 |
| modelOutput | ModelOutputStatus | 见状态表；failed 时结论与证据保留 |

## 状态表（三处分开存）

| 问题 Question.status | 含义 |
| --- | --- |
| `needs_input` | 主张未确认或无法解析 |
| `waiting_for_run` | 缺可比对照，**正常产物**（对应补跑单） |
| `reviewable` | 证据齐全，可出分析 |

| 分析作业 AnalysisJob.status | 含义 |
| --- | --- |
| `queued` / `running` / `succeeded` / `failed` | 作业生命周期，与问题状态无关 |

| 模型输出 AnalysisRevision.modelOutput | 含义 |
| --- | --- |
| `pending` | 尚未生成 |
| `ready` | 已生成 |
| `failed` | 模型失败；**已算出的结论与证据保留** |
| `unavailable` | 无可用模型 |

## ClaimSpec（v1）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| factor | `"augmentation"` | v1 固定为增强开关 |
| metric | `"accuracy"` | v1 固定，高者优 |
| targetRunId / baselineRunId | string | 目标与基准运行，不得相同 |
| scope | `"target_lr"` \| `"both_lrs"` | 只看目标学习率 / 两档逐档验证 |
| learningRates | [number, number] | 两档学习率列表 |
| expectedDeltaPp | number \| null | **百分点**；null = 仅检查方向 |

规则：

- v1 只支持「提高」类主张；「下降」「未变」「无法识别」一律返回
  **待澄清**（needs_clarification），不改写比较方向。
- 「个百分点 / pp」是百分点；「%」是百分数，两者不同。
  句子用 % 写增幅 → 待澄清；负增幅 → 待澄清。
- `expectedDeltaPp` 非 null 时**逐档验证**「至少提高 N 个百分点」。
- 配对口径：除 `lr` 与 `augmentation` 外，两侧运行全部配置列一致
  （含可选列与附加列）；任一侧有 `unknown` 不得配对。

## 单位与 unknown

- accuracy 单位 0–100；计算层转**整数百分之一百分点**（80.0 → 8000）
  再比较，禁止浮点相等判断增幅。
- 配置空值一律为 `"unknown"`：**绝不能默认为同值**——unknown 连另一个
  unknown 都不等于。缺必要配置的记录可保存，但不能参加严格配对。

## 演示数据集（source = demo，非真实实验）

公共条件：model=M1、evalSplit=S1:v1、seed=7、optimizer=adam、epochs=20。

| runId | augmentation | lr | accuracy | 归属 |
| --- | --- | --- | --- | --- |
| R01 | off | 0.001 | 80.0 | 初始导入 |
| R02 | on | 0.01 | 82.0 | 初始导入 |
| R03 | off | 0.01 | 81.8 | 后续回填 |
| R04 | on | 0.001 | 80.5 | 后续回填 |

原句：「数据增强使准确率提高了 2 个百分点」；target=R02、baseline=R01、
scope=both_lrs、learningRates=[0.001, 0.01]、expectedDeltaPp=2。
**初始集合恰好 R01、R02 两行**；R03、R04 单独存放，不藏进初始集合。
初始评估两档都缺对照 → `waiting_for_run`；回填后逐档：
lr=0.001 → +0.50、lr=0.01 → +0.20 个百分点，方向 pass、增幅 fail → `reviewable`。

## 文件地图

| 文件 | 职责 |
| --- | --- |
| `src/experiment/types.ts` | 四种身份与状态联合类型 |
| `src/experiment/claim.ts` | 原句解析、ClaimSpec 构建与待澄清 |
| `src/experiment/runs.ts` | 运行校验、配置匹配、整数百分点比较 |
| `src/experiment/evaluate.ts` | 逐档规则评估与补跑建议 |
| `src/experiment/revision.ts` | 版本校验、同问题推进、跨项目拒绝 |

验收：`cd sites && npm test`（离线，零依赖）。
