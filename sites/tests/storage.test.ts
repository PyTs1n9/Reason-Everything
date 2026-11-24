import assert from "node:assert/strict";
import { test } from "node:test";

import { previewImport } from "../src/experiment/import.ts";
import { conclusionsFromPackage } from "../src/experiment/evidence.ts";
import {
  ConflictError,
  MemoryBackend,
  NotFoundError,
  createDataService,
  type Actor,
  type DataService,
} from "../src/experiment/storage.ts";
import type { AnalysisRevision, Project, TrainingRun } from "../src/experiment/types.ts";
import { demoQuestion } from "./fixtures/experiment-demo.ts";

const ALICE: Actor = { userId: "alice" };
const BOB: Actor = { userId: "bob" };

const T0 = "2026-11-21T12:00:00.000Z";
const T1 = "2026-11-21T12:01:00.000Z";
const T2 = "2026-11-21T12:02:00.000Z";
const T3 = "2026-11-21T12:03:00.000Z";
const T4 = "2026-11-21T12:04:00.000Z";

const IMPORT_OPTS = {
  projectId: "p_demo",
  source: "demo" as const,
  importedAt: T0,
};

const HEADER = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy";
const CSV_INITIAL = [HEADER, "R01,M1,S1:v1,7,0.001,off,adam,20,80", "R02,M1,S1:v1,7,0.01,on,adam,20,82"].join("\n");
const CSV_R03 = [HEADER, "R03,M1,S1:v1,7,0.01,off,adam,20,81.8"].join("\n");

function svcOf(backend: MemoryBackend): DataService {
  return createDataService(backend);
}

async function importCsv(svc: DataService, actor: Actor, csv: string, now: string): Promise<TrainingRun[]> {
  const preview = previewImport(csv, { ...IMPORT_OPTS, existingRuns: await svc.listRuns(actor, "p_demo") });
  assert.equal(preview.blocking, false, JSON.stringify(preview.errors));
  return svc.confirmImport(actor, { projectId: "p_demo", runs: preview.added, now });
}

function revisionFrom(
  revisionId: string,
  questionId: string,
  parentId: string | null,
  createdAt: string,
  claim: typeof demoQuestion.confirmedClaim,
  runs: TrainingRun[],
  conclusions: AnalysisRevision["conclusions"],
  evidenceRunIds: string[],
  suggestions: string[],
): AnalysisRevision {
  return {
    revisionId,
    questionId,
    parentId,
    createdAt,
    inputSnapshot: { claim: claim!, runs },
    conclusions,
    evidenceRefs: evidenceRunIds.map((runId) => ({ runId, projectId: "p_demo" })),
    suggestions,
    modelOutput: "pending",
  };
}

function evidenceRunIdsOf(pkg: {
  pairs: Array<{ treatedRunId: string; controlRunId: string }>;
}): string[] {
  return pkg.pairs.flatMap((p) => [p.treatedRunId, p.controlRunId]);
}

// ---------- 验收流程 ----------

test("验收流程：新建→导入两行→V1→重新进入→追加R03→V2→读V1→重复请求", async () => {
  const backend = new MemoryBackend();
  let svc = svcOf(backend);

  // 1) 新建项目
  const project = await svc.createProject(ALICE, "研论书屋 · 演示", T0, "p_demo");
  assert.equal(project.projectId, "p_demo");

  // 2) 导入两行（预览 → 确认）
  const added1 = await importCsv(svc, ALICE, CSV_INITIAL, T1);
  assert.equal(added1.length, 2);

  // 3) 问题（原句与已确认主张）
  const question = await svc.createQuestion(ALICE, {
    questionId: "q_0001",
    projectId: "p_demo",
    rawClaim: demoQuestion.rawClaim,
    confirmedClaim: demoQuestion.confirmedClaim,
    now: T1,
  });
  assert.equal(question.status, "waiting_for_run", "初始两行缺对照 → 待补");

  // 4) 保存 V1
  const pkg1 = await svc.verifyQuestion(ALICE, "q_0001");
  const v1 = revisionFrom(
    "rev_0001", "q_0001", null, T2,
    demoQuestion.confirmedClaim, added1, conclusionsFromPackage(pkg1),
    evidenceRunIdsOf(pkg1), pkg1.suggestions.map((s) => s.text),
  );
  const created1 = await svc.createRevision(ALICE, {
    revision: v1, idempotencyKey: "req-v1", expectedParentId: null, now: T2,
  });
  assert.equal(created1.created, true);

  // 5) 模拟重新进入：新建服务实例（数据经存储读回）
  svc = svcOf(backend);
  const reopenedRuns = await svc.listRuns(ALICE, "p_demo");
  assert.equal(reopenedRuns.length, 2, "重开后两行仍在");
  const reopenedQuestion = await svc.getQuestion(ALICE, "q_0001");
  assert.equal(reopenedQuestion?.currentRevisionId, "rev_0001");

  // 6) 追加 R03 → V2（同 projectId/questionId，父版本 V1）
  const added2 = await importCsv(svc, ALICE, CSV_R03, T3);
  assert.equal(added2.length, 1);
  const pkg2 = await svc.verifyQuestion(ALICE, "q_0001");
  assert.equal(pkg2.status, "waiting_for_run", "0.01 档已配对，0.001/on 仍待补");
  assert.equal(pkg2.pairs.length, 1, "已验证部分保留");
  assert.equal(pkg2.pairs[0]?.deltaPp, "+0.20");
  assert.equal(pkg2.counterexample.exists, true, "0.20 < 2 → 幅度反例已成立");
  assert.equal(pkg2.coverage.complete, false);
  const allRuns = await svc.listRuns(ALICE, "p_demo");
  const v2 = revisionFrom(
    "rev_0002", "q_0001", "rev_0001", T3,
    demoQuestion.confirmedClaim, allRuns, conclusionsFromPackage(pkg2),
    evidenceRunIdsOf(pkg2), pkg2.suggestions.map((s) => s.text),
  );
  const created2 = await svc.createRevision(ALICE, {
    revision: v2, idempotencyKey: "req-v2", expectedParentId: "rev_0001", now: T3,
  });
  assert.equal(created2.created, true);

  // 7) 再次读 V1：历史快照不被后来数据改写
  const v1Again = await svc.getRevision(ALICE, "q_0001", "rev_0001");
  assert.deepEqual(v1Again, v1, "V1 与保存时逐字节一致");
  assert.equal(v1Again?.inputSnapshot.runs.length, 2, "V1 仍是当时缺对照的两行输入");
  assert.ok(
    v1Again!.conclusions.some((c) => c.result === "insufficient_data"),
    "V1 仍显示当时缺对照",
  );
  const versions = await svc.listRevisions(ALICE, "q_0001");
  assert.deepEqual(versions.map((r) => r.revisionId), ["rev_0001", "rev_0002"]);
  assert.equal(versions[1]?.parentId, "rev_0001");

  // 8) 重复请求：同一幂等键只建一个版本
  const repeat = await svc.createRevision(ALICE, {
    revision: v2, idempotencyKey: "req-v2", expectedParentId: "rev_0001", now: T4,
  });
  assert.equal(repeat.created, false);
  assert.equal(repeat.revision.revisionId, "rev_0002");
  const finalVersions = await svc.listRevisions(ALICE, "q_0001");
  assert.equal(finalVersions.length, 2, "重复请求不产生第三个版本");

  const projectCount = (await svc.listProjects(ALICE)).length;
  const questionCount = (await svc.getQuestion(ALICE, "q_0001")) ? 1 : 0;
  console.log(
    `[05-flow] 新建=1 导入=${added1.length} V1=rev_0001 重开=ok 追加=${added2.length} V2=rev_0002 ` +
    `读V1=一致 重复请求=created:${repeat.created} → 项目数=${projectCount} 问题数=${questionCount} 版本数=${finalVersions.length}`,
  );
  assert.equal(projectCount, 1);
  assert.equal(questionCount, 1);
  assert.equal(finalVersions.length, 2);
});

// ---------- 项目 ----------

test("示例项目显式创建且幂等：刷新式重复调用不会复制", async () => {
  const svc = svcOf(new MemoryBackend());
  const first = await svc.ensureDemoProject(ALICE, T0);
  const second = await svc.ensureDemoProject(ALICE, T1);
  const third = await svc.ensureDemoProject(ALICE, T2);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(third.created, false);
  const list = await svc.listProjects(ALICE);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.projectId, "p_demo");
});

test("同名项目靠 ID 区分；列表项字段恰好为五项", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "同名项目", T0, "p_1");
  await svc.createProject(ALICE, "同名项目", T1, "p_2");
  const list = await svc.listProjects(ALICE);
  assert.equal(list.length, 2);
  assert.notEqual(list[0]?.projectId, list[1]?.projectId);
  for (const item of list) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["name", "pendingCount", "projectId", "questionCount", "updatedAt"],
    );
  }
});

test("列表按更新时间倒序，问题数与待补数正确", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "甲", T0, "p_a");
  await svc.createProject(ALICE, "乙", T1, "p_b");
  let list = await svc.listProjects(ALICE);
  assert.deepEqual(list.map((p) => p.projectId), ["p_b", "p_a"]);

  await svc.createQuestion(ALICE, {
    questionId: "q_a1", projectId: "p_a", rawClaim: "无主张", confirmedClaim: null, now: T2,
  });
  await svc.renameProject(ALICE, "p_a", "甲改名", T3);
  list = await svc.listProjects(ALICE);
  assert.deepEqual(list.map((p) => p.projectId), ["p_a", "p_b"], "改名后更新时间最新");
  assert.equal(list[0]?.name, "甲改名");
  assert.equal(list[0]?.questionCount, 1);
  assert.equal(list[0]?.pendingCount, 0, "needs_input 不计为待补");
});

// ---------- 隔离 ----------

test("两个访问者互不可见、不可改（隔离在存储分区执行）", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "A 的项目", T0, "p_a");
  await svc.createQuestion(ALICE, {
    questionId: "q_a", projectId: "p_a", rawClaim: "x", confirmedClaim: null, now: T0,
  });

  assert.deepEqual(await svc.listProjects(BOB), []);
  assert.equal(await svc.getProject(BOB, "p_a"), null);
  assert.equal(await svc.getQuestion(BOB, "q_a"), null);
  await assert.rejects(svc.listRuns(BOB, "p_a"), NotFoundError);
  await assert.rejects(svc.renameProject(BOB, "p_a", "篡改", T1), NotFoundError);
  await assert.rejects(
    svc.createQuestion(BOB, { questionId: "q_b", projectId: "p_a", rawClaim: "x", confirmedClaim: null, now: T1 }),
    NotFoundError,
  );
  await assert.rejects(svc.listRevisions(BOB, "q_a"), NotFoundError);

  // A 的数据原样
  assert.equal((await svc.getProject(ALICE, "p_a"))?.name, "A 的项目");
});

test("两个项目的同 runId 互不串", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "项目一", T0, "p_1");
  await svc.createProject(ALICE, "项目二", T0, "p_2");
  const run1: TrainingRun = {
    runId: "R01", projectId: "p_1",
    config: { model: "M1", evalSplit: "S1:v1", seed: 7, lr: 0.001, augmentation: "off" },
    source: "demo", metrics: { accuracy: 80 }, metadata: { importedAt: T0 },
  };
  const run2: TrainingRun = { ...run1, projectId: "p_2", metrics: { accuracy: 55 } };
  await svc.confirmImport(ALICE, { projectId: "p_1", runs: [run1], now: T1 });
  await svc.confirmImport(ALICE, { projectId: "p_2", runs: [run2], now: T1 });

  const list1 = await svc.listRuns(ALICE, "p_1");
  const list2 = await svc.listRuns(ALICE, "p_2");
  assert.equal(list1.length, 1);
  assert.equal(list2.length, 1);
  assert.equal(list1[0]?.metrics.accuracy, 80);
  assert.equal(list2[0]?.metrics.accuracy, 55);
  assert.equal((await svc.getRun(ALICE, "p_2", "R01"))?.projectId, "p_2");
});

// ---------- 导入确认 ----------

test("重复导入同内容去重；同 ID 异内容整批拒绝且不落半行", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "P", T0, "p_demo");
  const first = await importCsv(svc, ALICE, CSV_INITIAL, T1);
  assert.equal(first.length, 2);

  const again = await importCsv(svc, ALICE, CSV_INITIAL, T2);
  assert.deepEqual(again, [], "相同内容去重");

  const makeRun = (runId: string, lr: number, accuracy: number): TrainingRun => ({
    runId,
    projectId: "p_demo",
    config: { model: "M1", evalSplit: "S1:v1", seed: 7, lr, augmentation: "off", optimizer: "adam", epochs: 20 },
    source: "demo",
    metrics: { accuracy },
    metadata: { importedAt: T0 },
  });
  await assert.rejects(
    svc.confirmImport(ALICE, {
      projectId: "p_demo",
      runs: [makeRun("R05", 0.05, 70), makeRun("R01", 0.001, 99)],
      now: T3,
    }),
    ConflictError,
  );
  const runs = await svc.listRuns(ALICE, "p_demo");
  assert.equal(runs.length, 2, "整批拒绝：R05 也没写入，旧实验未被覆盖");
  assert.equal(runs.find((r) => r.runId === "R01")?.metrics.accuracy, 80);
});

// ---------- 版本一致性 ----------

test("过期父版本提交返回明确冲突，状态不变，可刷新重试", async () => {
  const backend = new MemoryBackend();
  const svc = svcOf(backend);
  await svc.createProject(ALICE, "P", T0, "p_demo");
  await importCsv(svc, ALICE, CSV_INITIAL, T1);
  await svc.createQuestion(ALICE, {
    questionId: "q_0001", projectId: "p_demo",
    rawClaim: demoQuestion.rawClaim, confirmedClaim: demoQuestion.confirmedClaim, now: T1,
  });
  const pkg = await svc.verifyQuestion(ALICE, "q_0001");
  const v1 = revisionFrom("rev_0001", "q_0001", null, T2,
    demoQuestion.confirmedClaim, await svc.listRuns(ALICE, "p_demo"),
    conclusionsFromPackage(pkg), evidenceRunIdsOf(pkg), pkg.suggestions.map((s) => s.text));
  await svc.createRevision(ALICE, { revision: v1, idempotencyKey: "k1", expectedParentId: null, now: T2 });

  const stale = revisionFrom("rev_0009", "q_0001", null, T3,
    demoQuestion.confirmedClaim, await svc.listRuns(ALICE, "p_demo"),
    conclusionsFromPackage(pkg), evidenceRunIdsOf(pkg), []);
  await assert.rejects(
    svc.createRevision(ALICE, { revision: stale, idempotencyKey: "k2", expectedParentId: null, now: T3 }),
    (error: unknown) => error instanceof ConflictError && error.code === "stale_parent",
  );
  const versions = await svc.listRevisions(ALICE, "q_0001");
  assert.deepEqual(versions.map((r) => r.revisionId), ["rev_0001"], "冲突不产生半个版本");
  assert.equal((await svc.getQuestion(ALICE, "q_0001"))?.currentRevisionId, "rev_0001");
});

test("写入中断不留半个版本：事务回调抛错则状态不变", async () => {
  const backend = new MemoryBackend();
  const svc = svcOf(backend);
  await svc.createProject(ALICE, "P", T0, "p_demo");

  await assert.rejects(
    backend.transact(ALICE, (draft) => {
      draft.runs.push({
        runId: "RXX", projectId: "p_demo",
        config: { model: "M1", evalSplit: "S1:v1", seed: 7, lr: 1, augmentation: "on" },
        source: "demo", metrics: { accuracy: 1 }, metadata: { importedAt: T0 },
      });
      throw new Error("中断");
    }),
    /中断/,
  );
  const state = await backend.read(ALICE);
  assert.equal(state.runs.length, 0, "抛错 → 不落任何行");
  assert.equal(state.projects.length, 1, "既有数据不受影响");
});

test("runId 不能冒充 revisionId，服务层校验拒绝", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "P", T0, "p_demo");
  await importCsv(svc, ALICE, CSV_INITIAL, T1);
  await svc.createQuestion(ALICE, {
    questionId: "q_0001", projectId: "p_demo",
    rawClaim: demoQuestion.rawClaim, confirmedClaim: demoQuestion.confirmedClaim, now: T1,
  });
  const pkg = await svc.verifyQuestion(ALICE, "q_0001");
  const bad = revisionFrom("R01", "q_0001", null, T2,
    demoQuestion.confirmedClaim, await svc.listRuns(ALICE, "p_demo"),
    conclusionsFromPackage(pkg), evidenceRunIdsOf(pkg), []);
  await assert.rejects(
    svc.createRevision(ALICE, { revision: bad, idempotencyKey: "k", expectedParentId: null, now: T2 }),
    /runId 不能冒充 revisionId/,
  );
  assert.equal((await svc.listRevisions(ALICE, "q_0001")).length, 0);
});

// ---------- 作业状态与快照分离 ----------

test("作业状态可变、证据快照定稿：模型重试只用 V1 原始快照", async () => {
  const backend = new MemoryBackend();
  const svc = svcOf(backend);
  await svc.createProject(ALICE, "P", T0, "p_demo");
  await importCsv(svc, ALICE, CSV_INITIAL, T1);
  await svc.createQuestion(ALICE, {
    questionId: "q_0001", projectId: "p_demo",
    rawClaim: demoQuestion.rawClaim, confirmedClaim: demoQuestion.confirmedClaim, now: T1,
  });
  const pkg = await svc.verifyQuestion(ALICE, "q_0001");
  const v1runs = await svc.listRuns(ALICE, "p_demo");
  const v1 = revisionFrom("rev_0001", "q_0001", null, T2,
    demoQuestion.confirmedClaim, v1runs, conclusionsFromPackage(pkg), evidenceRunIdsOf(pkg),
    pkg.suggestions.map((s) => s.text));
  await svc.createRevision(ALICE, { revision: v1, idempotencyKey: "k1", expectedParentId: null, now: T2 });

  await svc.putJob(ALICE, { jobId: "job_1", questionId: "q_0001", revisionId: "rev_0001", status: "queued" });
  await svc.updateJobStatus(ALICE, "job_1", "running");
  await importCsv(svc, ALICE, CSV_R03, T3);
  const pkg2 = await svc.verifyQuestion(ALICE, "q_0001");
  const v2 = revisionFrom("rev_0002", "q_0001", "rev_0001", T3,
    demoQuestion.confirmedClaim, await svc.listRuns(ALICE, "p_demo"),
    conclusionsFromPackage(pkg2), evidenceRunIdsOf(pkg2), pkg2.suggestions.map((s) => s.text));
  await svc.createRevision(ALICE, { revision: v2, idempotencyKey: "k2", expectedParentId: "rev_0001", now: T3 });
  await svc.updateJobStatus(ALICE, "job_1", "succeeded");

  const job = await svc.getJob(ALICE, "job_1");
  assert.equal(job?.status, "succeeded", "作业状态可变");
  const v1After = await svc.getRevision(ALICE, "q_0001", "rev_0001");
  assert.deepEqual(v1After, v1, "作业状态变化与追加数据都不改写 V1 定稿快照");

  const input = await svc.getModelInput(ALICE, "rev_0001");
  assert.equal(input.runs.length, 2, "模型重试用 V1 原始快照（当时只有两行）");
  input.runs.push({ ...v1runs[0]!, runId: "RXX" });
  const inputAgain = await svc.getModelInput(ALICE, "rev_0001");
  assert.equal(inputAgain.runs.length, 2, "返回克隆，外部修改不污染快照");
});

test("listQuestions 按项目返回问题且他人项目报 NotFound", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "P1", T0, "p_1");
  await svc.createProject(ALICE, "P2", T0, "p_2");
  await svc.createQuestion(ALICE, {
    questionId: "q1", projectId: "p_1", rawClaim: "a", confirmedClaim: null, now: T1,
  });
  await svc.createQuestion(ALICE, {
    questionId: "q2", projectId: "p_1", rawClaim: "b", confirmedClaim: null, now: T1,
  });
  await svc.createQuestion(ALICE, {
    questionId: "q3", projectId: "p_2", rawClaim: "c", confirmedClaim: null, now: T1,
  });
  const list = await svc.listQuestions(ALICE, "p_1");
  assert.deepEqual(list.map((q) => q.questionId), ["q1", "q2"]);
  await assert.rejects(svc.listQuestions(BOB, "p_1"), NotFoundError);
  await assert.rejects(svc.listQuestions(ALICE, "p_missing"), NotFoundError);
});

test("listJobs 按问题返回，跨访问者拒绝", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "P", T0, "p_1");
  await svc.createQuestion(ALICE, {
    questionId: "qj1", projectId: "p_1", rawClaim: "x", confirmedClaim: null, now: T1,
  });
  await svc.createQuestion(ALICE, {
    questionId: "qj2", projectId: "p_1", rawClaim: "y", confirmedClaim: null, now: T1,
  });
  await svc.putJob(ALICE, { jobId: "j1", questionId: "qj1", revisionId: null, status: "queued" });
  await svc.putJob(ALICE, { jobId: "j2", questionId: "qj2", revisionId: null, status: "queued" });
  const jobs = await svc.listJobs(ALICE, "qj1");
  assert.deepEqual(jobs.map((j) => j.jobId), ["j1"]);
  await assert.rejects(svc.listJobs(BOB, "qj1"), NotFoundError);
  await assert.rejects(svc.listJobs(ALICE, "q_missing"), NotFoundError);
});

test("updateClaim 更新范围并重算状态，可反复更新", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "P", T0, "p_demo");
  await importCsv(svc, ALICE, CSV_INITIAL, T1);
  await svc.createQuestion(ALICE, {
    questionId: "q_uc", projectId: "p_demo", rawClaim: demoQuestion.rawClaim, confirmedClaim: null, now: T1,
  });
  const claim1 = { ...demoQuestion.confirmedClaim!, scope: "target_lr" as const };
  const updated = await svc.updateClaim(ALICE, "q_uc", claim1, T2);
  assert.equal(updated.confirmedClaim?.scope, "target_lr");
  assert.equal(updated.status, "waiting_for_run", "有数据时按新主张重算状态");
  const claim2 = { ...demoQuestion.confirmedClaim! };
  const updated2 = await svc.updateClaim(ALICE, "q_uc", claim2, T3);
  assert.equal(updated2.confirmedClaim?.scope, "both_lrs");
  await assert.rejects(svc.updateClaim(BOB, "q_uc", claim2, T3), NotFoundError);
});

// ---------- 删除项目（卡 16） ----------

test("deleteProject 级联清除项目及其问题/运行/版本/作业/分析/事件/幂等键", async () => {
  const backend = new MemoryBackend();
  const svc = svcOf(backend);
  await svc.createProject(ALICE, "待删", T0, "p_demo");
  await svc.createProject(ALICE, "保留", T0, "p_keep");
  await importCsv(svc, ALICE, CSV_INITIAL, T1);
  const keepRuns = previewImport(CSV_INITIAL, {
    ...IMPORT_OPTS, projectId: "p_keep", existingRuns: [],
  });
  await svc.confirmImport(ALICE, { projectId: "p_keep", runs: keepRuns.added, now: T1 });
  await svc.createQuestion(ALICE, {
    questionId: "q_del", projectId: "p_demo",
    rawClaim: demoQuestion.rawClaim, confirmedClaim: demoQuestion.confirmedClaim, now: T1,
  });
  await svc.createQuestion(ALICE, {
    questionId: "q_keep", projectId: "p_keep", rawClaim: "保留问题", confirmedClaim: null, now: T1,
  });
  const pkg = await svc.verifyQuestion(ALICE, "q_del");
  const v1runs = await svc.listRuns(ALICE, "p_demo");
  const v1 = revisionFrom("rev_del", "q_del", null, T2,
    demoQuestion.confirmedClaim, v1runs, conclusionsFromPackage(pkg), evidenceRunIdsOf(pkg),
    pkg.suggestions.map((s) => s.text));
  await svc.createRevision(ALICE, { revision: v1, idempotencyKey: "req-del", expectedParentId: null, now: T2 });
  await svc.putJob(ALICE, { jobId: "job_del", questionId: "q_del", revisionId: "rev_del", status: "succeeded" });
  await svc.putAnalysis(ALICE, {
    revisionId: "rev_del",
    questionId: "q_del",
    output: {
      observation: { text: "观察", evidenceIds: [] },
      interpretation: { text: "解读", evidenceIds: [] },
      nextAction: { text: "下一步", evidenceIds: [] },
      revisedClaim: { text: "改写", evidenceIds: [] },
    },
    citations: [],
    promptVersion: "analysis-v1",
    provider: "mock",
    model: "mock-model",
    createdAt: T3,
  });
  await svc.appendJobEvent(ALICE, {
    eventId: "ev_del", jobId: "job_del", revisionId: "rev_del",
    node: "archive", status: "completed", at: T3, summary: "定稿",
  });

  await svc.deleteProject(ALICE, "p_demo");

  assert.equal(await svc.getProject(ALICE, "p_demo"), null);
  assert.equal(await svc.getQuestion(ALICE, "q_del"), null);
  assert.equal(await svc.getRevision(ALICE, "q_del", "rev_del"), null);
  assert.equal(await svc.getJob(ALICE, "job_del"), null);
  assert.equal(await svc.getAnalysis(ALICE, "rev_del"), null);
  assert.deepEqual(await svc.getJobEvents(ALICE, "job_del"), []);
  await assert.rejects(svc.listRuns(ALICE, "p_demo"), NotFoundError);
  await assert.rejects(svc.listQuestions(ALICE, "p_demo"), NotFoundError);
  assert.deepEqual((await svc.listProjects(ALICE)).map((p) => p.projectId), ["p_keep"]);

  // 保留项目不受影响
  assert.equal((await svc.getQuestion(ALICE, "q_keep"))?.projectId, "p_keep");
  assert.equal((await svc.listRuns(ALICE, "p_keep")).length, 2);
});

test("deleteProject 幂等键一并清除：删后同请求键可正常创建新版本", async () => {
  const backend = new MemoryBackend();
  const svc = svcOf(backend);
  await svc.createProject(ALICE, "P", T0, "p_demo");
  await importCsv(svc, ALICE, CSV_INITIAL, T1);
  await svc.createQuestion(ALICE, {
    questionId: "q_0001", projectId: "p_demo",
    rawClaim: demoQuestion.rawClaim, confirmedClaim: demoQuestion.confirmedClaim, now: T1,
  });
  const pkg = await svc.verifyQuestion(ALICE, "q_0001");
  const v1runs = await svc.listRuns(ALICE, "p_demo");
  const v1 = revisionFrom("rev_0001", "q_0001", null, T2,
    demoQuestion.confirmedClaim, v1runs, conclusionsFromPackage(pkg), evidenceRunIdsOf(pkg),
    pkg.suggestions.map((s) => s.text));
  await svc.createRevision(ALICE, { revision: v1, idempotencyKey: "req-k", expectedParentId: null, now: T2 });

  await svc.deleteProject(ALICE, "p_demo");

  // 重建同 ID 项目与问题后，同一幂等键不得命中旧版本
  await svc.createProject(ALICE, "P 重建", T3, "p_demo");
  await importCsv(svc, ALICE, CSV_INITIAL, T3);
  await svc.createQuestion(ALICE, {
    questionId: "q_0001", projectId: "p_demo",
    rawClaim: demoQuestion.rawClaim, confirmedClaim: demoQuestion.confirmedClaim, now: T3,
  });
  const pkg2 = await svc.verifyQuestion(ALICE, "q_0001");
  const v2 = revisionFrom("rev_0002", "q_0001", null, T4,
    demoQuestion.confirmedClaim, await svc.listRuns(ALICE, "p_demo"),
    conclusionsFromPackage(pkg2), evidenceRunIdsOf(pkg2), pkg2.suggestions.map((s) => s.text));
  const created = await svc.createRevision(ALICE, {
    revision: v2, idempotencyKey: "req-k", expectedParentId: null, now: T4,
  });
  assert.equal(created.created, true, "旧幂等键已随删除清除，创建新版本而不是重放");
  assert.equal((await svc.listRevisions(ALICE, "q_0001")).length, 1);
});

test("deleteProject 不存在报 NotFound；他人项目不可删", async () => {
  const svc = svcOf(new MemoryBackend());
  await svc.createProject(ALICE, "A 的项目", T0, "p_a");
  await assert.rejects(svc.deleteProject(ALICE, "p_missing"), NotFoundError);
  await assert.rejects(svc.deleteProject(BOB, "p_a"), NotFoundError);
  assert.equal((await svc.getProject(ALICE, "p_a"))?.name, "A 的项目", "删除失败后数据原样");
});
