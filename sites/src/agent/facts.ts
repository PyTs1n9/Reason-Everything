/**
 * 事实预注册：由代码从卡 04 证据包生成，模型只能引用这里存在的编号。
 * evidenceId 与卡 04 一致（cellId / pairId / suggestionId），前端可按
 * evidenceId 高亮关联 runId/cellId；数值、运行号、条件用补充事实绑定。
 */

import type { EvidencePackage } from "../experiment/evidence.ts";
import type { ClaimSpec } from "../experiment/types.ts";
import type { Fact } from "./adapter.ts";

/** 规则版本：卡 04 证据引擎。 */
export const RULES_VERSION = "evidence-v1";

export interface FactRegistry {
  facts: Fact[];
  ids: Set<string>;
  runIds: Set<string>;
  /** 已注册的数值（百分点、准确率、学习率、增幅），供数字绑定校验。 */
  numericValues: Set<number>;
  kindsById: Map<string, Fact["kind"]>;
}

function addNumber(values: Set<number>, value: number): void {
  values.add(value);
}

export function buildFactRegistry(pkg: EvidencePackage, claim: ClaimSpec): FactRegistry {
  const facts: Fact[] = [];
  const numericValues = new Set<number>();

  for (const cell of pkg.cells) {
    if (cell.status === "measured" && cell.runId !== null && cell.accuracy !== null) {
      facts.push({
        factId: cell.cellId,
        kind: "cell-measured",
        value: cell.accuracy,
        runIds: [cell.runId],
        cellId: cell.cellId,
      });
      addNumber(numericValues, cell.accuracy);
    } else {
      facts.push({ factId: cell.cellId, kind: "cell-missing", cellId: cell.cellId });
    }
  }

  for (const pair of pkg.pairs) {
    facts.push({
      factId: pair.pairId,
      kind: "pair",
      value: pair.deltaPp,
      runIds: [pair.treatedRunId, pair.controlRunId],
    });
    addNumber(numericValues, Number(pair.deltaPp));
  }

  for (const suggestion of pkg.suggestions) {
    facts.push({ factId: suggestion.suggestionId, kind: "action", value: suggestion.text });
  }

  pkg.unmetConditions.forEach((condition, index) => {
    facts.push({ factId: `fact:cond:${index}`, kind: "condition", value: condition });
  });

  const runIds = new Set<string>();
  if (pkg.observation) {
    runIds.add(pkg.observation.targetRunId);
    runIds.add(pkg.observation.baselineRunId);
  }
  for (const cell of pkg.cells) if (cell.runId) runIds.add(cell.runId);
  for (const pair of pkg.pairs) {
    runIds.add(pair.treatedRunId);
    runIds.add(pair.controlRunId);
  }
  for (const runId of runIds) {
    facts.push({ factId: `fact:run:${runId}`, kind: "run", value: runId, runIds: [runId] });
  }

  facts.push({ factId: "fact:obs-delta", kind: "number", value: pkg.observation?.deltaPp ?? "n/a" });
  if (pkg.observation) addNumber(numericValues, Number(pkg.observation.deltaPp));

  facts.push({
    factId: "fact:claim-delta",
    kind: "number",
    value: claim.expectedDeltaPp === null ? "n/a" : `${claim.expectedDeltaPp}`,
  });
  if (claim.expectedDeltaPp !== null) addNumber(numericValues, claim.expectedDeltaPp);

  for (const lr of claim.learningRates) addNumber(numericValues, lr);

  if (pkg.augmentationContributionPp !== null) {
    facts.push({ factId: "fact:contribution", kind: "contribution", value: pkg.augmentationContributionPp });
    addNumber(numericValues, Number(pkg.augmentationContributionPp));
  }

  const ids = new Set(facts.map((f) => f.factId));
  const kindsById = new Map(facts.map((f) => [f.factId, f.kind]));
  return { facts, ids, runIds, numericValues, kindsById };
}
