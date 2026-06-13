import { api } from "./http";
import { useAuthStore } from "../stores/authStore";
import { useIdentityStore } from "../stores/identityStore";
import type { OrgUnit } from "../types";

export type WorkflowAssigneeCategory = "subordinate_anchor" | "subordinate_manager" | "peer_manager";

export type WorkflowAssigneeOption = {
  userId: string;
  nickname: string;
  phone: string;
  orgId?: string | null;
  orgName?: string | null;
  orgPath?: string | null;
  roleCodes: string[];
  categories: WorkflowAssigneeCategory[];
  primaryCategory: WorkflowAssigneeCategory;
  anchorDouyinNo?: string | null;
  anchorNickname?: string | null;
};

export type WorkflowTaskQuestionType = "QA" | "FILL_BLANK" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "LINK" | "ATTACHMENT";

export type WorkflowTaskQuestion = {
  id?: string;
  title: string;
  itemType: WorkflowTaskQuestionType;
  isRequired: boolean;
  options?: string[];
  linkUrl?: string;
};

export type WorkflowBootstrapTask = {
  id: string;
  mode: "workflow";
  title: string;
  description?: string;
  targetOrgId: string;
  targetOrgName: string;
  issuerOrgId?: string | null;
  issuerOrgName?: string | null;
  issuerScopePath?: string | null;
  createdByUserId: string;
  createdByIdentityId: string;
  createdByName: string;
  dueAt?: string | null;
  status: "draft" | "in_progress" | "completed" | "ended";
  currentStepOrder: number;
  createdAt: string;
  updatedAt: string;
  steps: Array<{
    id: string;
    order: number;
    title: string;
    requirement: string;
    questions: WorkflowTaskQuestion[];
    assigneeUserId: string;
    assigneeName: string;
    assigneeOrgId?: string | null;
    assigneeOrgName?: string | null;
    status: "pending" | "active" | "completed";
    completedAt?: string | null;
  }>;
};

export type WorkflowBootstrapPayload = {
  enabled: boolean;
  mode: "workflow";
  operator: {
    identityId: string;
    orgId?: string | null;
    orgName?: string | null;
    roleCode: string;
    scopePath?: string | null;
  };
  rules: {
    publishScope: "downstream_only";
    notes: string[];
  };
  orgOptions: Array<Pick<OrgUnit, "id" | "name" | "orgType" | "path" | "parentId">>;
  assigneeOptions: WorkflowAssigneeOption[];
  tasks: WorkflowBootstrapTask[];
};

export type WorkflowCreateInput = {
  title: string;
  description?: string;
  dueAt?: string;
  steps: Array<{
    title: string;
    requirement: string;
    assigneeUserId: string;
    questions: WorkflowTaskQuestion[];
  }>;
};

export type WorkflowStepAnswer = {
  questionId: string;
  answerText?: string;
  answerOptions?: string[];
  isLinkConfirmed?: boolean;
  /** 附件题上传的文件 URL 列表 */
  attachmentUrls?: string[];
};

export type WorkflowAttachmentUploadResult = {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

export type WorkflowMyTaskStep = {
  id: string;
  order: number;
  title: string;
  requirement: string;
  questions: WorkflowTaskQuestion[];
  assigneeUserId: string;
  assigneeName: string;
  assigneeOrgId?: string | null;
  assigneeOrgName?: string | null;
  status: "pending" | "active" | "completed";
  completedAt?: string | null;
  stepAnswers?: WorkflowStepAnswer[];
  submittedAt?: string | null;
  submittedByUserId?: string | null;
};

export type WorkflowMyTask = Omit<WorkflowBootstrapTask, "steps"> & {
  steps: WorkflowMyTaskStep[];
};

export const workflowTaskApi = {
  bootstrap: () => api.get<WorkflowBootstrapPayload>("/tasks/collaboration/workflows/bootstrap"),
  searchAssignees: (keyword: string) => api.get<WorkflowAssigneeOption[]>(`/tasks/collaboration/workflows/assignees/search?keyword=${encodeURIComponent(keyword)}`),
  create: (payload: WorkflowCreateInput) => api.post<WorkflowBootstrapTask>("/tasks/collaboration/workflows", payload),
  myTasks: () => api.get<WorkflowMyTask[]>("/tasks/collaboration/workflows/mine"),
  submitStep: (taskId: string, stepId: string, answers: WorkflowStepAnswer[]) =>
    api.post<WorkflowMyTask>(`/tasks/collaboration/workflows/${taskId}/steps/${stepId}/submit`, { answers }),
  /** 逐题保存：保存单道题目答案，必填题全部填写后后端自动完成节点 */
  saveAnswer: (taskId: string, stepId: string, answer: WorkflowStepAnswer) =>
    api.post<{ task: WorkflowMyTask; stepCompleted: boolean }>(`/tasks/collaboration/workflows/${taskId}/steps/${stepId}/answer`, answer),
  /** 流转任务附件上传（multipart/form-data，字段名 file） */
  uploadAttachment: (file: File): Promise<WorkflowAttachmentUploadResult> => {
    const token = useAuthStore.getState().token;
    const identityId = useIdentityStore.getState().currentIdentity?.id;
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/tasks/collaboration/workflows/attachments/upload", {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(identityId ? { "X-Identity-Id": identityId } : {}),
      },
      body: form,
    }).then(async (r) => {
      const body = await r.json() as { success: boolean; data?: WorkflowAttachmentUploadResult; error?: { message?: string } };
      if (!body.success) throw new Error(body.error?.message ?? "上传失败");
      return body.data!;
    });
  },
  /** 发布者看板：我发布的所有流转任务（含 stepAnswers，无需再单独拉详情） */
  issuedTasks: () => api.get<WorkflowMyTask[]>("/tasks/collaboration/workflows/issued"),
  /** 发布者查单个任务完整详情（含执行答案） */
  getTaskDetail: (taskId: string) => api.get<WorkflowMyTask>(`/tasks/collaboration/workflows/${taskId}`),
};
