// 正式持久化适配器（IndexedDB·本机保存）工作流级验证：
// 写入 → 真实刷新 → 追加+重复提交+旧父版本冲突 → 再刷新 → 读回计数。
// 全部经正式服务动作（createWorkflowService），不直调内部数学函数。
import { createIndexedDBBackend, LOCAL_STORAGE_LABEL } from "./src/experiment/storage-indexeddb.js";
import { createDataService } from "./src/experiment/storage.js";
import { createWorkflowService } from "./src/workflow/service.js";

const backend = createIndexedDBBackend(indexedDB, "agentflow-harness-08");
const data = createDataService(backend);

let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 21, 14, 0, 0) + ++tick).toISOString();
const wf = createWorkflowService({ storage: data, agent: null, now });
const ACTOR = { userId: "harness-user" };
const out = document.getElementById("out");

const HEADER = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy";
const CSV12 = [
  HEADER,
  "R01,M1,S1:v1,7,0.001,off,adam,20,80",
  "R02,M1,S1:v1,7,0.01,on,adam,20,82",
].join("\n");
const CSV_R03 = [HEADER, "R03,M1,S1:v1,7,0.01,off,adam,20,81.8"].join("\n");
const SENTENCE = "数据增强使准确率提高了 2 个百分点";
const PROPOSAL = {
  factor: "augmentation",
  metric: "accuracy",
  scope: null,
  expectedDeltaPp: 2,
  clarifyingQuestion: "目标学习率是哪一档，还是两档都要验证？",
};

async function previewRuns(projectId, text) {
  const preview = await wf.previewImport(ACTOR, { projectId, text, source: "demo" });
  if (preview.blocking) throw new Error(JSON.stringify(preview.errors));
  return [...preview.added, ...preview.incomplete];
}

async function main() {
  const projects = await wf.listProjects(ACTOR);

  // 步骤 1：建项目 → 确认范围 → 导入两行 → V1
  if (!projects.some((p) => p.projectId === "p_h")) {
    await wf.createProject(ACTOR, "本机保存演示", "p_h");
    await wf.createQuestion(ACTOR, {
      projectId: "p_h",
      questionId: "q_h",
      rawClaim: SENTENCE,
    });
    const confirmed = await wf.confirmScope(ACTOR, {
      questionId: "q_h",
      proposal: PROPOSAL,
      source: "manual",
      targetRunId: "R02",
      baselineRunId: "R01",
      scope: "target_lr",
      learningRates: [0.001, 0.01],
    });
    if (!("question" in confirmed)) throw new Error(JSON.stringify(confirmed));
    await wf.commitImport(ACTOR, { projectId: "p_h", runs: await previewRuns("p_h", CSV12) });
    const v1 = await wf.analyze(ACTOR, { requestId: "req-h1", questionId: "q_h" });
    if (v1.gated) throw new Error("gated unexpectedly");
    out.textContent = JSON.stringify({ step: 1, label: LOCAL_STORAGE_LABEL, note: "V1 已写入，刷新中" });
    location.reload();
    return;
  }

  const versions = await wf.listRevisions(ACTOR, "q_h");

  // 步骤 2：真实刷新后追加 R03 → V2；重复提交幂等；旧父版本冲突
  if (versions.length < 2) {
    const incoming = await previewRuns("p_h", CSV_R03);
    const v2 = await wf.appendRunsAndReanalyze(ACTOR, {
      requestId: "req-h2",
      questionId: "q_h",
      runs: incoming,
    });
    if (v2.gated) throw new Error("gated unexpectedly");

    const dup = await wf.analyze(ACTOR, { requestId: "req-h1", questionId: "q_h" });
    let staleBlocked = false;
    try {
      await wf.analyze(ACTOR, {
        requestId: "req-h3",
        questionId: "q_h",
        expectedParentId: null,
      });
    } catch (error) {
      staleBlocked = String(error && error.message).includes("过期父版本");
    }
    out.textContent = JSON.stringify({
      step: 2,
      label: LOCAL_STORAGE_LABEL,
      duplicate: dup.gated ? "gated" : dup.duplicate,
      staleBlocked,
      note: "V2/重复/冲突已记录，刷新中",
    });
    location.reload();
    return;
  }

  // 步骤 3：读回计数与历史（只读，不再写入）
  const finalVersions = await wf.listRevisions(ACTOR, "q_h");
  const v1 = await wf.getRevision(ACTOR, "q_h", finalVersions[0].revisionId);
  const { job, events } = await wf.getJob(ACTOR, "req-h1");
  const question = await data.getQuestion(ACTOR, "q_h");
  const finalProjects = await wf.listProjects(ACTOR);
  const report = {
    adapter: LOCAL_STORAGE_LABEL,
    flow: "workflow write -> reload -> append+duplicate+stale -> reload -> read",
    projects: finalProjects.length,
    questions: question ? 1 : 0,
    revisions: finalVersions.length,
    versionIds: finalVersions.map((r) => r.revisionId),
    v1Parent: v1.parentId,
    v1SnapshotRuns: v1.inputSnapshot.runs.length,
    v1StillShowsMissing: v1.conclusions.some((c) => c.result === "insufficient_data"),
    job: { id: job.jobId, status: job.status, revisionId: job.revisionId },
    events: events.length,
    ok:
      finalProjects.length === 1 &&
      finalVersions.length === 2 &&
      v1.parentId === null &&
      v1.inputSnapshot.runs.length === 2 &&
      job.revisionId === finalVersions[0].revisionId &&
      events.length >= 6,
  };
  out.textContent = JSON.stringify(report, null, 2);
}

main().catch((error) => {
  out.textContent = JSON.stringify({ error: String((error && error.stack) || error) });
});
