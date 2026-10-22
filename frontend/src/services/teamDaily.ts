import { api } from "./http";
import type { TaskEffectMode } from "../types";
const buildQuery = (params?: object) => { const q = new URLSearchParams(); for (const [k,v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) q.set(k,String(v)); return q.size ? '?' + q : ''; };
// ─── 团队管理日常任务独立 API（对接 /api/team-daily/* 路由） ─────────────────────

// ── 执行层类型 ──
export type TeamTaskItemAttachment = {
  id: string;
  teamTaskItemRecordId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
};

export type TeamTaskItemRecord = {
  id: string;
  taskRecordId: string;
  taskItemId: string;
  status: "pending" | "done";
  answerText?: string | null;
  answerOptions?: string[] | null;
  isLinkConfirmed: boolean;
  doneAt?: string | null;
  doneBy?: string | null;
  attachments?: TeamTaskItemAttachment[];
};

export type TeamTaskLeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type TeamTaskLeaveRequest = {
  id: string;
  taskRecordId: string;
  applicantUserId: string;
  applicantName?: string | null;
  reason: string;
  status: TeamTaskLeaveStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewComment?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeamTaskRecord = {
  id: string;
  assignmentId: string;
  teamOrgId: string;
  teamOrg?: { id: string; name: string } | null;
  recordDate: string;
  status: "pending" | "in_progress" | "submitted" | "overdue";
  totalItems: number;
  doneItems: number;
  submittedAt?: string | null;
  submittedBy?: string | null;
  assignment?: {
    id: string;
    status: string;
    template?: {
      id: string;
      title: string;
      items: Array<{
        id: string;
        sortOrder: number;
        itemType: string;
        title: string;
        isRequired: boolean;
        linkUrl?: string | null;
        options: Array<{ id: string; sortOrder: number; label: string }>;
      }>;
    };
  };
  itemRecords?: TeamTaskItemRecord[];
  leaveRequests?: TeamTaskLeaveRequest[];
};

export type TeamTaskTemplate = {
  id: string;
  title: string;
  description?: string;
  baseOrgId: string;
  createdBy: string;
  version: number;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    templateId: string;
    sortOrder: number;
    itemType: string;
    title: string;
    isRequired: boolean;
    linkUrl?: string | null;
    options: Array<{ id: string; sortOrder: number; label: string }>;
  }>;
  _count?: { assignments: number };
};

export type TeamTaskAssignment = {
  id: string;
  templateId: string;
  baseOrgId: string;
  status: "draft" | "scheduled" | "active" | "ended" | "deleted";
  effectMode: "immediate" | "next_midnight";
  effectiveAt?: string | null;
  publishedAt?: string | null;
  endedAt?: string | null;
  createdBy: string;
  createdByOrgId: string;
  createdAt: string;
  updatedAt: string;
  template?: { id: string; title: string; status: string };
  targets?: Array<{ id: string; teamOrgId: string; teamOrg: { id: string; name: string } }>;
  _count?: { records: number };
};

export const teamDailyApi = {
  batchLeave: (data: { recordIds: string[]; taskDate: string; action: "approve" | "cancel"; reason: string }) =>
    api.post<{ results: Array<{ recordId: string; hallName: string; status: string }> }>("/team-daily/leave-requests/batch", data),
  // ── 模板 ──
  listTemplates: (params?: { baseOrgId?: string; status?: string; neverPublished?: boolean; limit?: number; offset?: number }) =>
    api.get<TeamTaskTemplate[]>(`/team-daily/templates${buildQuery(params)}`),
  getTemplateById: (id: string, baseOrgId?: string) =>
    api.get<TeamTaskTemplate>(`/team-daily/templates/${id}${buildQuery({ baseOrgId })}`),
  createTemplate: (data: { title: string; description?: string; baseOrgId: string; items: unknown[] }) =>
    api.post<TeamTaskTemplate>("/team-daily/templates", data),
  updateTemplate: (id: string, data: unknown, baseOrgId?: string) =>
    api.patch<TeamTaskTemplate>(`/team-daily/templates/${id}${buildQuery({ baseOrgId })}`, data),
  deleteTemplate: (id: string, baseOrgId?: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/team-daily/templates/${id}${buildQuery({ baseOrgId })}`),
  copyTemplate: (id: string, baseOrgId?: string) =>
    api.post<TeamTaskTemplate>(`/team-daily/templates/${id}/copy${buildQuery({ baseOrgId })}`),
  archiveTemplate: (id: string, baseOrgId?: string) =>
    api.post<TeamTaskTemplate>(`/team-daily/templates/${id}/archive${buildQuery({ baseOrgId })}`),

  // ── 发布任务 ──
  listAssignments: (params?: { baseOrgId?: string; status?: string; limit?: number; offset?: number }) =>
    api.get<TeamTaskAssignment[]>(`/team-daily/assignments${buildQuery(params)}`),
  saveDraft: (data: { assignmentId?: string; templateId: string; baseOrgId: string; teamOrgIds: string[]; effectMode?: string }) =>
    api.post<TeamTaskAssignment>("/team-daily/assignments/draft", data),
  getPublishPreview: (id: string, baseOrgId?: string) =>
    api.get<{
      assignmentId: string;
      templateId: string;
      templateTitle: string;
      effectMode: string;
      targetOrgCount: number;
      targetOrgs: { id: string; name: string }[];
      overlappingAssignments: Array<{ id: string; title: string; status: string }>;
    }>(`/team-daily/assignments/${id}/preview${buildQuery({ baseOrgId })}`),
  publishDraft: (id: string, effectMode: string, baseOrgId?: string) =>
    api.post<TeamTaskAssignment>(`/team-daily/assignments/${id}/publish`, { effectMode, baseOrgId }),
  closeAssignment: (id: string, baseOrgId?: string) =>
    api.post<TeamTaskAssignment>(`/team-daily/assignments/${id}/close`, { baseOrgId }),
  deleteAssignment: (id: string, baseOrgId?: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/team-daily/assignments/${id}${buildQuery({ baseOrgId })}`),

  // ── 执行层（团队管理员填报）──
  getMyRecords: () =>
    api.get<TeamTaskRecord[]>("/team-daily/my-records"),

  submitItemRecord: (data: {
    taskRecordId: string;
    taskItemId: string;
    answerText?: string;
    answerOptions?: string[];
    isLinkConfirmed?: boolean;
    done: boolean;
  }) => api.post<TeamTaskItemRecord>("/team-daily/item-records", data),

  submitRecord: (id: string) =>
    api.post<TeamTaskRecord>(`/team-daily/my-records/${id}/submit`),

  applyLeave: (recordId: string, reason: string) =>
    api.post<TeamTaskLeaveRequest>(`/team-daily/my-records/${recordId}/leave-requests`, { reason }),

  cancelLeave: (leaveRequestId: string) =>
    api.post<TeamTaskLeaveRequest>(`/team-daily/leave-requests/${leaveRequestId}/cancel`, {}),

  approveLeave: (leaveRequestId: string, comment?: string) =>
    api.post<TeamTaskLeaveRequest>(`/team-daily/leave-requests/${leaveRequestId}/approve`, { comment }),

  rejectLeave: (leaveRequestId: string, comment: string) =>
    api.post<TeamTaskLeaveRequest>(`/team-daily/leave-requests/${leaveRequestId}/reject`, { comment }),

  uploadAttachment: (teamTaskItemRecordId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("teamTaskItemRecordId", teamTaskItemRecordId);
    return api.postForm<TeamTaskItemAttachment>("/tasks/team-daily/upload", form);
  },

  deleteAttachment: (id: string) =>
    api.delete<{ deleted: boolean }>(`/tasks/team-daily/attachments/${id}`),
};


export const reportApi = {
  getTeamDailyDashboard: (taskDate?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    const q = params.toString();
    return api.get<import("../types").TeamDailyDashboardResponse>(`/tasks/report/team-daily-dashboard${q ? `?${q}` : ""}`);
  },
  getTeamDailyAdminOverview: (params?: { taskDate?: string; scopeOrgId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.taskDate) qs.set("taskDate", params.taskDate);
    if (params?.scopeOrgId) qs.set("scopeOrgId", params.scopeOrgId);
    const q = qs.toString();
    return api.get<import("../types").TeamDailyAdminOverviewResponse>(`/tasks/report/team-daily-dashboard/overview${q ? `?${q}` : ""}`);
  },
  getTeamDailyAdminTeamHalls: (baseOrgId: string, params?: { taskDate?: string }) => {
    const qs = new URLSearchParams();
    if (params?.taskDate) qs.set("taskDate", params.taskDate);
    const q = qs.toString();
    return api.get<import("../types").TeamDailyAdminHallRow[]>(`/tasks/report/team-daily-dashboard/teams/${encodeURIComponent(baseOrgId)}/halls${q ? `?${q}` : ""}`);
  },
  getTeamDailyAdminHallDetail: (teamOrgId: string, params?: { taskDate?: string }) => {
    const qs = new URLSearchParams();
    if (params?.taskDate) qs.set("taskDate", params.taskDate);
    const q = qs.toString();
    return api.get<import("../types").TeamDailyAdminHallDetailResponse>(`/tasks/report/team-daily-dashboard/halls/${encodeURIComponent(teamOrgId)}/detail${q ? `?${q}` : ""}`);
  },
};
