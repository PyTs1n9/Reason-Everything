# 5 天开发计划 · 双人分工

> 团队：**A（工程）** 负责编排、并发、校验、打包、接口；**B（契约与质量）** 负责 schema、提示词、判定细则、夹具、评测。
> 目标：把现有**五节点**代码演进为**六站**工作流，D5 产出可交付的精读包。
> 一条总规则：**B 的每条判定必须能被 A 写成断言；A 的每一站必须能被命令行验收。**

---

## 0. 起点盘点

| 已有 | 位置 | 谁接着做 |
| --- | --- | --- |
| PDF 解析、哈希、页文本 | `app/ingest.py` | A → S1 |
| 归一化、引文定位、字符偏移 | `app/grounding.py` | A → 锚点定位 |
| 抽卡结构校验 + 回查 + `anchor_id` | `app/cards.py` | A → S2 校验层，B → 判定细则 |
| 四态审计协议 | `app/audit.py` | A → S5 模型复核 |
| 五节点编排、门禁、`blocked/` | `app/pipeline.py` | A → 重排为六站 |
| SQLite 台账、工作区目录 | `app/store.py` | A → 加 2 张表 |
| FastAPI + 单页前端 | `app/api.py`、`web/` | A → 接口与站点灯 |
| 25 项离线测试 | `tests/` | A 保持全绿，B 补充夹具 |

**缺口**：六站拆分、S3 质疑、S4 划界、缓存、单站重跑、规则引擎、打包器、站点级事件。

---

## 1. 分工边界

| | A | B |
| --- | --- | --- |
| 管 | 状态机、并发、缓存、规则引擎、打包、API、前端 | schema、提示词与版本、判定细则、夹具、金标、评测、文档 |
| 不管 | 提示词措辞、判定标准的合理性 | 数据库表结构、并发与重试、接口路由 |

**目录边界**：A 不碰 `prompts.py`，B 不碰 `app/stations/`。接口只认 `schemas.py`，口头约定在 D3 一定失效。

---

## 2. 五天总览

| 天 | A（工程） | B（契约与质量） | 汇合点 | 当天验收 |
| --- | --- | --- | --- | --- |
| D1 | 六站骨架 + 事件统一 | schema v1 + 三类夹具 | 17:00 冻结会 | 六站空跑，旧测试全绿 |
| D2 | 取证站 + 缓存 + 单站重跑 | 取证提示词 + 10 条金标 | 18:00 金标回归 | ≥10 张卡，定位率 100% |
| D3 | 三站并行 + 失败隔离 | 质疑/划界提示词 + 维度表 | 18:00 边界用例 | 单站超时不影响其余两站 |
| D4 | 规则引擎 + 门禁 + 打包 | 评审提示词 + 3 类注入清单 | 17:00 注入演练 | 3 类错误全拦截，zip 可读 |
| D5 | 断点续跑 + 性能 + 修 bug | 10 篇评测 + 演示脚本 | 16:00 彩排 | 全链演练 3 次通过 |

**运行节奏**：B 上午交付"标准"，A 下午交付"实现"，当天晚上联合验收。任何一天这个节奏断了，第二天必然返工。

```
D1  B:schema ──→ A:schemas.py ──→ A:六站骨架
D2  B:取证提示词 ──→ A:取证站 ──→ 金标回归
D3  B:质疑/划界标准 ──→ A:并行执行 ──→ 边界用例
D4  B:规则与注入清单 ──→ A:规则引擎 ──→ A:打包
D5  B:评测 ──→ A:修 bug ──→ 联合彩排
```

---

## 3. 逐日计划

### D1 · 契约与骨架

| 时段 | 负责 | 任务 | 交付物 |
| --- | --- | --- | --- |
| 上午 | B | 定义 `ClaimCard`（`kind/claim/status/anchors[]/conditions[]/reason`）、`Anchor`、`Manifest` | `docs/schema-v1.md` |
| 上午 | A | 与 B 逐字段确认后写进 `app/stations/schemas.py`，**只信这份文件** | `schemas.py` |
| 上午 | A | 定义 `Station` 协议：`name / inputs / outputs / run / failure` | `app/station.py` |
| 下午 | A | 拆六站：`S1 parse_anchor / S2 evidence / S3 challenge / S4 scope / S5 audit / S6 compile`；S3/S4 先返回空数组 | `app/stations/*.py` |
| 下午 | A | 站点事件统一为 `{station, state, detail, ms, artifact_hash}` | `app/workflow.py` |
| 下午 | B | 三类夹具：正常 2 页论文、无文字层、引文被篡改 | `tests/fixtures/*` |
| 17:00 | A+B | 冻结会，A 签字；此后改字段必须走变更记录 | 冻结记录 |

**验收**

```bash
python -m unittest discover -s tests -q      # 旧 25 项 + 新增骨架 ≥3 项，全绿
python run.py                                 # 上传后事件流出现 6 个 station
```

> 判定：六站全部走完，S3/S4 输出 `[]` 并记 `not_implemented`，链路不中断。

### D2 · 取证站（S2）

| 时段 | 负责 | 任务 | 交付物 |
| --- | --- | --- | --- |
| 上午 | B | 取证提示词 v1：只抽支持性主张，覆盖方法/结果/数字各 ≥1，禁止改写翻译补全 | `prompts.py`（`EVIDENCE_*`） |
| 上午 | B | 定义"定位成功"：NFKC + 去软连字符 + 去空白后逐字匹配，与 `grounding.py` 对齐 | 判定细则 |
| 下午 | A | 接入提示词；解析→结构校验→回查三段不变，只换提示词版本 | `stations/evidence.py` |
| 下午 | A | 缓存：键 = `paper_sha + prompt_module_sha + 页范围`，命中则 0 次模型调用 | `app/cache.py` |
| 下午 | A | 单站重跑：`POST /api/papers/{id}/run` 支持 `only=evidence` | `api.py` |
| 下午 | B | 金标：sample 论文手工标 10 条 + 3 条反例（看似原文实则改写） | `tests/golden/*` |

**验收**

```bash
python -m unittest tests.test_golden -q                 # 召回 ≥8/10，反例误报 0
curl -s -X POST "127.0.0.1:8765/api/papers/<id>/run" -d '{"only":"evidence"}'
```

> 判定：卡片 ≥10 张；`verified / total = 100%`（失败项必须显式标 `unverified`，不允许静默丢弃）；
> 第二次运行 `cache_hit=true` 且 `model_calls=0`。**允许漏，不允许编。**

### D3 · 质疑（S3）+ 划界（S4）

| 时段 | 负责 | 任务 | 交付物 |
| --- | --- | --- | --- |
| 上午 | B | 质疑提示词：从 Discussion/Limitations 抽局限、反常、未解释；≥1 条，抽不到输出 `missing` | `prompts.py`（`CHALLENGE_*`） |
| 上午 | B | 禁止项写死：不得用常识补局限，不得把"作者没提"写成"作者认为" | 判定细则 |
| 上午 | B | 维度表：样本量/人群/任务/模型/数据集/时长/剂量/地域 + 可用句式模板 | `docs/scope-dimensions.md` |
| 下午 | A | 三站并行：`ThreadPoolExecutor(max_workers=3)`；单站抛错只标记该站 | `stations/runner.py` |
| 下午 | A | 合并顺序固定（支持→反证→条件），同一 anchor 只保留一条 | 同上 |
| 下午 | A | S3 存在性校验、S4 清单校验；链路状态支持 `partial` | `stations/*.py` |
| 下午 | B | 边界用例 3 份：综述型（无原创局限）、纯方法（无条件）、多条件 | `tests/fixtures/edge-*` |

**验收**

```bash
STUB_SCOPE_TIMEOUT=1 python run.py            # S4 超时，S2/S3 仍产出
python -m unittest tests.test_scope -q        # 每张卡 ≥1 维度或 scope_unknown
```

> 判定：S3 每篇 ≥1 条反证或显式 `missing`；S4 每张支持卡 ≥1 维度或 `scope_unknown`；单站超时不影响其余两站。

### D4 · 对账（S5）+ 编译（S6）

| 时段 | 负责 | 任务 | 交付物 |
| --- | --- | --- | --- |
| 上午 | B | 模型评审提示词：四态 + `reason` + `target_stage`，**只能降级** | `prompts.py`（`REVIEW_*`） |
| 上午 | B | 覆盖声明文案：审过哪些段、多少 `unverified`、哪些页无文字 | 文案定稿 |
| 上午 | A | 规则引擎 8 条：页码、引文可定位、字段齐全、图注、条件必填、占位符、字数、锚点唯一 | `app/rules.py` |
| 上午 | A | 门禁三态 + `target_stage` 路由（哪站出问题回哪站） | `rules.py` |
| 下午 | B | 3 类错误注入清单，写明"在哪站被拦、报什么错、回哪站" | `docs/injection-cases.md` |
| 下午 | A | 打包器：`zip(index.html, notes/, anchors.json, manifest.json)`，HTML 内联零外链 | `app/package.py` |
| 下午 | A | `GET /api/papers/{id}/package`；manifest 写哈希、模型、提示词哈希、覆盖范围 | `api.py` |

**验收**

```bash
python -m unittest tests.test_rules -q        # 3 类注入错误 100% 拦截
```

> 判定：编造引文 / 页码超界 / 条件缺失三类全被拦且 `target_stage` 正确；
> zip 解压后 `index.html` 双击可读、无外部请求；manifest 字段齐全。

### D5 · 联调与交付

| 时段 | 负责 | 任务 | 交付物 |
| --- | --- | --- | --- |
| 上午 | A | 断点续跑：失败后重跑只走失败站；单篇 ≤3 分钟（mock ≤10 秒） | 测试 + 性能记录 |
| 上午 | B | 10 篇样本评测：定位率、卡片覆盖、质疑覆盖、误报率 | `docs/eval-report.md` |
| 上午 | B | 评测结论回写提示词（只改约束，不改 schema），版本 +1 | 提示词 v2 |
| 下午 | A | 全链演练 3 次（正常 / 半失败 / 全失败），修边界 bug | 演练记录 |
| 下午 | B | 演示脚本（5 步）+ 翻车台词（网络断、模型限流、扫描件） | `docs/demo-script.md` |
| 16:00 | A+B | 彩排 | 可演示状态 |

**验收指标**

| 指标 | 目标 | 责任 |
| --- | --- | --- |
| 锚点定位率 | 100%（失败须标 `unverified`） | A + B |
| 支持卡覆盖 | 每篇方法/结果/数字各 ≥1 | B |
| 质疑覆盖 | 每篇 ≥1 条或显式 `missing` | B |
| 评审误报率 | ≤5% | B |
| 金标回归 | 召回 ≥8/10，反例 0 误报 | B |
| 单篇耗时 | ≤3 分钟（mock ≤10 秒） | A |

---

## 4. 交付规约（每张任务卡）

1. 附 `git diff`，不接受口头描述
2. 附可直接粘贴的验收命令与**退出码**
3. 附一句话"本次没做什么"
4. 改了 `schemas.py` 必须单独标出并 @对方

---

## 5. 协作规则

| 规则 | 原因 |
| --- | --- |
| 每天 10:00 与 16:00 各 10 分钟对齐 | 两人项目，偏差两小时就会撞车 |
| schema 变更当天同步 | 隔夜就返工 |
| 提示词改动必须升版本号 | A 的缓存键包含提示词模块哈希，偷偷改会返回旧结果 |
| 提示词禁止出现"尽量/适当/合理" | 无法验收的约束等于没写 |
| 任何临时绕过写进 `docs/tech-debt.md` | 5 天后要交付，欠账要可见 |
| 评测数据与结论必须留原始输出 | 没有原始输出就无法复核 |

---

## 6. 风险与预案

| 风险 | 责任 | 触发信号 | 预案 |
| --- | --- | --- | --- |
| schema 未冻结 | A+B | D1 17:00 还在改字段 | 砍 `conditions[]` 嵌套，先上一维数组 |
| schema 过度设计 | B | D1 字段超 15 个 | 同上 |
| 模型输出不稳定 | B | D2 解析失败率 >20% | 降到"先出 5 张卡"，其余补抽 |
| 并行状态错乱 | A | D3 出现卡片串篇 | 退回串行，用时间换正确性 |
| 提示词改了没效果 | B | 指标不动 | 先分清是"抽取失败"还是"回查失败" |
| 质疑站变编造站 | B | 出现原文没有的局限 | 降级为只抽含 limitation 关键词的句子 |
| 打包出不来 | A | D4 下午未跑通 | 先出 md + anchors.json，HTML 降级为 `<pre>` |
| 时间不够 | A+B | D5 上午仍有 P0 bug | 砍演示第 4、5 步，保住"上传→卡片→跳转" |

---

## 7. 每日站会三问（各 1 分钟）

1. 昨天承诺的验收命令，退出码是 0 吗？
2. 今天要交付的东西，对方能独立验收吗？
3. 有没有哪个"临时绕过"还没记进 `tech-debt.md`？

---

## 8. 不做清单（5 天内不碰）

多篇对比与综述生成 · PDF 内高亮框选 · 账号与权限 · 论文翻译与润色 · 全自动无人工。
理由见 `architecture-brief.md` §5。
