# AgentFlow · 本地研究工作台

本目录是唯一交付物：静态前端 + 本机同源 Node 服务。研究数据保存在当前浏览器的
IndexedDB；模型服务配置与 API Key 由本机服务端加密保存。模型 API 支持本机服务与
公网 HTTPS 云服务，不依赖 Deno Edge Function、托管数据库或平台 Secret。

根目录的 Python 黄金实现（`app/` 等）已退役并归档到项目外，只作逐字节对齐参照，
归档路径见 `docs/progress.md`。

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
tests/          离线用例，零第三方依赖，模型调用全部使用 mock
```

## 运行

```bash
npm test          # node --test，直接执行 .ts，无需构建
npm run verify:flow
npm run build:web
node scripts/serve-web.mjs
```

要求 Node ≥ 22.18（内置类型剥离）。测试不依赖任何第三方包。启动后打开
`http://127.0.0.1:8318/web/index.html`；服务只绑定回环地址，模型上游允许本机 HTTP 与公网 HTTPS 云 API。

## PDF 文献研究

导入带文字层的 PDF 并创建项目后，工作台会在当前浏览器保存所有页的可提取文字。建项目时可选择自动生成候选问题。模型逐批阅读文字并返回待检验主张、研究价值、验证方法和 PDF 物理页码。通过原文回查的候选可编辑并确认，正式问题仍可打开引文对应页。旧 PDF 项目可补传相同文件并保留已有问题。

运行 `npm run build:web`，再用 `node scripts/serve-web.mjs` 启动本地工作台。在页面
「模型服务」中添加服务名称、Base URL 和 API Key，搜索并选择模型后，问题分析与论文
候选生成会复用同一份配置。云服务须使用公网 HTTPS 地址；私网和保留 IP 地址仍被拒绝。

浏览器只收到 `hasApiKey` 与脱敏提示。API Key 以 AES-256-GCM 密文写入
`sites/.model-keys.json`，本机密钥文件为 `sites/.agentflow-model-keys.key`，两者均已
加入 `.gitignore`。模型列表与对话请求由同源服务端转发，使用 Bearer 鉴权并阻止重定向。
直接双击静态 HTML 可以浏览已有研究数据，但不能安全保存密钥或调用模型；这两项需要
本机 Node 服务。

## 边界

- 核心计算与证据回查保持确定性；模型只解读已验证证据，不替代配对计算。
- 模型凭据不进入 localStorage、IndexedDB、Cookie、URL、日志、导出文件或静态构建产物。
- 本机服务允许回环 HTTP 上游与公网 HTTPS 云 API，拒绝公网 HTTP、私网及保留 IP 地址；
  未配置真实模型时，分析路径可由离线 mock 或独立规则报告验证。
- Windows 不完整实现 POSIX 文件权限位；凭据文件仍由本机用户账户与目录权限保护。
