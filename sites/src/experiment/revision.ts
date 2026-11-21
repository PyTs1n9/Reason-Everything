/**
 * AnalysisRevision 的校验与版本推进（离线、确定性）。
 *
 * 版本不可变：范围变化或追加记录都在同一 questionId 下新建 revision，
 * parentId 指向前一版本。runId 与 revisionId 属于不同身份域，
 * 运行编号不能冒充版本号。跨项目引用一律拒绝。
 */

import type {
  AnalysisJobStatus,
  AnalysisRevision,
  ModelOutputStatus,
  Question,
  RuleResult,
} from "./types.ts";
import {
  ANALYSIS_JOB_STATUSES,
  MODEL_OUTPUT_STATUSES,
  QUESTION_STATUSES,
  RULE_RESULTS,
} from "./types.ts";
import { validateClaimSpecShape } from "./claim.ts";

export interface RevisionContext {
  question: Question;
  /** 本项目已知的 runId（跨项目运行不在此列）。 */
  knownRunIds: readonly string[];
  /** 已知 revisionId，供 parentId 解析。 */
  knownRevisionIds: readonly string[];
}

/** 对编码读回的 Revision 做运行时结构校验；返回错误列表。 */
export function validateRevision(
  rev: AnalysisRevision,
  ctx: RevisionContext,
): string[] {
  const errors: string[] = [];

  if (!rev.revisionId) errors.push("revisionId 为空");
  if (rev.revisionId && ctx.knownRunIds.includes(rev.revisionId)) {
    errors.push(`runId 不能冒充 revisionId: ${rev.revisionId}`);
  }
  if (rev.questionId !== ctx.question.questionId) {
    errors.push(`revision.questionId 与问题不一致: ${rev.questionId}`);
  }
  if (rev.parentId !== null) {
    if (rev.parentId === rev.revisionId) errors.push("parentId 不能指向自己");
    else if (!ctx.knownRevisionIds.includes(rev.parentId)) {
      errors.push(`parentId 未指向已知版本: ${rev.parentId}`);
    }
  }
  if (!rev.createdAt) errors.push("createdAt 缺失");

  if (!rev.inputSnapshot || typeof rev.inputSnapshot !== "object") {
    errors.push("inputSnapshot 缺失");
  } else {
    if (!rev.inputSnapshot.claim) {
      errors.push("inputSnapshot.claim 缺失");
    } else {
      errors.push(...validateClaimSpecShape(rev.inputSnapshot.claim));
    }
    if (!Array.isArray(rev.inputSnapshot.runs)) {
      errors.push("inputSnapshot.runs 必须是数组");
    } else {
      for (const run of rev.inputSnapshot.runs) {
        if (run.projectId !== ctx.question.projectId) {
          errors.push(`跨项目引用被拒绝: 运行 ${run.runId} 属于项目 ${run.projectId}`);
        }
      }
    }
  }

  if (!Array.isArray(rev.evidenceRefs)) {
    errors.push("evidenceRefs 必须是数组");
  } else {
    for (const ref of rev.evidenceRefs) {
      if (ref.projectId !== ctx.question.projectId) {
        errors.push(`跨项目证据引用被拒绝: ${ref.runId} 属于项目 ${ref.projectId}`);
      }
    }
  }

  if (!Array.isArray(rev.conclusions)) errors.push("conclusions 必须是数组");
  else {
    for (const c of rev.conclusions) {
      if (!RULE_RESULTS.includes(c.result as RuleResult)) {
        errors.push(`规则结果非法: ${String(c.result)}`);
      }
    }
  }

  if (!Array.isArray(rev.suggestions)) errors.push("suggestions 必须是数组");

  if (!MODEL_OUTPUT_STATUSES.includes(rev.modelOutput as ModelOutputStatus)) {
    errors.push(`modelOutput 非法: ${String(rev.modelOutput)}`);
  }

  return errors;
}

export type RevisionDraft = Omit<AnalysisRevision, "questionId" | "parentId">;

export type CreateRevisionResult =
  | { ok: true; revision: AnalysisRevision }
  | { ok: false; errors: string[] };

/**
 * 在同一问题下推进新版本：questionId 继承，parentId 指向上一版。
 * 校验失败返回错误列表，不产出半成品。
 */
export function createNextRevision(
  previous: AnalysisRevision,
  draft: RevisionDraft,
  ctx: RevisionContext,
): CreateRevisionResult {
  const revision: AnalysisRevision = {
    ...draft,
    questionId: previous.questionId,
    parentId: previous.revisionId,
  };
  const errors = validateRevision(revision, {
    ...ctx,
    knownRevisionIds: [...ctx.knownRevisionIds, previous.revisionId],
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, revision };
}

/** 编码读回的作业状态校验；返回错误列表。 */
export function validateJobStatus(status: unknown): string[] {
  return ANALYSIS_JOB_STATUSES.includes(status as AnalysisJobStatus)
    ? []
    : [`分析作业状态非法: ${String(status)}`];
}

/** 编码读回的问题状态校验；返回错误列表。 */
export function validateQuestionStatus(status: unknown): string[] {
  return QUESTION_STATUSES.includes(status as never)
    ? []
    : [`问题状态非法: ${String(status)}`];
}
