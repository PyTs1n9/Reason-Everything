# AgentFlow · 表里有据（2026 Qoder 高校创造力大赛 · StudyHack）

当前唯一开发产品：**`sites/`**——Qoder Sites 交付形态（静态前端 + Edge Function + 托管数据库）。

用户流程：学生建项目 → 输入一条关于实验的归因主张 → 确认想回答的范围 → 导入训练记录 →
程序搜索已经跑过的可比对照 → 已有对照就计算，缺配置就追问，缺实验就生成一张具体的补跑单 →
大模型根据这些证据写分析 → 网页画对照矩阵 → 下次把新结果补到同一个问题下，生成新的分析版本，可查看旧版。

## 快速开始

工作目录是 `sites/`，命令一律在 `sites/` 下执行：

```bash
cd sites
npm test        # node --test 直接执行 TS，离线零依赖；Node >= 22.18
```

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
