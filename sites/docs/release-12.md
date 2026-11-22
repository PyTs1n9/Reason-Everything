# 卡 12 · 比赛交付与发布验收（2026-11-22）

## 站点地址与类型

- **已发布**：https://agentflow-jdu3pw2qe8r.qoder.website （Qoder Sites · AgentFlow，静态托管）
- **本机**：`cd sites && node scripts/serve-web.mjs 8321` → http://127.0.0.1:8321/web/index.html（同一构建物）
- 发布物：`sites/web/` 构建（`npm run build:web` 产出 `web/assets/gen/`）；发布动作=同站更新（仅目标站点，research-brief 站未动）。

## 评委 60 秒演示词（数据来源均为标注虚构演示数据）

> 演示数据来源：`sites/tests/fixtures/experiment-demo.ts`（R01–R04，`source: "demo"`）；
> 界面内演示记录带 ◇演示 /「演示」来源标记，可显式加载。全部为合成数值，不代表真实实验。

**0–10 秒 · 输入主张**
「我用一句话提出归因主张：*数据增强使准确率提高了 2 个百分点*。接着贴进两行**虚构演示数据**：R01（增强关、lr 0.001、80.0%）和 R02（增强开、lr 0.01、82.0%）。」

**10–25 秒 · 为什么左下格待补**
「注意 R01→R02 **同时**改了学习率和增强开关——+2.00 个百分点只是观测差，算不出增强贡献。所以矩阵左下格（lr 0.01 / 增强关）显示**建议补跑**：复制 R02 的配置、只改增强开关一项。这就是系统给出的“最值得补的一组实验”。」

**25–40 秒 · 录入 R03**
「点开『下一组实验 → 录入实测结果』，实测值必须我亲手填、系统不默认任何数字；这里点**『载入演示 R03（演示）』**——81.8%，界面标 ◇演示。确认后同一问题生成新版本。」

**40–52 秒 · 单次匹配条件下的 +0.20**
「新版本里 0.01 档补全了：R02 与 R03 同条件配对，差 **+0.20 个百分点**——这与原始观测差 +2.00 个百分点在规则区**分开显示**，且每个数字都能点开证据、高亮对应两次运行。」

**52–60 秒 · 版本复核**
「版本记录切回 V1：当时的缺口和补跑建议**原样保留**，任何时候都能复核每个版本当时看到的证据。（或改范围为『两档』，看另一组待补实验。）」

### 演示数据附录（两行 CSV，粘贴用）

```csv
runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy
R01,M1,S1:v1,7,0.001,off,adam,20,80.0
R02,M1,S1:v1,7,0.01,on,adam,20,82.0
```

## Qoder 使用记录（仅列本项目真实发生项）

- **任务规划**：12 张交付卡的分解、验收与进度沉淀在 `sites/docs/progress.md`（卡 01–12）；每卡开工按 `agent.md` 做 Git 现场核对（`git rev-parse --show-toplevel` / `git status --short --branch` / `git remote -v`），收尾双推 GitHub+Gitee 并 `git ls-remote` 核对完整 SHA。
- **调试**：卡 08 修复 `node --test` 空测试集退出码为 0 的真实缺陷（改为包装入口 `scripts/run-tests.mjs`，0 文件→exit 1）；卡 10 由浏览器验收暴露并修复 7 个缺陷（抽屉挂载前空引用崩溃、重试命中幂等不重试、重渲染双矩阵、长 cellId 溢出等），修复后全部重测。
- **模型接入**：卡 06 建立 `ModelAdapter` 契约 + `MockAdapter` + `withTimeout` + 引用校验（`sites/tests/agent.test.ts` 19 例；`npm test` 现共 144 例）。真实路径经平台核对（cloudAgents `configured=true`）；因缺 QODER_PAT 明确确认与 Function 部署，AI 区如实显示「AI 未接通」，未以 mock 冒充真实输出。
- **发布**：本卡按 Sites 流程打包草稿 → 发布 → 状态核验（published=true），发布物为 `sites/web/` 构建产物；运行编号示例：回填作业 `req-fill-1795335961823`（R03→V2）、慢模型重试 `req-retry-1795336501357`、`npm run verify:flow` 的 `req-1a`/`req-5b` 场景作业。

## 验收五项

| 项 | 结果 |
| --- | --- |
| 站点地址及类型 | https://agentflow-jdu3pw2qe8r.qoder.website —— **已发布**（Qoder Sites 静态托管）；同构建物本机预览 127.0.0.1:8321 |
| 可验证的核心流程 | 主张→R01/R02→目标学习率→分析（0.01/关=建议补跑）→录入演示 R03→V2 同条件配对 **+0.20 个百分点**（与观测差 +2.00 分列）→切回 V1 缺口保留；本机同构建物全流程实测通过 |
| 真实模型状态 | **未接通**（backend=disabled、Functions 未部署、QODER_PAT 未配置）；AI 区如实显示「AI 未接通」+ 确定性规则报告照常可用；接入入口见下 |
| 存储模式与刷新验证 | **本机保存**（IndexedDB，访客数据留在各自浏览器）；实测刷新后项目/两版本/矩阵数值完整恢复 |
| 未完成项 | ① 访客端核心流程：访问范围按决定保持「仅受邀」，匿名访客到真实网址只见登录门槛页（“此站点仅向受邀用户开放”），评委需受邀 Qoder 账号；② 真实模型与云存储（见接入入口）；③ in-app 浏览器截图不可用（无可视表面），验收以 DOM 结构留证 |

### 真实模型 / 云存储接入入口（需要账号能力，无需在聊天里粘贴任何密钥）

1. 在 Qoder Desktop 打开本站点 → 站点设置（Site Settings）→ 启用后端 `ensure_backend(qoder)`：平台会**自动创建 QODER_PAT**，需要账号持有者在平台界面确认（密钥保存在平台 Secret，不进聊天、不进仓库）。
2. 部署 `functions/app`（`Deno.serve` + `/functions/v1/app` 路由），Function 内读平台 Secret 调用 `api.qoder.com/api/v1/cloud`。
3. 可选：启用托管数据库并评审 schemaRef 迁移（云存储）。接通后用固定演示句做单次真实探针并单独验收。
