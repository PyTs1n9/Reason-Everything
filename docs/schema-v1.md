# Schema v1 · 四个数据对象契约（冻结）

> 状态：**v1 冻结**（2026-11-19）。后续所有卡只信这份文件；改动任何字段或取值
> 必须先修改本文档并单独评审，不允许在实现卡里顺手变更。
> 来源：`docs/architecture-brief.md` §2、`app/cards.py`、`app/audit.py`、`app/ingest.py`。
> 运行时校验：`app/stations/schemas.py` 的 `validate_anchor / validate_card / validate_plan`。
> Manifest 本次只在此冻结字段清单，校验由 Q 卡（打包）执行，因此 schemas.py 没有第四个函数。

## 0. 通用规则

- 四个对象都是 JSON 对象（Python `dict`）。下表列出的字段**全部必填**：键必须存在；
  标注"可空"的字段允许值为 `None/null`，但键不能缺。
- 额外字段不校验、不拒绝（后续卡可追加），但不得改变必填字段的语义。
- 校验失败一律抛 `ValueError`，错误信息必须带 `对象.字段` 名。
- `bool` 不算整数：`page`、`char_span`、`budget_usd` 等数值字段不接受 `True/False`。
- ID 格式：
  - `paper_id` 匹配 `^p_[0-9a-f]{10}$`（= `"p_"` + 原文 sha256 前 10 位，见 `app/ingest.py`）。
  - `anchor_id` 匹配 `^a_[0-9a-f]{8}$`（由 `app/cards.make_anchor_id` 产出，同段原文永远同号）。

---

## 1. Anchor（引用的最小单元，S2 物化）

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `anchor_id` | string | 是 | `^a_[0-9a-f]{8}$` | 由 paper_id + 页码 + 规范化摘句决定，内容寻址 |
| `paper_id` | string | 是 | `^p_[0-9a-f]{10}$` | 所属论文 |
| `page` | integer | 是 | ≥ 1 | PDF 页码（1 起） |
| `quote` | string | 是 | 去空白后非空，长度 ≥ 10 | 原句摘句（`MIN_QUOTE = 10`） |
| `char_span` | [integer, integer] \| null | 是，可空 | `0 ≤ start < end` | quote 在该页折叠空白后文本中的起止偏移（前闭后开）；仅 `verified=false` 时可为 null |
| `verified` | boolean | 是 | `true` / `false` | 机械回查是否逐字定位成功 |

跨字段规则：
- **A1** `verified=true` → `char_span` 必须是合法二元组（定位成功必须给出区间）。
- **A2** 未验证锚点只能用于诊断，不得被卡片引用为论据（铁律 1 的落点）。

---

## 2. ClaimCard（论据卡，S2/S3/S4 产出）

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `card_id` | string | 是 | 非空、不含空白 | 卡编号（如 `E1`），本次运行内唯一 |
| `paper_id` | string | 是 | `^p_[0-9a-f]{10}$` | 所属论文 |
| `kind` | string | 是 | `support` \| `counter` \| `scope` | 支持卡（S2）/ 反证卡（S3）/ 条件卡（S4） |
| `claim` | string | 是 | 非空 | 这条论断本身（中文表述） |
| `status` | string | 是 | `verified` \| `unverified` \| `missing` \| `scope_unknown` | 三站内判定结果 |
| `anchors` | string[] | 是 | 每项匹配 `anchor_id`，不重复 | 引用的锚点；非 `verified` 状态可为空数组 |
| `conditions` | string[] | 是 | 每项非空字符串 | 适用条件（样本/人群/任务/数据集/时长/剂量），S4 填写 |
| `reason` | string \| null | 是，可空 | 非空字符串或 null | 降级/缺失原因；`verified` 时可为 null |

跨字段规则：
- **C1** `status=verified` → `anchors` 必须非空（**没有锚点的句子不得成为论据**，铁律 1）。
- **C2** `status ∈ {unverified, missing, scope_unknown}` → `reason` 必须是非空字符串（宁可出缺口 + 说明，铁律 3）。
- **C3** `kind=scope` 且 `status=verified` → `conditions` 必须非空（一个维度都没有应标 `scope_unknown`）。

> 备注：旧版 `app/cards.py` 的 `kind` 用 `background|method|...` 且页面/摘句直接混在卡内，
> 是冻结前的实现。本契约不回溯约束旧模块；S2 迁移到新契约由后续卡负责。
>
> 决议（2026-11-19）：冻结前实现不回溯约束本契约，保持原文；S2 迁移由独立卡负责，
> 迁移时按“产出站”映射 kind，旧修辞类型降为增量字段，page/quote 只存在于 Anchor。

---

## 3. Plan（单次运行计划，Planner 产出）

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `mode` | string | 是 | `quick` \| `standard` \| `deep` | 运行模式 |
| `tier` | string | 是 | `economy` \| `standard` \| `deep` | 成本档位（只选档位，不选具体模型） |
| `stations` | string[] | 是 | 每项 ∈ `decompose` \| `evidence` \| `challenge` \| `scope` \| `audit` \| `compile`；非空、不重复 | 本次要跑的站，数组顺序即执行顺序 |
| `scope` | string | 是 | `full` \| `section` | 全篇还是节选 |
| `budget_usd` | number | 是 | ≥ 0（int 或 float，bool 除外） | 本次运行的美元预算上限 |
| `source` | string | 是 | `llm` \| `rules` | 计划来自模型还是规则兜底 |

跨字段规则：无（六字段自证）。

> 备注：若 K 卡需要第三态 `rules_fallback`，必须先改本文档并过评审；
> 在 v1 中 `source` 只允许 `llm|rules` 两个值。
>
> 决议（2026-11-19）：不新增第三态。source 仍为 llm|rules，语义为“计划由谁决定”；
> 降级事件用增量字段 fallback_reason: string|null 记录（§0 已授权追加字段），
> 判定降级 = source=="rules" and fallback_reason is not None。

---

## 4. Manifest（精读包清单，S6 写入；打包前缺字段拒绝打包）

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `schema` | string | 是 | 常量 `"agentflow/manifest@1"` | 清单格式版本 |
| `generated_at` | string | 是 | ISO-8601 UTC（如 `2026-11-19T08:30:00Z`） | 打包时间 |
| `paper` | object | 是 | 见 4.1 | 基于哪一版原文 |
| `artifacts` | object[] | 是 | 见 4.2，可为空数组但打包时非空 | 哪些内容过了哪一层 |
| `model` | object | 是 | 见 4.3 | 复现生成条件 |
| `prompts` | object | 是 | 见 4.4 | 提示词指纹 |
| `coverage` | object | 是 | 见 4.5 | 明确"哪里没做到"（铁律 3） |
| `human_signoff` | object \| null | 是，可空 | 见 4.6 | 责任可追溯；null = 未终审 |

### 4.1 `paper{}`
| 字段 | 类型 | 必填 | 取值范围 |
| --- | --- | --- | --- |
| `paper_id` | string | 是 | `^p_[0-9a-f]{10}$` |
| `sha256` | string | 是 | `^[0-9a-f]{64}$`（原文全文哈希） |
| `source_path` | string | 是 | 非空（原始绝对路径；包被转发后可能失效，仍必须记录） |
| `page_count` | integer | 是 | ≥ 1 |
| `doi` | string \| null | 是，可空 | 无 DOI 时为 null |

### 4.2 `artifacts[]`（每项）
| 字段 | 类型 | 必填 | 取值范围 |
| --- | --- | --- | --- |
| `path` | string | 是 | 非空，包内相对路径 |
| `sha256` | string | 是 | `^[0-9a-f]{64}$` |
| `stage` | string | 是 | `decompose` \| `evidence` \| `challenge` \| `scope` \| `audit` \| `compile` |
| `review_status` | string | 是 | `passed` \| `blocked` \| `needs_review` |

### 4.3 `model{}`
| 字段 | 类型 | 必填 | 取值范围 |
| --- | --- | --- | --- |
| `calls` | integer | 是 | ≥ 0，本次运行总调用次数 |
| `cost_usd` | number | 是 | ≥ 0，总成本 |
| `by_role` | object | 是 | 键为角色名（`evidence/challenge/scope/audit` 等），值为 `{profile: string, calls: integer, cost_usd: number}` |

### 4.4 `prompts{}`
| 字段 | 类型 | 必填 | 取值范围 |
| --- | --- | --- | --- |
| `sha256` | string | 是 | `^[0-9a-f]{64}$`，取 `app/prompts.py` 全文哈希 |

### 4.5 `coverage{}`
| 字段 | 类型 | 必填 | 取值范围 |
| --- | --- | --- | --- |
| `paragraphs` | integer | 是 | ≥ 0，已审段落数 |
| `claims` | integer | 是 | ≥ 0，已审论断数 |
| `by_status` | object | 是 | 键为 `supported/needs_qualification/insufficient_evidence/illustration`（`app/audit.py` 的 STATUS），值为 integer ≥ 0 |
| `unverified_anchors` | integer | 是 | ≥ 0，未通过回查的锚点数 |
| `empty_pages` | integer[] | 是 | 无文字层页码列表，每项 ≥ 1，可为空数组 |

### 4.6 `human_signoff{}`（或 null）
| 字段 | 类型 | 必填 | 取值范围 |
| --- | --- | --- | --- |
| `reviewer` | string | 是 | 非空（人名） |
| `signed_at` | string | 是 | ISO-8601 |
| `sample_ratio` | number | 是 | 0 < x ≤ 1（抽检比例，不得跳过抽检） |
| `reason` | string \| null | 是，可空 | 签字必须带理由；无条件通过时为 null 由 Q 卡判定是否放行 |
