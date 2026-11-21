// 持久化适配器真实刷新测试：写入 → location.reload() → 再写 → 再刷新 → 读回。
// 数据走 IndexedDB（本机保存），每步都是一次真实页面重载。
import { previewImport } from "./src/experiment/import.js";
import { conclusionsFromPackage } from "./src/experiment/evidence.js";
import { createDataService } from "./src/experiment/storage.js";
import { createIndexedDBBackend, LOCAL_STORAGE_LABEL } from "./src/experiment/storage-indexeddb.js";
import { demoQuestion } from "./tests/fixtures/experiment-demo.js";

const backend = createIndexedDBBackend(indexedDB, "agentflow-harness");
const svc = createDataService(backend);
const ACTOR = { userId: "harness-user" };
const T0 = "2026-11-21T12:00:00.000Z";

const HEADER = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy";
const CSV_INITIAL = [
  HEADER,
  "R01,M1,S1:v1,7,0.001,off,adam,20,80",
  "R02,M1,S1:v1,7,0.01,on,adam,20,82",
].join("\n");
const CSV_R03 = [HEADER, "R03,M1,S1:v1,7,0.01,off,adam,20,81.8"].join("\n");
const IMPORT_OPTS = { projectId: "p_demo", source: "demo", importedAt: T0 };

const out = document.getElementById("out");

async function importCsv(csv, now) {
  const preview = previewImport(csv, {
    ...IMPORT_OPTS,
    existingRuns: await svc.listRuns(ACTOR, "p_demo"),
  });
  if (preview.blocking) throw new Error(JSON.stringify(preview.errors));
  return svc.confirmImport(ACTOR, { projectId: "p_demo", runs: preview.added, now });
}

function evidenceRunIdsOf(pkg) {
  return pkg.pairs.flatMap((p) => [p.treatedRunId, p.controlRunId]);
}

function revisionFrom(revisionId, parentId, claim, runs, pkg) {
  return {
    revisionId,
    questionId: "q_0001",
    parentId,
    createdAt: T0,
    inputSnapshot: { claim, runs },
    conclusions: conclusionsFromPackage(pkg),
    evidenceRefs: evidenceRunIdsOf(pkg).map((runId) => ({ runId, projectId: "p_demo" })),
    suggestions: pkg.suggestions.map((s) => s.text),
    modelOutput: "pending",
  };
}

async function main() {
  const snap = await backend.read(ACTOR);
  const claim = demoQuestion.confirmedClaim;

  if (!snap.projects.some((p) => p.projectId === "p_demo")) {
    await svc.createProject(ACTOR, "本机保存演示", T0, "p_demo");
    const added = await importCsv(CSV_INITIAL, T0);
    await svc.createQuestion(ACTOR, {
      questionId: "q_0001",
      projectId: "p_demo",
      rawClaim: demoQuestion.rawClaim,
      confirmedClaim: claim,
      now: T0,
    });
    const pkg = await svc.verifyQuestion(ACTOR, "q_0001");
    const v1 = revisionFrom("rev_0001", null, claim, added, pkg);
    await svc.createRevision(ACTOR, {
      revision: v1,
      idempotencyKey: "k1",
      expectedParentId: null,
      now: T0,
    });
    out.textContent = JSON.stringify({ step: 1, label: LOCAL_STORAGE_LABEL, note: "V1 已写入，刷新中" });
    location.reload();
    return;
  }

  if (snap.runs.length < 3) {
    await importCsv(CSV_R03, T0);
    const pkg = await svc.verifyQuestion(ACTOR, "q_0001");
    const allRuns = await svc.listRuns(ACTOR, "p_demo");
    const v2 = revisionFrom("rev_0002", "rev_0001", claim, allRuns, pkg);
    await svc.createRevision(ACTOR, {
      revision: v2,
      idempotencyKey: "k2",
      expectedParentId: "rev_0001",
      now: T0,
    });
    out.textContent = JSON.stringify({ step: 2, label: LOCAL_STORAGE_LABEL, note: "V2 已写入，刷新中" });
    location.reload();
    return;
  }

  const versions = await svc.listRevisions(ACTOR, "q_0001");
  const v1 = await svc.getRevision(ACTOR, "q_0001", "rev_0001");
  const projects = await svc.listProjects(ACTOR);
  const report = {
    adapter: LOCAL_STORAGE_LABEL,
    flow: "write -> reload -> write -> reload -> read",
    projects: projects.length,
    questions: (await svc.getQuestion(ACTOR, "q_0001")) ? 1 : 0,
    revisions: versions.length,
    versionIds: versions.map((r) => r.revisionId),
    v1Parent: v1.parentId,
    v1SnapshotRuns: v1.inputSnapshot.runs.length,
    v1StillShowsMissing: v1.conclusions.some((c) => c.result === "insufficient_data"),
    ok:
      projects.length === 1 &&
      versions.length === 2 &&
      v1.parentId === null &&
      v1.inputSnapshot.runs.length === 2,
  };
  out.textContent = JSON.stringify(report, null, 2);
}

main().catch((error) => {
  out.textContent = JSON.stringify({ error: String((error && error.stack) || error) });
});
