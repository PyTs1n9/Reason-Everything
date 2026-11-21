# 开发链路 A–Z · 可复制提示词版

> 用法：**一次只喂一张卡**。每张卡的提示词都是自包含的，直接整段复制给编码 Agent。
> 不要两张卡一起喂——范围一混，验收就没法判定。
>
> 状态标记：✅ 已有 ／ 🟡 部分已有 ／ ⬜ 待做
> 仓库：`D:/Code/GitHub Projects/AgentFlow`

---

## 0. 每张卡都适用的通用约束

把下面这段粘在每张卡提示词的**开头**，或者让 Agent 先读这一节：

```text
通用约束（必须全部遵守）：
1. 只做本卡范围内的事，做完停止。不顺手重构、不"顺便修一下"、不扩大文件改动面。
2. 不新增第三方依赖。现有依赖只有 fastapi、uvicorn、pypdf。
3. 不改动其他卡已冻结的输出契约。确需改 schema，先停下来报告，不要自行变更。
4. 新增行为必须有离线测试；一切模型调用走 mock，测试不得联网。
5. 不要用 try/except 吞掉异常来"跑通"。失败就如实失败。
6. 回报四件套：① git diff 摘要 ② 验收命令 ③ 退出码 ④ 本次没做什么。
```

---

## 1. 依赖关系

```
主线   A → B → C → D → E → F → G → H → I → J → K → L → M → N → O → P → Q → Z
支线1（交付增强）      Q → R → S → Z
支线2（知识库）        D → T → U → V → S
支线3（界面与质量）    J → W → X → Y → Z
```

- A、B 是所有卡的前置，**必须最先做**，且 D1 冻结后不再改字段。
- T–V（知识库）可以与主线并行，只依赖 D。
- Z 是收口卡，所有支线都要汇到它。

---

## 2. 任务卡

---

### A · 契约冻结　`⬜ 待做`　`前置：无`

**交付**：`docs/schema-v1.md`、`app/stations/schemas.py`、`tests/test_schemas.py`

```text
【A · 契约冻结】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/architecture-brief.md §2（四个数据对象）、app/cards.py、app/audit.py

目标：定义并冻结四个对象的字段，供后续所有卡引用。只写契约与校验，不写业务。

要做：
1. 新建 docs/schema-v1.md，逐一列出 Anchor / ClaimCard / Plan / Manifest 的字段、类型、必填性、取值范围。
   - ClaimCard: card_id, paper_id, kind(support|counter|scope), claim, status(verified|unverified|missing|scope_unknown),
     anchors[], conditions[], reason
   - Anchor: anchor_id, paper_id, page, quote, char_span[2], verified
   - Plan: mode(quick|standard|deep), tier(economy|standard|deep), stations[], scope(full|section), budget_usd, source(llm|rules)
   - Manifest: schema, generated_at, paper{}, artifacts[], model{}, prompts{}, coverage{}, human_signoff
2. 新建 app/stations/schemas.py，只放常量与三个函数：validate_anchor / validate_card / validate_plan。
   校验失败抛 ValueError，错误信息必须指出字段名。
3. 新建 tests/test_schemas.py：每个对象给一个合法样例 + 一个缺字段样例。

不要做：
- 不引入 pydantic / jsonschema / attrs
- 不写存储、不写提示词、不写任何 LLM 调用
- 不改 app/store.py

验收：
  python -m unittest tests.test_schemas -q          # 期望 OK
  python -m unittest discover -s tests -q           # 期望全绿（既有 39 项不能挂）

回报：diff 摘要 + 两条命令的退出码 + 本次没做什么。
```

---

### B · 站点协议与六站骨架　`🟡 部分`　`前置：A`

**交付**：`app/station.py`、`app/stations/__init__.py`、六站空实现、`tests/test_station.py`

```text
【B · 站点协议与六站骨架】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/architecture-brief.md §1（三段六站）、app/workflow.py、app/pipeline.py

目标：把现有的五节点流程重排为六站，站点先空转，保证链路能从头走到尾。

要做：
1. 新建 app/station.py：Station 为 dataclass(name, inputs, outputs, run, failure)，提供 run_stations(stations, ctx, emit)。
   emit 签名统一为 emit(station, state, detail="", ms=None)，state ∈ running|done|failed|skipped。
2. 新建 app/stations/ 包，六个文件各导出一个 Station：
   decompose(S1) / evidence(S2) / challenge(S3) / scope(S4) / audit(S5) / compile(S6)。
   S1 直接复用 app/ingest.py；S2 复用 app/cards.py；S5 复用 app/audit.py；
   S3/S4/S6 先返回空结果并 emit skipped，detail 写 not_implemented。
3. Context 增加字段：anchors[], cards[], claims[], plan{}, usage{}。沿用 workflow.Context，不要另起一套。
4. pipeline.py 改为调用 run_stations，删除原有的固定节点列表。
5. 站点失败只标记该站，不抛出到进程外；整条链返回 status ∈ passed|needs_review|blocked|partial。

不要做：
- 不实现 S3/S4 的业务逻辑（下一批卡做）
- 不改前端
- 不改 API 路由

验收：
  python -m unittest discover -s tests -q                       # 期望全绿
  python -c "import app.pipeline as p; print(len(p.STATIONS))"   # 期望 6

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### C · S1 拆解　`🟡 部分`　`前置：B`

**交付**：`app/stations/decompose.py`、`tests/test_decompose.py`

```text
【C · S1 拆解】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/ingest.py、app/grounding.py、docs/architecture-brief.md §2

目标：S1 只做「PDF → 可定位的页文本」，不做抽卡、不生成锚点。

设计约束（重要）：
锚点在 S2 第一次拿到 quote 时才物化，因为此时还不知道要引哪一句。
S1 的产物是 pages[] 与元数据；anchor 的生成留在 S2。

要做：
1. app/stations/decompose.py 的 run(ctx)：
   - 调 ingest.read_pdf_bytes，写入 ctx.pages、ctx.paper（含 paper_id/sha256/page_count/text_chars）
   - 空页列表写进 ctx.paper["empty_pages"]，不静默忽略
   - 返回 detail："{页数} 页 / {字符数} 字符 / {空页数} 空页"
2. 三种失败分别抛不同异常子类：NoTextLayer（无文字层）、Encrypted（加密）、Damaged（损坏），
   统一在 station 层转成 failed 并从状态里带原因。
3. tests/test_decompose.py 用 tests/fixtures/sample.pdf 断言：2 页、1191 字符、0 空页。

不要做：
- 不做 OCR
- 不生成 anchor_id
- 不改 cards.py

验收：
  python -m unittest tests.test_decompose -q    # 期望 OK
  python tests/make_fixture.py                  # 期望 wrote ... 2217 bytes

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### D · 存储扩展（知识库预留）　`🟡 部分`　`前置：C`

**交付**：`app/store.py`（改）、`tests/test_store_migration.py`

```text
【D · 存储扩展】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/store.py、docs/knowledge-base.md §2（切块）、§7（规模）

目标：为知识库预留表与字段，但不实现检索。旧工作区必须能自动升级。

要做：
1. 新建表 chunks：chunk_id TEXT PK, paper_id TEXT, page INT, section TEXT,
   kind TEXT(text|note|caption), text TEXT, anchor_id TEXT NULL, char_start INT, char_end INT,
   created_at TEXT。索引：(paper_id, page)。
2. papers 表增加两列：source_type(TEXT NULL)、batch_id(TEXT NULL)。
3. runs 表增加两列：cost_usd REAL DEFAULT 0、model_calls INT DEFAULT 0。
4. 在 Store._migrate 中补列（用 PRAGMA table_info 判断），保证已有 workspace/ledger.db 能原地升级。
5. save_cards 时同步写入 chunks？不。本卡只建表，不写数据。

不要做：
- 不实现检索、不实现切块
- 不改 cards/pipeline
- 不加索引之外的任何优化

验收：
  python -m unittest tests.test_store_migration -q   # 旧库升级后列齐全、数据不丢
  python -m unittest discover -s tests -q            # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### E · S2 取证　`🟡 部分`　`前置：D`

**交付**：`app/stations/evidence.py`、`tests/test_evidence.py`

```text
【E · S2 取证】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/cards.py、app/prompts.py（CARD_*）、app/models.py（Router）

目标：S2 抽出支持性主张，逐条回查，物化锚点。这是整条链的地基。

要做：
1. app/stations/evidence.py：
   - 按页预算裁剪页文本（单页 ≤6000 字符，总 ≤90000 字符），被裁的页码要上报，不假装覆盖全文
   - 调 backend.cards(payload)，角色名 evidence，由 Router 决定模型
   - 解析 → 结构校验 → cards.verify(cards, pages, paper_id)
   - 把 verified 的卡片写 ctx.cards；anchor_id/char_span 必须落进卡片
2. 定位失败的卡片保留，status=unverified，reason 写清是"页码错"还是"摘句被改写"。
3. 一张都没通过 → 该站 failed，整链 blocked，不进入后续站。
4. tests/test_evidence.py：mock 后端跑 sample.pdf，断言 ≥4 张卡、全部 verified、anchor_id 两次运行一致。

不要做：
- 不改提示词内容（提示词归 B）
- 不做质疑/划界
- 不缓存（下一卡做）

验收：
  python -m unittest tests.test_evidence -q     # 期望 OK
  python -m unittest discover -s tests -q       # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### F · 缓存层　`⬜ 待做`　`前置：E`

**交付**：`app/cache.py`、`tests/test_cache.py`

```text
【F · 缓存层】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/stations/evidence.py、app/prompts.py

目标：同一份 PDF、同一版提示词、同一页范围，第二次运行必须 0 次模型调用。

要做：
1. 新建 app/cache.py：
   key = sha256(paper_sha256 + prompt_module_sha256 + 页范围字符串)
   存储：workspace/cache/<key>.json，内容为原始响应文本 + 元信息（模型、时间、token）
2. 在 S2 调用前后接入：命中则直接返回缓存文本，并在 trace 里记 cache_hit=true、model_calls=0。
3. 提示词模块哈希用 sha256(open(app/prompts.py).read())，任何提示词改动都自动失效。
4. 缓存不命中时正常调用，并在 trace 里记 cache_hit=false。

不要做：
- 不做跨论文缓存
- 不做 TTL 与容量淘汰
- 不缓存 S5 的评审（评审必须每次重新跑）

验收：
  python -m unittest tests.test_cache -q                 # 期望 OK，含"二次运行 model_calls=0"
  python -c "from app.cache import key_for; print(key_for('a'*64,'b'*64,'1-2'))"   # 稳定输出

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### G · 单站重跑　`⬜ 待做`　`前置：F`

**交付**：`app/api.py`（改）、`tests/test_rerun.py`

```text
【G · 单站重跑】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/api.py、app/pipeline.py、docs/architecture-brief.md §1

目标：只重跑指定站及其下游，复用上游 checkpoint，不重复烧钱。

要做：
1. POST /api/papers/{id}/run 接受 {"only": "decompose|evidence|challenge|scope|audit|compile"}。
2. 执行器支持 start_from：跳过 only 之前的所有站，但要求这些站的产物已存在（读上次 run 的 log 或 checkpoint）；
   缺失则 400，提示"上游产物不存在，请整链运行"。
3. 响应与既有 job 结构一致；job.events 里跳过的站 emit state=skipped。
4. tests/test_rerun.py：先整链跑一次，再 only=evidence，断言只有 evidence 站发生调用。

不要做：
- 不做并行
- 不改前端
- 不引入队列系统

验收：
  python -m unittest tests.test_rerun -q        # 期望 OK
  curl -s -X POST "127.0.0.1:8765/api/papers/<id>/run" -d '{"only":"evidence"}'   # 返回 job_id

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### H · S3 质疑　`⬜ 待做`　`前置：G`

**交付**：`app/stations/challenge.py`、`app/prompts.py`（新增 CHALLENGE_*）、`tests/test_challenge.py`

```text
【H · S3 质疑】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/architecture-brief.md §1（S3）、docs/knowledge-base.md §9（文科判据）

目标：专门抽取作者想让你略过的东西：局限、反常结果、未解释现象。

要做：
1. prompts.py 增加 CHALLENGE_SYSTEM / CHALLENGE_USER（并加版本号常量），要求：
   - 只从 Discussion / Limitations / 讨论段抽取
   - 每条必须有原文摘句，不得改写
   - 抽不到时返回 {"cards":[{"id":"C0","kind":"counter","status":"missing","claim":"原文未明确说明局限"}]}
2. app/stations/challenge.py：调 backend.challenge（角色 challenge），解析后走与 E 相同的回查，
   kind=counter，status ∈ verified|missing。
3. 存在性校验：若返回 0 张且没有 missing 占位 → 该站 failed（不允许"静默为空"）。
4. tests/test_challenge.py：正常论文 ≥1 条；构造一段没有局限的文本 → 必须返回 missing 占位。

不要做：
- 不许用常识补局限
- 不跨篇抽取（知识库阶段再做）
- 不改 S2

验收：
  python -m unittest tests.test_challenge -q     # 期望 OK
  python -m unittest discover -s tests -q        # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### I · S4 划界　`⬜ 待做`　`前置：H`

**交付**：`app/stations/scope.py`、`docs/scope-dimensions.md`、`prompts.py`（SCOPE_*）、`tests/test_scope.py`

```text
【I · S4 划界】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/knowledge-base.md §9、app/stations/evidence.py

目标：为每张支持卡抽适用条件，缺维度就显式标 scope_unknown，不许用常识补。

要做：
1. 新建 docs/scope-dimensions.md，列八个维度及其可抽取句式：
   样本量 / 人群 / 任务 / 模型 / 数据集 / 时长 / 剂量 / 地域（人文另给：时期 / 地域 / 文本类型 / 理论传统 / 分析单位）。
2. prompts.py 增加 SCOPE_*，要求：只从方法与结果段抽取；每个条件必须附原文摘句；无维度时返回 scope_unknown。
3. app/stations/scope.py：逐张支持卡生成 conditions[]，每条含 {dimension, value, anchor_id}。
4. 校验：dimension 必须在维度表内；anchor_id 必须存在于该卡可用的锚点集。
5. tests/test_scope.py：多条件论文 ≥2 维度；纯方法论文返回 scope_unknown。

不要做：
- 不评价条件是否合理
- 不合并多篇条件
- 不改 S2/S3

验收：
  python -m unittest tests.test_scope -q         # 期望 OK
  python -m unittest discover -s tests -q        # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### J · 三站并行执行器　`⬜ 待做`　`前置：I`

**交付**：`app/stations/runner.py`、`tests/test_parallel.py`

```text
【J · 三站并行执行器】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/station.py、app/stations/evidence.py、app/stations/challenge.py、app/stations/scope.py

目标：S2/S3/S4 三站并行，单站失败不影响其余两站。

要做：
1. 新建 app/stations/runner.py：
   - run_parallel(stations, ctx, emit) 使用 ThreadPoolExecutor(max_workers=3)
   - 每站独立副本？不。共享 ctx 但只允许写各自字段：cards(evidence) / counter_cards(challenge) / scope_cards(scope)
   - 任一站抛错：emit failed，记录错误，其余两站继续
2. 合并阶段：按 evidence → challenge → scope 顺序合并到 ctx.cards，同一 anchor_id 只保留一条（先到先得）。
3. 全部失败 → 整链 blocked；部分失败 → status=partial，但已成功站的产物必须落盘。
4. tests/test_parallel.py：注入一个必然失败的 scope stub，断言 evidence/challenge 仍完成、status=partial。

不要做：
- 不引入 asyncio 或第三方并发库
- 不做跨论文并行
- 不改三站的内部逻辑

验收：
  python -m unittest tests.test_parallel -q      # 期望 OK
  python -m unittest discover -s tests -q        # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### K · Planner（大脑）　`⬜ 待做`　`前置：J`

**交付**：`app/planner.py`、`tests/test_planner.py`

```text
【K · Planner】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/model-routing.md §9（总 Agent 的边界）、app/models.py

目标：每次运行只规划一次，产出 plan.json；没有模型时用规则兜底，链路照跑。

要做：
1. 新建 app/planner.py：
   plan = {mode, tier, stations[], scope, budget_usd, source}，字段严格按 docs/schema-v1.md。
2. 规则兜底（source=rules）：页数 ≤8 且预算 <0.5 → mode=quick,tier=economy,stations=[decompose,evidence,audit,compile]；
   页数 >8 → mode=standard,tier=standard,全站；用户显式传 mode 时以用户为准。
3. 有模型时（角色 planner）：把页数、字符数、预算、用户意图交给模型，要求只返回 JSON；
   解析失败则回退规则兜底，置 plan.source=rules 并在 plan.fallback_reason 记失败原因。
4. tests/test_planner.py：6 页与 40 页两种输入得到不同 plan；无模型时 source=rules；非法 JSON 回退。

不要做：
- 不让 Planner 选具体模型（只选档位）
- 不做多轮规划（异常重规划是后续卡）
- 不在 Planner 里调业务站

验收：
  python -m unittest tests.test_planner -q       # 期望 OK
  python -c "from app.planner import plan_for; print(plan_for(6, 12000, None, 'auto'))"   # quick/economy

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### L · 档位路由　`🟡 部分`　`前置：K`

**交付**：`app/models.py`（改）、`models.example.toml`（改）、`tests/test_tier.py`

```text
【L · 档位路由】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/models.py（Registry/Router）、models.example.toml、docs/model-routing.md

目标：把 Planner 选的档位翻译成模型链。角色 + 档位 → 具体 profile，不回退到"全局一个模型"。

要做：
1. registry 支持两级键：优先取 routing["{role}.{tier}"]，不存在则回退 routing[role]。
   例：routing["audit.deep"] = ["judge","strong"]；routing["audit"] = ["strong"]。
2. Router.complete(role, system, user, tier=None) 增加可选 tier 参数，其余行为不变（顺序降级、预算、记账）。
3. models.example.toml 补 [routing] 的档位示例，并在注释里说明三级回退顺序。
4. tests/test_tier.py：同一角色 economy 与 deep 打到不同 model（用本地假 HTTP 服务断言 model 字段）。

不要做：
- 不改 Profile 结构
- 不做自动比价
- 不改 LLMBackend 的公开方法签名（只加可选参数）

验收：
  python -m unittest tests.test_tier -q          # 期望 OK
  python -m unittest discover -s tests -q        # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### M · 规则引擎与门禁　`⬜ 待做`　`前置：L`

**交付**：`app/rules.py`、`tests/test_rules.py`

```text
【M · 规则引擎与门禁】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/architecture-brief.md §4（三条铁律）、app/audit.py、app/cards.py

目标：八条机械规则先跑，判不了的才交模型；输出三态与 target_stage。

要做：
1. 新建 app/rules.py，实现八条：
   R1 卡片 page 在 1..page_count
   R2 quote 能在该页原文定位（复用 grounding.locate）
   R3 必填字段齐全（按 schemas.validate_card）
   R4 支持卡至少有 1 个 anchor
   R5 支持卡至少 1 个条件，或显式 scope_unknown
   R6 质疑结果至少 1 条或 missing
   R7 锚点不重复、anchor_id 唯一
   R8 正文/笔记字数上限（默认 3000）
2. 每条返回 {rule, ok, detail, target_stage}；target_stage ∈ decompose|evidence|challenge|scope|audit|compile。
3. 汇总为 gate：全过 passed；R5/R6 类"可人工补"→ needs_review；R1/R2/R3/R7 类 → blocked。
4. tests/test_rules.py：三条注入（编造引文 / 页码超界 / 条件缺失）分别命中 R2 / R1 / R5。

不要做：
- 不在规则里调模型
- 不自动修复（修复是回流卡的事）
- 不改 audit.py 的四态定义

验收：
  python -m unittest tests.test_rules -q         # 期望 OK
  python -m unittest discover -s tests -q        # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### N · 模型评审（只能降级）　`🟡 部分`　`前置：M`

**交付**：`app/stations/audit.py`（改）、`tests/test_review_downgrade.py`

```text
【N · 模型评审只能降级】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/audit.py（review/STATUS）、app/stations/audit.py

目标：模型评审只能把结论降级，不能把机械失败改成通过。

要做：
1. review() 增加硬约束：对每条 claim，若规则引擎已判 failed，则任何 supported 判定都改为 needs_qualification，
   并在 reason 里追加"规则优先"。
2. 新增函数 enforce_no_upgrade(claims, rule_report) → claims，纯函数，可单测。
3. 评审报告新增字段：downgraded_count、rule_blocked_count。
4. tests/test_review_downgrade.py：
   - 规则失败 + 模型判 supported → 结果必须是 needs_qualification
   - 规则通过 + 模型判 needs_qualification → 保持降级
   - 规则通过 + 模型判 supported → 保持 supported

不要做：
- 不让模型改写原文
- 不合并 M 的规则实现
- 不改门禁三态

验收：
  python -m unittest tests.test_review_downgrade -q   # 期望 OK
  python -m unittest discover -s tests -q             # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### O · 回流路由　`⬜ 待做`　`前置：N`

**交付**：`app/reflow.py`、`tests/test_reflow.py`

```text
【O · 回流路由】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/rules.py（target_stage）、app/stations/runner.py

目标：出问题只重跑该站及其下游，不整链重来；上限 2 次，超限进人工队列。

要做：
1. 新建 app/reflow.py：
   - 输入 rule_report + 当前 plan，输出 rerun 计划：从最小 target_stage 开始，重跑到 compile
   - 同一 run 内重试计数，超过 2 次 → 写 blocked/<run_id>.json 并标 manual_queue=true
2. 重跑复用已成功的上游产物（读 checkpoint），不得重复调用模型；若上游产物缺失，降级为整链重跑并记录原因。
3. tests/test_reflow.py：注入 scope 缺条件 → 只重跑 scope → compile，evidence 调用次数不变。

不要做：
- 不做并行重跑
- 不做人工界面
- 不改 job 事件格式

验收：
  python -m unittest tests.test_reflow -q        # 期望 OK
  python -m unittest discover -s tests -q        # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### P · HTML 渲染　`🟡 部分`　`前置：O`

**交付**：`app/render.py`（增强）、`app/templates/`、`tests/test_render.py`

```text
【P · HTML 渲染】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/render.py、app/compose.py（已有速览与证据表）

目标：把通过门禁的卡片渲染成单文件 HTML，零外链、离线可读、表格与引用样式正确。

要做：
1. 新建 app/templates/pack.html：内联 CSS，浅色系，适合阅读与打印；无任何 <script> 与外链资源。
2. 模板分区：标题 / 元信息（模型、成本、评审状态）/ 三层摘要 / 支持卡 / 反证卡 / 条件卡 / 锚点索引。
3. render.py 提供 render_pack(paper, cards, claims, manifest_like) → str。
4. 锚点渲染规则：页码链接用 file:// 绝对路径 + #page=N；无源文件时降级为"第 N 页 + 摘句"。
5. tests/test_render.py：断言输出含 <table>、不含 http(s):// 外链、每条卡都有页码。

不要做：
- 不引入模板引擎（Jinja2 等）
- 不写 JS
- 不做深色主题切换

验收：
  python -m unittest tests.test_render -q        # 期望 OK
  python -c "from app.render import render_pack; print(len(render_pack(...)))"   # 可运行

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### Q · 打包与 manifest　`⬜ 待做`　`前置：P`

**交付**：`app/package.py`、`GET /api/papers/{id}/package`、`tests/test_package.py`

```text
【Q · 打包与 manifest】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/architecture-brief.md §1（S6）、docs/model-routing.md §5（可观测）

目标：出一个自包含 zip，manifest 能回答"用什么模型、花多少钱、覆盖到哪"。

要做：
1. 新建 app/package.py：build_package(store, paper_id) → Path
   zip 内容：index.html、notes/<id>.md、anchors.json、manifest.json。
2. manifest 字段严格按 docs/schema-v1.md：schema/generated_at/paper/artifacts[]/model/prompts/coverage/human_signoff。
   - model 取自 run log 的 usage（含 calls、cost_usd、by_role）
   - prompts 取 sha256(app/prompts.py)
   - coverage 写：段落数、论断数、by_status、unverified 锚点数、空页列表
3. 打包前校验：manifest 字段缺一 → 拒绝打包并报缺失字段名。
4. API：POST /package 构建，GET /package 下载最新包；前端按钮后置（W 卡）。
5. tests/test_package.py：解压断言四个成员存在；篡改 manifest 缺字段 → 拒绝。

不要做：
- 不把 PDF 打进包
- 不做增量包
- 不改笔记内容

验收：
  python -m unittest tests.test_package -q       # 期望 OK
  python -c "from app.package import build_package; print(build_package(...))"

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### R · 引注生成　`⬜ 待做`　`前置：Q`

**交付**：`app/citation.py`、`app/templates/citation/*.json`、`tests/test_citation.py`

```text
【R · 引注生成】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/knowledge-base.md §6、app/compose.py

目标：文末参考文献与脚注格式由代码拼装，不交给模型。

要做：
1. 新建 app/citation.py：format_entry(paper, style) → str，支持 gb7714 与 chicago 两种。
2. 模板放 app/templates/citation/{gb7714,chicago}.json，字段顺序可配置。
3. 元数据不全时输出占位 "[元数据不全：缺 DOI]"，不猜、不省略。
4. 同一文献多次引用生成短格式（作者+年份+页码）。
5. tests/test_citation.py：3 条已知元数据 → 与手工核对字符串完全一致。

不要做：
- 不做 DOI 联网补全
- 不支持 MLA/APA（后续再加）
- 不让模型生成引注

验收：
  python -m unittest tests.test_citation -q      # 期望 OK
  python -c "from app.citation import format_entry; print(format_entry({...}, 'gb7714'))"

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### S · 论据矩阵　`⬜ 待做`　`前置：Q`

**交付**：`app/matrix.py`、`tests/test_matrix.py`

```text
【S · 论据矩阵】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/knowledge-base.md §5、app/stations/challenge.py

目标：多篇的论据卡按主张归并成三栏表：支持 / 限定 / 反证。

要做：
1. 新建 app/matrix.py：build_matrix(cards_by_paper) → rows[]
   row = {claim_key, claim_text, support[], qualify[], counter[]}
2. 归并键：claim_text 归一化后做相似度（>0.8 视为同一主张），不引入模型。
3. 对立检测：同一 claim_key 下同时存在支持与反证 → 标 conflict=true，渲染时必须并列，不得只留一方。
4. tests/test_matrix.py：两篇冲突样本 → 一行、conflict=true、两侧都有卡。

不要做：
- 不让模型判断"是否同一主张"
- 不做跨语言归并
- 不改卡片结构

验收：
  python -m unittest tests.test_matrix -q        # 期望 OK
  python -c "from app.matrix import build_matrix; print(len(build_matrix([])))"

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### T · 知识库 L0 入库　`⬜ 待做`　`前置：D`

**交付**：`app/kb/ingest.py`、`app/kb/chunk.py`、`tests/test_kb_ingest.py`

```text
【T · 知识库 L0 入库】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/knowledge-base.md §2（切块）、§7（规模）

目标：批量入库只做索引，0 次模型调用；切块分学科，chunk 不跨页。

要做：
1. 新建 app/kb/chunk.py：
   - split(pages, discipline) → chunks[]
   - 理工：按 Introduction/Methods/Results/Discussion 标题
   - 人文：按小节标题（一、二 / I. II.）→ 段落组 600–1200 字 → 10% 重叠
   - 兜底：固定窗口，绝不跨页
   - 每个 chunk 必须带 page、section、kind(text|note|caption)、char_start、char_end
2. 新建 app/kb/ingest.py：batch_ingest(paths) → 逐篇解析、切块、写 chunks 表、建 FTS5 索引；
   幂等（同 sha256 跳过），失败记 quarantine，不中断整批。
3. FTS5 虚表 chunks_fts(content=chunks)，触发器同步。
4. tests/test_kb_ingest.py：10 篇样例入库；断言 chunk 全部不跨页；FTS5 能搜到已知句。

不要做：
- 不做 embedding（下一卡）
- 不调用任何模型
- 不做 OCR

验收：
  python -m unittest tests.test_kb_ingest -q     # 期望 OK
  python -c "import sqlite3; print(sqlite3.connect('workspace/ledger.db').execute('select count(*) from chunks').fetchone())"

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### U · 知识库检索　`⬜ 待做`　`前置：T`

**交付**：`app/kb/search.py`、`tests/test_kb_search.py`

```text
【U · 知识库检索】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/knowledge-base.md §3（检索）、§4（锚点化）

目标：FTS5 粗排 + 向量精排 + 元数据过滤 + RRF 融合；命中必须可锚点化。

要做：
1. 新建 app/kb/search.py：search(query, filters, top_k=20)
   - 粗排：FTS5 取 top 200
   - 精排：对 200 条算余弦（向量存 BLOB，纯 Python 实现，不引入 numpy）
   - 过滤：年代 / 学科 / 语言（字段缺失则跳过该过滤）
   - 融合：RRF，k=60
2. 每条命中返回 {chunk_id, paper_id, page, text, anchor:{quote, verified}}；
   锚点化：用 grounding.locate 在页文本中定位摘句，失败标 verified=false。
3. 结果中 verified=false 的片段只能展示，不得进入写作（由调用方遵守，本卡只打标）。
4. tests/test_kb_search.py：查询已知句 → top1 命中该 chunk；构造不可定位片段 → verified=false。

不要做：
- 不引入向量数据库（FAISS/Milvus）
- 不做 LLM 重排
- 不改 chunks 表结构

验收：
  python -m unittest tests.test_kb_search -q     # 期望 OK
  python -c "from app.kb.search import search; print(len(search('熵', {}, 5)))"

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### V · L1 速览　`⬜ 待做`　`前置：U`

**交付**：`app/kb/brief.py`、`tests/test_brief.py`

```text
【V · L1 速览】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/knowledge-base.md §1（三级入库）

目标：对检索命中的候选集做速览，一篇一次调用，产出决策依据。

要做：
1. 新建 app/kb/brief.py：brief(paper_id) → {one_line, points[], numbers[], anchors[]}
   - 只读该论文的 chunks（不需要全文）
   - 每条要点必须带 anchor_id；无法定位的要点丢弃并计数
2. 批量 brief(paper_ids) 串行执行，受预算护栏约束（复用 models.Ledger）。
3. 结果写 workspace/kb/briefs/<paper_id>.json，幂等。
4. tests/test_brief.py：mock 后端下 3 篇候选生成速览，断言要点均带 anchor_id。

不要做：
- 不做 L2 精读（走六站）
- 不一次性摘要全库
- 不合并多篇

验收：
  python -m unittest tests.test_brief -q         # 期望 OK
  python -m unittest discover -s tests -q        # 全绿

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### W · 前端看板　`🟡 部分`　`前置：J`

**交付**：`web/app.js`、`web/style.css`、`web/index.html`

```text
【W · 前端看板】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：web/index.html、web/app.js、docs/architecture-brief.md §1

目标：界面体现"论据在成型"，不是"Agent 在思考"。

要做：
1. 六站灯：拆解 / 取证 / 质疑 / 划界 / 对账 / 编译，状态 pending|running|done|failed|skipped，显示耗时。
2. 卡片三栏：支持 / 反证 / 条件，各自可折叠；每张卡显示页码、摘句、状态徽章。
3. 页头显示：本次档位、模型（几个角色分别用什么）、已花费金额。
4. 导出按钮 → POST /package → 下载 zip。
5. 无 JS 构建步骤；沿用现有原生 JS 与深色样式。

不要做：
- 不引入 React/Vue
- 不做登录
- 不改 API 契约

验收（手动走查清单）：
  □ 上传后六站灯依次点亮
  □ 三栏卡片数量与日志一致
  □ 成本显示与 log.usage.cost_usd 一致
  □ 导出后 zip 可解压、index.html 可读

回报：截图或走查清单勾选 + 本次没做什么。
```

---

### X · 金标与错误注入　`🟡 部分`　`前置：J`

**交付**：`tests/golden/`、`tests/test_golden.py`、`tests/test_injection.py`

```text
【X · 金标与错误注入】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：tests/fixtures/sample.pdf、app/rules.py

目标：把"质量"变成可回归的数字，而不是感觉。

要做：
1. tests/golden/sample.json：对 sample.pdf 手工标 10 条金标（quote + claim + kind）+ 3 条反例
   （反例是"看起来像原文但被改写过"的句子）。
2. tests/test_golden.py：跑 S2，断言召回 ≥8/10、反例 0 误报。允许漏，不允许编。
3. tests/test_injection.py：三类注入。
   - 编造引文：把 quote 改一个数字 → 期望 R2 拦截
   - 页码超界：page = 99 → 期望 R1 拦截
   - 条件缺失：删掉 conditions → 期望 R5 拦截
4. 每个注入用例断言 target_stage 正确。

不要做：
- 不改提示词去"凑"指标
- 不跳过失败用例
- 不用真实 API

验收：
  python -m unittest tests.test_golden -q        # 召回 ≥8，误报 0
  python -m unittest tests.test_injection -q     # 3 类全拦截

回报：diff 摘要 + 两条命令退出码 + 本次没做什么。
```

---

### Y · 断点续跑与性能　`⬜ 待做`　`前置：X`

**交付**：`app/checkpoint.py`、`tests/test_resume.py`、`docs/perf.md`

```text
【Y · 断点续跑与性能】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：app/stations/runner.py、app/reflow.py、docs/architecture-brief.md

目标：进程被杀之后能接着跑；单篇耗时可控。

要做：
1. 新建 app/checkpoint.py：每站结束写 workspace/runs/<run_id>/<station>.json，
   内容含 inputs_hash、outputs_hash、elapsed_ms、model。
2. 启动时若检测到未完成的 run，允许 --resume <run_id>：已完成站直接跳过。
3. 记录每站耗时到 log.perf；超过阈值（单站 90s）打 warning，不中断。
4. tests/test_resume.py：模拟第 4 站失败 → 续跑 → 断言前 3 站未再次调用。
5. 输出 docs/perf.md：样本论文的各站耗时基线。

不要做：
- 不做分布式
- 不做任务队列
- 不动已通过的站

验收：
  python -m unittest tests.test_resume -q        # 期望 OK
  python run.py --resume <run_id>                # 只跑未完成站

回报：diff 摘要 + 退出码 + 本次没做什么。
```

---

### Z · 交付收口　`⬜ 待做`　`前置：全部`

**交付**：`README.md`（终稿）、`docs/demo-script.md`、`docs/acceptance.md`

```text
【Z · 交付收口】

仓库：D:/Code/GitHub Projects/AgentFlow
先读：docs/ 下全部文档、README.md

目标：让一个没参与开发的人，能按文档在 10 分钟内跑起来并验收。

要做：
1. README 终稿：定位一句话、六站图、快速开始（3 条命令）、配置（models.local.toml）、
   产物说明（zip 结构）、已知边界（不做的五件事）。
2. docs/demo-script.md：30 秒演示脚本五步 + 三句翻车台词（网络断 / 模型限流 / 扫描件）。
3. docs/acceptance.md：12 条可勾选的人工验收清单。
4. 跑一遍冷启动：删 workspace → 安装 → 上传 → 出包，记录实际耗时与遇到的坑。

不要做：
- 不为演示修改业务代码
- 不隐藏失败路径
- 不写"即将支持"的功能

验收：
  按 acceptance.md 逐条勾选，全部通过；冷启动记录写进 README。

回报：勾选清单 + 冷启动耗时 + 本次没做什么。
```

---

## 3. 与实际排期的对应

| 阶段 | 卡片 | 说明 |
| --- | --- | --- |
| 第 1 周 D1 | A、B | 契约与骨架，**A 卡不冻结就不要开 B** |
| 第 1 周 D2 | C、D、E | 地基与取证 |
| 第 1 周 D3 | F、G | 缓存与单站重跑 |
| 第 1 周 D4 | H、I、J | 三站并行 |
| 第 1 周 D5 | K、L、M | 大脑、档位、门禁 |
| 第 2 周 | N、O、P、Q | 评审、回流、渲染、打包 |
| 第 2 周（并行支线） | T、U、V | 知识库 L0 → 检索 → 速览 |
| 第 3 周 | R、S、W、X、Y、Z | 引注、矩阵、界面、回归、续跑、交付 |

> 26 张卡不适合压进 5 天。5 天只覆盖 A–M（可演示的最小闭环），其余按上表滚动。
> 如果时间被砍，优先保 A–J：没有三站并行和门禁，后面的卡都是摆设。

---

## 4. 使用这条链的三条纪律

1. **一次一卡。** 两卡合并喂给 Agent，范围必然串，验收也无法判定。
2. **没有退出码就是没做完。** "应该可以了"不算交付。
3. **卡住了往回退，不要往前补。** 若某卡的验收不过，先回退该卡改动，不要在下一卡里"顺手修好"——那会把两个契约搅在一起。
