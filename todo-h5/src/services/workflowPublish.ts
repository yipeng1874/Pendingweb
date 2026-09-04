import { api } from "./http";
import type { CollaborationQuestionType, Identity, WorkflowTask } from "../types";

export const canPublishWorkflow = (identity?: Identity | null) => Boolean(identity && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(identity.roleCode));
export type Assignee = { userId: string; nickname: string; phone: string; orgName?: string | null; primaryCategory: string; anchorDouyinNo?: string | null };
export type PublishQuestion = { title: string; itemType: CollaborationQuestionType; isRequired: boolean; options: string[]; linkUrl?: string };
export type PublishInput = { title: string; description: string; dueAt: string; steps: { title: string; requirement: string; assigneeUserId: string; questions: PublishQuestion[] }[] };
export type PublishBootstrap = { enabled: boolean; operator: { identityId: string; orgName?: string | null } };
const base = "/tasks/collaboration/workflows";
export const workflowPublishApi = {
  search: (keyword: string) => api.get<Assignee[]>(`${base}/assignees/search?keyword=${encodeURIComponent(keyword)}`),
  create: (input: PublishInput) => api.post<WorkflowTask>(base, input),
  issued: (status: "in_progress" | "completed" | "ended", cursor?: string) => api.get<{ items: WorkflowTask[]; nextCursor: string | null }>(`${base}/issued-page?status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
};

export function validateWorkflow(input: PublishInput): string {
  if (!input.title.trim()) return "请填写任务标题";
  if (!input.dueAt || !Number.isFinite(new Date(input.dueAt).getTime())) return "请选择截止时间";
  if (!input.steps.length) return "请至少配置一个节点";
  for (const [index, step] of input.steps.entries()) {
    const prefix = `节点 ${index + 1}：`;
    if (!step.assigneeUserId) return prefix + "请选择执行人";
    if (!step.questions.length) return prefix + "请至少添加一道题目";
    for (const q of step.questions) {
      if (!q.title.trim()) return prefix + "请填写题目标题";
      if (["SINGLE_CHOICE", "MULTI_CHOICE"].includes(q.itemType) && q.options.filter(o => o.trim()).length < 2) return prefix + "选择题至少需要两个选项";
      if (q.itemType === "LINK" && !q.linkUrl?.trim()) return prefix + "请填写链接地址";
    }
  }
  return "";
}
