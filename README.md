# AgentFlow · 研论书屋（2026 Qoder 高校创造力大赛 · StudyHack）
开发人员：GQQXCF ,PyTsING。
当前唯一开发产品：**`sites/`**——Qoder Sites 交付形态（静态前端 + Edge Function + 托管数据库）。

用户流程：学生建项目 → 输入一条关于实验的归因主张 → 确认想回答的范围 → 导入训练记录 →
程序搜索已经跑过的可比对照 → 已有对照就计算，缺配置就追问，缺实验就生成一张具体的补跑单 →
大模型根据这些证据写分析 → 网页画对照矩阵 → 下次把新结果补到同一个问题下，生成新的分析版本，可查看旧版。

## 评委 4 步上手（约 1 分钟）

站点入口：**<https://agentflow-jdu3pw2qe8r.qoder.website>**（Qoder Sites · AgentFlow；当前为受邀访问，打不开时请用受邀的 Qoder 账号登录。本机离线版见下方命令）。

1. **建项目**：打开站点 →「新建项目」（任意名称，如「演示项目」）→ 进入项目。
2. **提主张**：「新建研究问题」→ 主张原句填“数据增强使准确率提高了 2 个百分点” → 粘贴两行虚构演示数据（R01/R02，格式见页面占位提示或演示词附录）→ 基线选 R01、目标选 R02、范围选「目标学习率 0.01」→「确认后开始分析」。
3. **看缺口**：「实验对照矩阵」左下格（0.01/增强关）是**建议补跑**——复制 R02 的配置、只改增强开关；右栏「下一组实验」点「录入实测结果」→「载入演示 R03（演示）」→ 确认。
4. **看归因**：新版本里 0.01 档出现同条件配对差 **+0.20 个百分点**（与原始观测差 +2.00 个百分点分开显示）；「版本记录」切回 V1，缺口与建议原样保留。

逐字版 60 秒演示词（含数据来源标注与粘贴用 CSV 附录）见 [`sites/docs/release-12.md`](sites/docs/release-12.md)。

## 命令与平台能力

工作目录是 `sites/`，命令一律在 `sites/` 下执行（Node ≥ 22.18，零第三方依赖）：

```bash
cd sites
npm test                          # 离线测试：node --test 执行 TS，144 用例，不联网
npm run verify:flow               # 无界面演示验收：A–G 场景驱动正式服务动作
npm run build:web                 # 构建前端（改 src/ 后必须重跑，产出 web/assets/gen/）
node scripts/serve-web.mjs 8320   # 本机运行：打开 http://127.0.0.1:8320/web/index.html
```

所需平台能力：

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| Qoder Sites 静态托管 | 已启用 | 发布物为本地 `sites/web/` 构建产物 |
| 本机保存（IndexedDB） | 已启用 | 访客数据只留在各自浏览器，刷新可恢复 |
| 托管数据库（云存储） | 未启用 | 需站点后台授权 `ensure_backend`（会自动创建 QODER_PAT，需账号持有者在平台确认） |
| 真实模型调用 | 未接通 | 需部署 Sites Function 并配置模型服务 Secret；当前 AI 区如实显示「AI 未接通」，规则报告照常可用 |

## 演示数据声明

公开演示只使用**虚构的标注演示数据**：R01–R04 来自 `sites/tests/fixtures/experiment-demo.ts`（`source: "demo"`），
界面中演示数据带 ◇演示 /「演示」来源标记，可通过「载入演示 R03（演示）」显式加载。
发布物不含个人笔记、旧 PDF、数据库文件、任何凭据或原始模型日志；演示均为合成数值，不代表真实实验。

## 目录

```
sites/
  .AgentFlow.qoder.site  站点绑定元数据（内容不动）
  src/core/              TS 纯函数核心（types / grounding / cards / audit / json）
  tests/                 离线用例（零第三方依赖，不联网）
  web/                   前端与站点加载所需资源
  docs/progress.md       全局进度：交付、实测结果、下一卡、阻塞
docs/                    设计文档（契约与架构参照）
research-brief/          独立站点快照（非本比赛开发入口，保留）
```

## 旧版说明

Python 五节点版（`app/`、根层 `tests/`、`web/`、`run.py`、`requirements.txt`、
Python 配置示例、`workspace/` 运行数据）已退役：先在项目外归档并逐文件 SHA-256 核验，
再从活动项目移除。可恢复归档路径见 `sites/docs/progress.md`。

根目录只有这一个开发入口，不摆第二份运行指南；测试与运行命令以 `sites/` 为工作目录。

## 设计文档

| 文档 | 内容 |
| --- | --- |
| `docs/schema-v1.md` | 冻结的数据契约（改动须先评审，实现卡不得顺手变更） |
| `docs/architecture-brief.md` | 三段六站精简架构，每站作用与失败语义 |
| `docs/architecture-v2.md` | 完整设计：模块职责、状态机、评审规则、异常处理 |
| `docs/agent-roles.md` | 岗位分工、判定标准、禁止事项与交接契约 |
| `docs/knowledge-base.md` | 知识库设计：三级入库、检索、论据矩阵、引注 |
| `docs/model-routing.md` | 多模型路由：角色矩阵、降级链、预算护栏、成本归因 |
| `docs/build-chain-a-z.md` | A–Z 开发链路（历史计划，仅供追溯） |
| `docs/build-plan-5d.md` | 5 天双人开发计划（历史计划，仅供追溯） |
