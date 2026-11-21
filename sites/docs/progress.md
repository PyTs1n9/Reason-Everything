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
