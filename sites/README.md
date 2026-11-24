# AgentFlow · Sites 版

Qoder Sites 的原生交付形态：静态前端 + Deno Edge Function + 托管数据库。
本目录是**唯一交付物**；根目录的 Python 黄金实现（`app/` 等）已退役并归档到项目外，
只作逐字节对齐参照，归档路径见 `docs/progress.md`。

## 为什么还要和 Python 版对齐

不是怀旧，是为了可验证。TS 版每个确定性函数都要和 Python 版对同一批输入给出
同一结果；`anchor_id` 甚至要求逐字节相同的哈希输入。归档后 Python 版不在仓库里，
移植就只能靠"看起来对"——所以归档包与固定对照值必须保留。

对齐口径：

| 口径 | Python | 本实现 |
| --- | --- | --- |
| 字符串长度 / 切片 | 码点 | 码点（显式 `Array.from`） |
| 空白判定 | `str.isspace()` | `PY_SPACE_SOURCE`（含 `\x1c-\x1f`、`\x85`，不含 `\ufeff`） |
| `anchor_id` | `sha256("paper\|page\|canonical(quote)")[:8]` | 同一输入、同一截断 |
| 段落切分 | `\n\s*\n` | 同一正则，空白类按 Python 语义 |

`anchor_id` 的固定对照值写在 `tests/cards.test.ts` 里（`a_248f506e`）。
哈希口径一变，那条用例立刻失败。

## 目录

```
src/core/
  types.ts      跨层数据形状（字段名与 Python 一致，便于逐字段比对）
  grounding.ts  引文定位：NFKC、软连字符、码点偏移映射
  cards.ts      卡片结构校验 + 逐字回查 + 锚点编号
  audit.ts      四态审计协议与机械校验
  json.ts       模型输出的 JSON 解析（围栏容忍、失败即抛）
tests/          37 项离线用例，零依赖，全部不联网
```

## 运行

```bash
npm test          # node --test，直接执行 .ts，无需构建
```

要求 Node ≥ 22.18（内置类型剥离）。测试不依赖任何第三方包。

## PDF 文献研究

导入带文字层的 PDF 并创建项目后，工作台会在当前浏览器保存所有页的可提取文字。建项目时可选择自动生成候选问题。模型逐批阅读文字并返回待检验主张、研究价值、验证方法和 PDF 物理页码。通过原文回查的候选可编辑并确认，正式问题仍可打开引文对应页。旧 PDF 项目可补传相同文件并保留已有问题。

运行 `npm run build:web`，再用 `node scripts/serve-web.mjs` 启动本地工作台。论文模型使用服务端环境变量配置。

| 环境变量 | 值 |
| --- | --- |
| `AGENTFLOW_PAPER_MODEL_URL` | 兼容 Chat Completions 的完整接口地址 |
| `AGENTFLOW_PAPER_MODEL_KEY` | 服务端 API 密钥 |
| `AGENTFLOW_PAPER_MODEL_ID` | 服务商接受的模型标识 |

浏览器调用同源 `POST /functions/v1/app/paper-questions`，模型服务接收论文文字而非 PDF 文件。站点部署需要为该路径接入受站点访问控制保护的后端，并用服务端 Secret 提供上述配置。路由可复用 `src/web/paper-model-api.mjs`。纯静态部署可入库和阅读全文，模型面板会显示接口未接通。

## 边界

- 本层不做 I/O、不调用模型、不依赖运行时 API；`node:crypto` 是唯一平台依赖，
  Deno 与 Node 均原生支持。
- 模型调用、数据库、HTTP 路由在下一层（`src/functions/`），尚未实现。
- 浏览器端若需要复用回查逻辑，`grounding.ts` 可直接打包；`cards.ts` 的
  `makeAnchorId` 依赖 `node:crypto`，届时需替换为 `crypto.subtle` 的异步版本。

## 下一步

1. S2：五个节点函数（cards / note / audit / gate / archive）与模型客户端
2. S3：前端接 pdf.js 与端点，保留现有 UI
3. S4：发布到 Sites，公开访问，验收
