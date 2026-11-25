import assert from "node:assert/strict";
import { test } from "node:test";

import { createDataService, MemoryBackend, type Actor } from "../src/experiment/storage.ts";
import {
  verifyPaperQuote,
  type PaperEvidence,
  type PaperEvidenceKind,
  type PaperSource,
} from "../src/web/paper-study.ts";

const actor: Actor = { userId: "paper-evidence" };
const other: Actor = { userId: "other" };
const now = "2026-11-24T10:00:00.000Z";
const later = "2026-11-24T10:05:00.000Z";
const shared = "两项研究都观察到检索机制能够改善少样本分类效果。";
const aQuote = `${shared}论文 A 在干净支持集上报告了稳定增益。`;
const bQuote = `${shared}论文 B 在遮挡支持集上观察到了明显下降。`;
const cQuote = "只有在支持集与查询集领域一致时，检索增益才保持不变。";
const papers: PaperSource[] = [
  { title: "论文 A", filename: "a.pdf", sha256: "a".repeat(64), pages: ["封面", aQuote, ""] },
  { title: "论文 B", filename: "b.pdf", sha256: "b".repeat(64), pages: ["封面", bQuote, "其他结果"] },
  { title: "论文 C", filename: "c.pdf", sha256: "c".repeat(64), pages: ["封面", cQuote] },
];

async function setup() {
  const backend = new MemoryBackend();
  const data = createDataService(backend);
  const project = await data.importPaper(actor, { name: "多文献项目", paper: papers[0], now });
  const question = await data.createQuestion(actor, {
    projectId: project.projectId,
    questionId: "question-main",
    rawClaim: "检索机制何时提供稳定增益？",
    confirmedClaim: null,
    now,
  });
  await data.importPaper(actor, { projectId: project.projectId, name: project.name, paper: papers[1], now });
  await data.importPaper(actor, { projectId: project.projectId, name: project.name, paper: papers[2], now });
  return { backend, data, project, question };
}

test("原文回查使用指定物理页，归一化后仍回存连续原文切片", () => {
  const paper = { ...papers[0], pages: ["封面", "The  classi\u00ad\nfication result is stable."] };
  assert.deepEqual(verifyPaperQuote(paper, 2, "The classification result"), {
    page: 2,
    quote: "The  classi\u00ad\nfication result",
  });
  assert.throws(() => verifyPaperQuote(paper, 1, "The classification result"), /无法回查原文/);
  assert.throws(() => verifyPaperQuote(paper, 0, aQuote), /物理页范围/);
  assert.throws(() => verifyPaperQuote(paper, 2, "The classification result was fabricated"), /无法回查原文/);
  assert.throws(() => verifyPaperQuote(paper, 2, "太短"), /引文过短/);
});

test("同一项目保留多篇 PDF，重复文件去重且旧问题与候选引文不变", async () => {
  const { backend, data, project, question } = await setup();
  const candidate = {
    question: "检索增益是否依赖支持集质量？",
    claim: "遮挡会削弱检索增益。",
    rationale: "论文 A 与论文 B 的结果不同。",
    verification: "控制支持集遮挡比例后比较准确率。",
    citations: [{ page: 2, quote: aQuote }],
  };
  const first = await data.savePaperCandidates(actor, project.projectId, { model: "mock", candidates: [candidate] });
  const accepted = await data.acceptPaperCandidate(actor, {
    projectId: project.projectId,
    candidateId: first.generation!.candidates[0]!.id,
    question: candidate.question,
    now,
  });
  const before = await data.getPaperStudy(actor, project.projectId);
  await data.importPaper(actor, { projectId: project.projectId, name: project.name, paper: papers[0], now: later });
  const reopened = createDataService(backend);
  const studies = await reopened.listPaperStudies(actor, project.projectId);
  assert.equal(studies.length, 3);
  assert.deepEqual(studies.map(({ sha256 }) => sha256), papers.map(({ sha256 }) => sha256));
  assert.deepEqual(await reopened.getPaperStudy(actor, project.projectId), before);
  assert.deepEqual(await reopened.getQuestion(actor, question.questionId), question);
  assert.deepEqual(await reopened.getQuestion(actor, accepted.questionId), accepted);
  assert.deepEqual((await reopened.getPaperStudy(actor, project.projectId, papers[0].sha256))?.generation?.candidates[0]?.citations, candidate.citations);
  assert.equal(await reopened.getPaperStudy(actor, project.projectId, "d".repeat(64)), null);
  await assert.rejects(reopened.savePaperCandidates(actor, project.projectId, { model: "mock", candidates: [] }, "d".repeat(64)), /没有这份 PDF/);
});

test("同一问题的三类证据来自指定论文，同页相似句不会串文", async () => {
  const { backend, data, project, question } = await setup();
  const entries: Array<{ paperSha256: string; quote: string; kind: PaperEvidenceKind; note: string }> = [
    { paperSha256: papers[0].sha256, quote: aQuote, kind: "support", note: "支持检索增益。" },
    { paperSha256: papers[1].sha256, quote: bQuote, kind: "counterexample", note: "遮挡条件下结论相反。" },
    { paperSha256: papers[2].sha256, quote: cQuote, kind: "condition", note: "领域一致是适用前提。" },
  ];
  const added: PaperEvidence[] = [];
  for (const entry of entries) {
    added.push(await data.addPaperEvidence(actor, { projectId: project.projectId, questionId: question.questionId, page: 2, now, ...entry }));
  }
  const reopened = createDataService(backend);
  assert.deepEqual(await reopened.listPaperEvidence(actor, question.questionId), added);
  assert.deepEqual(added.map(({ paperSha256, kind }) => ({ paperSha256, kind })), entries.map(({ paperSha256, kind }) => ({ paperSha256, kind })));
  assert.equal(added[1]!.quote, bQuote);
  await assert.rejects(data.addPaperEvidence(actor, {
    projectId: project.projectId,
    questionId: question.questionId,
    paperSha256: papers[1].sha256,
    page: 2,
    quote: aQuote,
    kind: "support",
    note: "不能把论文 A 的句子挂到论文 B。",
    now,
  }), /无法回查原文/);
  await assert.rejects(data.listPaperEvidence(other, question.questionId), /问题不存在/);
});

test("错误页码、改写引文、跨项目来源与非法分类均被原子拒绝", async () => {
  const { backend, data, project, question } = await setup();
  const foreignProject = await data.importPaper(actor, { name: "其他项目", paper: { ...papers[1], sha256: "d".repeat(64) }, now });
  const base = { projectId: project.projectId, questionId: question.questionId, paperSha256: papers[0].sha256, page: 2, quote: aQuote, kind: "support" as const, note: "合法证据", now };
  for (const input of [
    { ...base, page: 1 },
    { ...base, page: 3 },
    { ...base, quote: "论文 A 完全改写了这句话并报告稳定增益。" },
    { ...base, projectId: foreignProject.projectId },
    { ...base, paperSha256: "d".repeat(64) },
    { ...base, kind: "automatic" as PaperEvidenceKind },
    { ...base, note: " " },
  ]) {
    await assert.rejects(data.addPaperEvidence(actor, input));
  }
  assert.deepEqual((await backend.read(actor)).paperEvidence ?? [], []);
});

test("证据仅更新分类和说明，解除关联保留文献与其他问题证据", async () => {
  const { backend, data, project, question } = await setup();
  const secondQuestion = await data.createQuestion(actor, {
    projectId: project.projectId,
    questionId: "question-second",
    rawClaim: "适用条件是什么？",
    confirmedClaim: null,
    now,
  });
  const evidence = await data.addPaperEvidence(actor, {
    projectId: project.projectId,
    questionId: question.questionId,
    paperSha256: papers[0].sha256,
    page: 2,
    quote: aQuote,
    kind: "support",
    note: "初始说明",
    now,
  });
  const retained = await data.addPaperEvidence(actor, {
    projectId: project.projectId,
    questionId: secondQuestion.questionId,
    paperSha256: papers[0].sha256,
    page: 2,
    quote: aQuote,
    kind: "condition",
    note: "另一问题仍保留",
    now,
  });
  const reopened = createDataService(backend);
  const updated = await reopened.updatePaperEvidence(actor, {
    questionId: question.questionId,
    evidenceId: evidence.evidenceId,
    kind: "counterexample",
    note: "研究者改判为反例",
    now: later,
  });
  assert.deepEqual(updated, { ...evidence, kind: "counterexample", note: "研究者改判为反例", updatedAt: later });
  await assert.rejects(data.updatePaperEvidence(actor, {
    questionId: secondQuestion.questionId,
    evidenceId: evidence.evidenceId,
    kind: "support",
    note: "不得跨问题修改",
    now: later,
  }), /研究证据不存在/);
  await reopened.removePaperEvidence(actor, { questionId: question.questionId, evidenceId: evidence.evidenceId, now: later });
  assert.deepEqual(await reopened.listPaperEvidence(actor, question.questionId), []);
  assert.deepEqual(await reopened.listPaperEvidence(actor, secondQuestion.questionId), [retained]);
  assert.equal((await reopened.getPaperStudy(actor, project.projectId, papers[0].sha256))?.pages[1], aQuote);
});

test("第二篇论文的候选可独立确认，删除项目级联清除文献证据", async () => {
  const { backend, data, project, question } = await setup();
  await data.addPaperEvidence(actor, {
    projectId: project.projectId,
    questionId: question.questionId,
    paperSha256: papers[2].sha256,
    page: 2,
    quote: cQuote,
    kind: "condition",
    note: "领域一致",
    now,
  });
  const generated = await data.savePaperCandidates(actor, project.projectId, {
    model: "mock",
    candidates: [{
      question: "领域偏移会怎样影响结果？",
      claim: "领域偏移可能消除增益。",
      rationale: "论文 C 限定了适用领域。",
      verification: "更换查询集领域进行对照。",
      citations: [{ page: 2, quote: cQuote }],
    }],
  }, papers[2].sha256);
  assert.equal((await data.getPaperStudy(actor, project.projectId))?.generation, null);
  const accepted = await data.acceptPaperCandidate(actor, {
    projectId: project.projectId,
    candidateId: generated.generation!.candidates[0]!.id,
    question: "领域偏移会怎样影响结果？",
    now,
  });
  assert.equal(accepted.projectId, project.projectId);
  const foreign = await data.importPaper(actor, { name: "保留项目", paper: { ...papers[0], sha256: "e".repeat(64) }, now });
  const foreignQuestion = await data.createQuestion(actor, { projectId: foreign.projectId, questionId: "foreign-question", rawClaim: "其他问题", confirmedClaim: null, now });
  await data.addPaperEvidence(actor, {
    projectId: foreign.projectId,
    questionId: foreignQuestion.questionId,
    paperSha256: "e".repeat(64),
    page: 2,
    quote: aQuote,
    kind: "support",
    note: "不应被级联删除",
    now,
  });
  await data.deleteProject(actor, project.projectId);
  const state = await backend.read(actor);
  assert.equal(state.paperStudies?.length, 1);
  assert.equal(state.paperEvidence?.length, 1);
  assert.equal(state.paperEvidence?.[0]?.questionId, foreignQuestion.questionId);
});
