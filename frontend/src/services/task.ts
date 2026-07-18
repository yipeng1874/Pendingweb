import type {
  AssignmentDailyReportItem,
  AssignmentProgressReport,
  DailyPublishPreview,
  PersonalReminder,
  TaskAssignment,
  TaskEffectMode,
  TaskExemption,
  TaskItemRecord,
  TaskRecord,
  TaskTemplate,
  TemporaryDashboardAssignmentListResponse,
  TemporaryDashboardAnchorHallNodeResponse,
  TemporaryDashboardAnchorTeamNodeResponse,
  TemporaryDashboardProgressFilter,
  TemporaryDashboardRecordDetailResponse,
  TemporaryDashboardRecordListResponse,
  TemporaryDashboardSummaryResponse,
  TemporaryPublishPreview,
  TemporaryTaskMode,
} from "../types";


import { api } from "./http";
import { useAuthStore } from "../stores/authStore";
import { useIdentityStore } from "../stores/identityStore";

type AssignmentListParams = {
  category?: string;
  scopeOrgId?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

type ScopeParams = {
  scopeOrgId?: string;
};

type NotifyScopeOrg = {
  id: string;
  name: string;
  orgType: string;
};

export type DailyNotifyIntervalOption = {
  intervalHours: 12 | 6 | 3 | 2 | 1;
  label: string;
  description: string;
};

export type DailyFeishuNotifyPreview = {
  taskDate: string;
  scopeOrg: NotifyScopeOrg;
  prefixPlaceholder: string;
  total: number;
  pendingCount: number;
  inProgressCount: number;
  boundCount: number;
  unboundCount: number;
  configSummaries: Array<{ feishuConfigId: string; total: number; pending: number; inProgress: number }>;
  unboundUsers: Array<{ userId: string; nickname: string; phone: string; status: string }>;
};

type DailyFeishuNotifySendBatchResult = {
  feishuConfigId: string;
  configName: string;
  targetCount: number;
  successCount: number;
  invalidOpenIds: string[];
  messageId: string | null;
  error?: string;
};

export type DailyFeishuNotifySendResult = {
  taskDate: string;
  prefix: string;
  scopeOrg: NotifyScopeOrg;
  summary: DailyFeishuNotifyPreview;
  results: DailyFeishuNotifySendBatchResult[];
};

export type DailyFeishuNotifySchedule = {
  scopeOrg: NotifyScopeOrg;
  enabled: boolean;
  intervalHours: DailyNotifyIntervalOption["intervalHours"];
  prefix: string;
  prefixPlaceholder: string;
  sharedByBase: boolean;
  lastTriggeredSlot: string | null;
  options: DailyNotifyIntervalOption[];
};

export type DailyFeishuNotifyTestResult = DailyFeishuNotifySendResult & {
  testMode: boolean;
  schedule: DailyFeishuNotifySchedule;
};

type TemporaryFeishuNotifyPreview = {
  assignmentId: string;
  mode: TemporaryTaskMode;
  scopeOrgId?: string;
  prefixPlaceholder: string;
  templateTitle: string;
  total: number;
  pendingCount: number;
  inProgressCount: number;
  boundCount: number;
  unboundCount: number;
  distinctUserCount: number;
  modeSummary: { userSubjectCount: number; orgSubjectCount: number };
  configSummaries: Array<{ feishuConfigId: string; total: number; pending: number; inProgress: number }>;
  unboundUsers: Array<{ userId: string; nickname: string; phone: string; status: string; subjectName: string }>;
};

type TemporaryFeishuNotifySendResult = {
  assignmentId: string;
  mode: TemporaryTaskMode;
  prefix: string;
  summary: TemporaryFeishuNotifyPreview;
  results: Array<{ feishuConfigId: string; configName: string; targetCount: number; successCount: number; invalidOpenIds: string[]; messageId: string | null; error?: string }>;
};

export type TemporaryNotifySchedule = {
  enabled: boolean;
  prefix: string;
  tier1DailyCount: number; // ≤1天
  tier2DailyCount: number; // 2-3天
  tier3DailyCount: number; // 4-7天
  tier4DailyCount: number; // 8-15天
  tier5DailyCount: number; // >15天
  tierLabels?: string[];
  validDailyCounts?: number[];
};

type TemporaryDashboardAssignmentListParams = {
  scopeOrgId?: string;
  mode?: string;
  lifecycle?: "active" | "ended";
  limit?: number;
  offset?: number;
};

type TemporaryDashboardRecordListParams = {
  filter?: TemporaryDashboardProgressFilter;
  keyword?: string;
  limit?: number;
  offset?: number;
};

type TemplateListParams = {
  orgId?: string;
  category?: string;
  status?: string;
  scopeOrgId?: string;
  limit?: number;
  offset?: number;
};

type TemporaryDraftPayload = {
  assignmentId?: string;
  templateId: string;
  orgIds?: string[];
  excludedOrgIds?: string[];
  excludedAnchorProfileIds?: string[];
  deadlineAt?: string;
  scopeOrgId?: string;
  mode?: TemporaryTaskMode;
  targetRoleCodes?: string[];
  targetUserIds?: string[];
  subjectOrgType?: "BASE" | "TEAM" | "HALL";
  preDeadlineConfirmEnabled?: boolean;
};

function buildQuery(params?: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });

  const q = query.toString();
  return q ? `?${q}` : "";
}

export const templateApi = {
  list: (params?: TemplateListParams) => api.get<TaskTemplate[]>(`/tasks/templates${buildQuery(params)}`),
  getById: (id: string, params?: ScopeParams) => api.get<TaskTemplate>(`/tasks/templates/${id}${buildQuery(params)}`),
  create: (data: { title: string; description?: string; category: string; orgId: string; scopeOrgId?: string; items: unknown[] }) =>
    api.post<TaskTemplate>("/tasks/templates", data),
  update: (id: string, data: unknown, params?: ScopeParams) => api.patch<TaskTemplate>(`/tasks/templates/${id}${buildQuery(params)}`, data),
  delete: (id: string, params?: ScopeParams) => api.delete<{ deleted: boolean; id: string }>(`/tasks/templates/${id}${buildQuery(params)}`),
  copy: (id: string, params?: ScopeParams) => api.post<TaskTemplate>(`/tasks/templates/${id}/copy${buildQuery(params)}`),
};

export const assignmentApi = {
  list: (params?: string | AssignmentListParams) => {
    const normalized = typeof params === "string" ? { category: params } : params;
    return api.get<TaskAssignment[]>(`/tasks/assignments${buildQuery(normalized)}`);
  },
  getById: (id: string, params?: ScopeParams) => api.get<TaskAssignment>(`/tasks/assignments/${id}${buildQuery(params)}`),
  getTargets: (id: string, params?: ScopeParams) => api.get<unknown>(`/tasks/assignments/${id}/targets${buildQuery(params)}`),
  create: (data: {
    templateId: string;
    category: string;
    targetRoleType: string;
    targetAdminLevels?: string[];
    targetRoleCodes?: string[];
    mode?: TemporaryTaskMode;
    subjectOrgType?: "BASE" | "TEAM" | "HALL";
    deadlineAt?: string;
    orgIds: string[];
    excludedOrgIds?: string[];
    excludedAnchorProfileIds?: string[];
    scopeOrgId?: string;
  }) => api.post<TaskAssignment>("/tasks/assignments", data),
  saveTemporaryDraft: (data: TemporaryDraftPayload) => api.post<TaskAssignment>("/tasks/assignments/temporary-drafts", data),
  getTemporaryPublishPreview: (id: string, params?: ScopeParams) =>
    api.get<TemporaryPublishPreview>(`/tasks/assignments/${id}/temporary-preview${buildQuery(params)}`),
  publishTemporaryDraft: (id: string, scopeOrgId?: string) => api.post<TaskAssignment>(`/tasks/assignments/${id}/temporary-publish`, { scopeOrgId }),
  saveDailyDraft: (data: {
    assignmentId?: string;
    templateId: string;
    orgIds: string[];
    excludedOrgIds?: string[];
    excludedAnchorProfileIds?: string[];
    effectMode?: TaskEffectMode;
    scopeOrgId?: string;
  }) => api.post<TaskAssignment>("/tasks/assignments/daily-drafts", data),
  getDailyPublishPreview: (id: string, params?: ScopeParams) => api.get<DailyPublishPreview>(`/tasks/assignments/${id}/publish-preview${buildQuery(params)}`),
  publishDailyDraft: (id: string, effectMode: TaskEffectMode, scopeOrgId?: string) => api.post<TaskAssignment>(`/tasks/assignments/${id}/publish`, { effectMode, scopeOrgId }),
  // 厅管日常任务专属 API
  saveHallDailyDraft: (data: {
    assignmentId?: string;
    templateId: string;
    orgIds: string[];
    effectMode?: TaskEffectMode;
    scopeOrgId?: string;
  }) => api.post<TaskAssignment>("/tasks/assignments/hall-daily-drafts", data),
  getHallDailyPublishPreview: (id: string, params?: ScopeParams) =>
    api.get<{ assignmentId: string; templateId: string; templateTitle: string; effectMode: TaskEffectMode; targetOrgCount: number; targetOrgs: { id: string; name: string }[]; overlappingAssignments: unknown[] }>(`/tasks/assignments/${id}/hall-daily-preview${buildQuery(params)}`),
  publishHallDailyDraft: (id: string, effectMode: TaskEffectMode, scopeOrgId?: string) =>
    api.post<TaskAssignment>(`/tasks/assignments/${id}/hall-daily-publish`, { effectMode, scopeOrgId }),
  update: (
    id: string,
    data: {
      templateId?: string;
      orgIds?: string[];
      excludedOrgIds?: string[];
      excludedAnchorProfileIds?: string[];
      deadlineAt?: string;
      effectMode?: TaskEffectMode;
      targetRoleCodes?: string[];
      targetUserIds?: string[];
      mode?: TemporaryTaskMode;

      subjectOrgType?: "BASE" | "TEAM" | "HALL";
      scopeOrgId?: string;

    }
  ) => api.patch<TaskAssignment>(`/tasks/assignments/${id}`, data),
  delete: (id: string, params?: ScopeParams) => api.delete<{ deleted: boolean; hardDeleted?: boolean; revertedToDraft?: boolean; id: string; templateId?: string }>(`/tasks/assignments/${id}${buildQuery(params)}`),
  close: (id: string, scopeOrgId?: string) => api.post<TaskAssignment>(`/tasks/assignments/${id}/close`, { scopeOrgId }),
  reopen: (id: string, scopeOrgId?: string) => api.post<TaskAssignment>(`/tasks/assignments/${id}/reopen`, { scopeOrgId }),
};

export const recordApi = {
  getMyRecords: () => api.get<TaskRecord[]>("/tasks/my-records"),
  getRecord: (id: string) => api.get<TaskRecord>(`/tasks/my-records/${id}`),
  submitItemRecord: (data: { taskRecordId: string; taskItemId: string; answerText?: string; answerOptions?: string[]; isLinkConfirmed?: boolean; done: boolean }) =>
    api.post<TaskItemRecord | TaskRecord>("/tasks/item-records", data),
  submitRecord: (id: string) => api.post<TaskRecord>(`/tasks/my-records/${id}/submit`),
  reconfirmRecord: (id: string) => api.post<TaskRecord>(`/tasks/my-records/${id}/reconfirm`),
  applyExemption: (data: { taskRecordId: string; reason: string }) => api.post<TaskExemption>("/tasks/exemptions", data),
  cancelExemption: (taskRecordId: string) => api.delete(`/tasks/exemptions/${taskRecordId}`),
  listExemptions: (status?: string) => api.get<TaskExemption[]>(`/tasks/exemptions${status ? `?status=${status}` : ""}`),
  reviewExemption: (id: string, approved: boolean) => api.post(`/tasks/exemptions/${id}/review`, { approved }),
};

export const uploadApi = {
  upload: async (taskItemRecordId: string, file: File): Promise<{ fileUrl: string; id: string }> => {
    const token = useAuthStore.getState().token;
    const identityId = useIdentityStore.getState().currentIdentity?.id;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("taskItemRecordId", taskItemRecordId);
    const resp = await fetch("/api/tasks/upload", {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(identityId ? { "X-Identity-Id": identityId } : {}),
      },
      body: formData,
    });
    const body = await resp.json();
    if (!body.success) throw new Error(body.error?.message ?? "上传失败");
    return body.data;
  },
  deleteAttachment: (id: string) => api.delete(`/tasks/attachments/${id}`),
};

export const reminderApi = {
  list: (status?: string) => api.get<PersonalReminder[]>(`/tasks/reminders${status ? `?status=${status}` : ""}`),
  create: (data: { title: string; note?: string; remindEnd?: string; isImportant?: boolean; remindAt?: string; remindStart?: string; repeatType?: string }) => api.post<PersonalReminder>("/tasks/reminders", data),
  update: (id: string, data: Partial<PersonalReminder>) => api.patch<PersonalReminder>(`/tasks/reminders/${id}`, data),
  delete: (id: string) => api.delete(`/tasks/reminders/${id}`),
  done: (id: string) => api.post<PersonalReminder>(`/tasks/reminders/${id}/done`),
};


export const notifyApi = {
  getDailyFeishuPreview: (taskDate?: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<DailyFeishuNotifyPreview>(`/tasks/notify/daily-feishu/preview${q ? `?${q}` : ""}`);
  },
  sendDailyFeishu: (data: { taskDate?: string; scopeOrgId?: string; prefix: string }) =>
    api.post<DailyFeishuNotifySendResult>("/tasks/notify/daily-feishu/send", data),
  getDailyNotifySchedule: (scopeOrgId?: string) =>
    api.get<DailyFeishuNotifySchedule>(`/tasks/notify/daily-schedule${buildQuery({ scopeOrgId })}`),
  saveDailyNotifySchedule: (data: { scopeOrgId?: string; enabled: boolean; intervalHours: number; prefix: string }) =>
    api.put<DailyFeishuNotifySchedule>("/tasks/notify/daily-schedule", data),
  testDailyNotifySchedule: (data: { taskDate?: string; scopeOrgId?: string; prefix?: string }) =>
    api.post<DailyFeishuNotifyTestResult>("/tasks/notify/daily-schedule/test", data),
  getTemporaryFeishuPreview: (assignmentId: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    params.set("assignmentId", assignmentId);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<TemporaryFeishuNotifyPreview>(`/tasks/notify/temporary-feishu/preview?${q}`);
  },
  sendTemporaryFeishu: (data: { assignmentId: string; scopeOrgId?: string; prefix: string }) =>
    api.post<TemporaryFeishuNotifySendResult>("/tasks/notify/temporary-feishu/send", data),
  getTemporaryNotifySchedule: () =>
    api.get<TemporaryNotifySchedule>("/tasks/notify/temporary-schedule"),
  saveTemporaryNotifySchedule: (data: Partial<TemporaryNotifySchedule>) =>
    api.put<TemporaryNotifySchedule>("/tasks/notify/temporary-schedule", data),
};

// ─── 厅管日常任务独立 API（对接 /api/hall-daily/* 路由） ─────────────────────

// ── 执行层类型 ──
export type HallTaskItemAttachment = {
  id: string;
  hallTaskItemRecordId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
};

export type HallTaskItemRecord = {
  id: string;
  taskRecordId: string;
  taskItemId: string;
  status: "pending" | "done";
  answerText?: string | null;
  answerOptions?: string[] | null;
  isLinkConfirmed: boolean;
  doneAt?: string | null;
  doneBy?: string | null;
  attachments?: HallTaskItemAttachment[];
};

export type HallTaskLeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type HallTaskLeaveRequest = {
  id: string;
  taskRecordId: string;
  applicantUserId: string;
  applicantName?: string | null;
  reason: string;
  status: HallTaskLeaveStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewComment?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HallTaskRecord = {
  id: string;
  assignmentId: string;
  hallOrgId: string;
  hallOrg?: { id: string; name: string } | null;
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
  itemRecords?: HallTaskItemRecord[];
  leaveRequests?: HallTaskLeaveRequest[];
};

export type HallTaskTemplate = {
  id: string;
  title: string;
  description?: string;
  teamOrgId: string;
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

export type HallTaskAssignment = {
  id: string;
  templateId: string;
  teamOrgId: string;
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
  targets?: Array<{ id: string; hallOrgId: string; hallOrg: { id: string; name: string } }>;
  _count?: { records: number };
};

export const hallDailyApi = {
  // ── 模板 ──
  listTemplates: (params?: { teamOrgId?: string; status?: string; neverPublished?: boolean; limit?: number; offset?: number }) =>
    api.get<HallTaskTemplate[]>(`/hall-daily/templates${buildQuery(params)}`),
  getTemplateById: (id: string, teamOrgId?: string) =>
    api.get<HallTaskTemplate>(`/hall-daily/templates/${id}${buildQuery({ teamOrgId })}`),
  createTemplate: (data: { title: string; description?: string; teamOrgId: string; items: unknown[] }) =>
    api.post<HallTaskTemplate>("/hall-daily/templates", data),
  updateTemplate: (id: string, data: unknown, teamOrgId?: string) =>
    api.patch<HallTaskTemplate>(`/hall-daily/templates/${id}${buildQuery({ teamOrgId })}`, data),
  deleteTemplate: (id: string, teamOrgId?: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/hall-daily/templates/${id}${buildQuery({ teamOrgId })}`),
  copyTemplate: (id: string, teamOrgId?: string) =>
    api.post<HallTaskTemplate>(`/hall-daily/templates/${id}/copy${buildQuery({ teamOrgId })}`),
  archiveTemplate: (id: string, teamOrgId?: string) =>
    api.post<HallTaskTemplate>(`/hall-daily/templates/${id}/archive${buildQuery({ teamOrgId })}`),

  // ── 发布任务 ──
  listAssignments: (params?: { teamOrgId?: string; status?: string; limit?: number; offset?: number }) =>
    api.get<HallTaskAssignment[]>(`/hall-daily/assignments${buildQuery(params)}`),
  saveDraft: (data: { assignmentId?: string; templateId: string; teamOrgId: string; hallOrgIds: string[]; effectMode?: string }) =>
    api.post<HallTaskAssignment>("/hall-daily/assignments/draft", data),
  getPublishPreview: (id: string, teamOrgId?: string) =>
    api.get<{
      assignmentId: string;
      templateId: string;
      templateTitle: string;
      effectMode: string;
      targetOrgCount: number;
      targetOrgs: { id: string; name: string }[];
      overlappingAssignments: Array<{ id: string; title: string; status: string }>;
    }>(`/hall-daily/assignments/${id}/preview${buildQuery({ teamOrgId })}`),
  publishDraft: (id: string, effectMode: string, teamOrgId?: string) =>
    api.post<HallTaskAssignment>(`/hall-daily/assignments/${id}/publish`, { effectMode, teamOrgId }),
  closeAssignment: (id: string, teamOrgId?: string) =>
    api.post<HallTaskAssignment>(`/hall-daily/assignments/${id}/close`, { teamOrgId }),
  deleteAssignment: (id: string, teamOrgId?: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/hall-daily/assignments/${id}${buildQuery({ teamOrgId })}`),

  // ── 执行层（厅管填报）──
  getMyRecords: () =>
    api.get<HallTaskRecord[]>("/hall-daily/my-records"),

  submitItemRecord: (data: {
    taskRecordId: string;
    taskItemId: string;
    answerText?: string;
    answerOptions?: string[];
    isLinkConfirmed?: boolean;
    done: boolean;
  }) => api.post<HallTaskItemRecord>("/hall-daily/item-records", data),

  submitRecord: (id: string) =>
    api.post<HallTaskRecord>(`/hall-daily/my-records/${id}/submit`),

  applyLeave: (recordId: string, reason: string) =>
    api.post<HallTaskLeaveRequest>(`/hall-daily/my-records/${recordId}/leave-requests`, { reason }),

  cancelLeave: (leaveRequestId: string) =>
    api.post<HallTaskLeaveRequest>(`/hall-daily/leave-requests/${leaveRequestId}/cancel`, {}),

  approveLeave: (leaveRequestId: string, comment?: string) =>
    api.post<HallTaskLeaveRequest>(`/hall-daily/leave-requests/${leaveRequestId}/approve`, { comment }),

  rejectLeave: (leaveRequestId: string, comment: string) =>
    api.post<HallTaskLeaveRequest>(`/hall-daily/leave-requests/${leaveRequestId}/reject`, { comment }),

  uploadAttachment: (hallTaskItemRecordId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("hallTaskItemRecordId", hallTaskItemRecordId);
    return api.postForm<HallTaskItemAttachment>("/tasks/hall-daily/upload", form);
  },

  deleteAttachment: (id: string) =>
    api.delete<{ deleted: boolean }>(`/tasks/hall-daily/attachments/${id}`),
};

export const reportApi = {
  getProgress: (assignmentId: string) => api.get<AssignmentProgressReport>(`/tasks/report/assignments/${assignmentId}/progress`),
  listTemporaryDashboardAssignments: (params?: TemporaryDashboardAssignmentListParams) => api.get<TemporaryDashboardAssignmentListResponse>(`/tasks/report/temporary-dashboard/assignments${buildQuery(params)}`),
  getTemporaryDashboardSummary: (assignmentId: string) => api.get<TemporaryDashboardSummaryResponse>(`/tasks/report/temporary-dashboard/assignments/${assignmentId}/summary`),
  getTemporaryDashboardRecords: (assignmentId: string, params?: TemporaryDashboardRecordListParams) => api.get<TemporaryDashboardRecordListResponse>(`/tasks/report/temporary-dashboard/assignments/${assignmentId}/records${buildQuery(params)}`),
  getTemporaryDashboardAnchorTeamNodes: (assignmentId: string) => api.get<TemporaryDashboardAnchorTeamNodeResponse>(`/tasks/report/temporary-dashboard/assignments/${assignmentId}/anchor-team-nodes`),
  getTemporaryDashboardAnchorHallNodes: (assignmentId: string, teamOrgId: string) => api.get<TemporaryDashboardAnchorHallNodeResponse>(`/tasks/report/temporary-dashboard/assignments/${assignmentId}/anchor-teams/${teamOrgId}/hall-nodes`),
  getTemporaryDashboardAnchorHallRecords: (assignmentId: string, hallOrgId: string, params?: TemporaryDashboardRecordListParams) => api.get<TemporaryDashboardRecordListResponse>(`/tasks/report/temporary-dashboard/assignments/${assignmentId}/anchor-halls/${hallOrgId}/records${buildQuery(params)}`),
  getTemporaryDashboardRecordDetail: (recordId: string) => api.get<TemporaryDashboardRecordDetailResponse>(`/tasks/report/temporary-dashboard/records/${recordId}/detail`),
  getTemporaryActiveModeCount: (scopeOrgId: string) => api.get<{ ACCOUNT: number; ANCHOR: number; MANAGER: number }>(`/tasks/report/temporary-dashboard/active-mode-counts?scopeOrgId=${encodeURIComponent(scopeOrgId)}`),
  getDaily: (assignmentId: string, startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const q = params.toString();
    return api.get<AssignmentDailyReportItem[]>(`/tasks/report/assignments/${assignmentId}/daily${q ? `?${q}` : ""}`);
  },

  getSummary: () => api.get<{ activeAssignments: number; totalTemplates: number; pendingExemptions: number }>("/tasks/report/summary"),
  getDailyDashboard: (taskDate?: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<import("../types").DailyDashboardResponse>(`/tasks/report/daily-dashboard${q ? `?${q}` : ""}`);
  },
  getDailyDashboardTeamChildren: (teamOrgId: string, taskDate?: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<import("../types").DailyDashboardTeamChildrenResponse>(`/tasks/report/daily-dashboard/teams/${teamOrgId}/children${q ? `?${q}` : ""}`);
  },
  getDailyDashboardHallDetails: (hallOrgId: string, taskDate?: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<import("../types").DailyDashboardHallDetailsResponse>(`/tasks/report/daily-dashboard/halls/${hallOrgId}/details${q ? `?${q}` : ""}`);
  },
  getDailyDashboardAnchorItems: (hallOrgId: string, userId: string, taskDate?: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<import("../types").DailyDashboardAnchorItemDetailResponse>(`/tasks/report/daily-dashboard/halls/${hallOrgId}/anchors/${userId}/items${q ? `?${q}` : ""}`);
  },
  getDailyRangeStats: (startDate: string, endDate: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<import("../types").DailyRangeStatsResponse>(`/tasks/report/daily-range-stats?${params.toString()}`);
  },
  getHallDailyRangeStats: (startDate: string, endDate: string, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<import("../types").DailyRangeStatsResponse>(`/tasks/report/hall-daily-range-stats?${params.toString()}`);
  },
  getHallDailyDashboard: (taskDate?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    const q = params.toString();
    return api.get<import("../types").HallDailyDashboardResponse>(`/tasks/report/hall-daily-dashboard${q ? `?${q}` : ""}`);
  },
  getHallDailyAdminOverview: (params?: { taskDate?: string; scopeOrgId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.taskDate) qs.set("taskDate", params.taskDate);
    if (params?.scopeOrgId) qs.set("scopeOrgId", params.scopeOrgId);
    const q = qs.toString();
    return api.get<import("../types").HallDailyAdminOverviewResponse>(`/tasks/report/hall-daily-dashboard/overview${q ? `?${q}` : ""}`);
  },
  getHallDailyAdminTeamHalls: (teamOrgId: string, params?: { taskDate?: string }) => {
    const qs = new URLSearchParams();
    if (params?.taskDate) qs.set("taskDate", params.taskDate);
    const q = qs.toString();
    return api.get<import("../types").HallDailyAdminHallRow[]>(`/tasks/report/hall-daily-dashboard/teams/${encodeURIComponent(teamOrgId)}/halls${q ? `?${q}` : ""}`);
  },
  getHallDailyAdminHallDetail: (hallOrgId: string, params?: { taskDate?: string }) => {
    const qs = new URLSearchParams();
    if (params?.taskDate) qs.set("taskDate", params.taskDate);
    const q = qs.toString();
    return api.get<import("../types").HallDailyAdminHallDetailResponse>(`/tasks/report/hall-daily-dashboard/halls/${encodeURIComponent(hallOrgId)}/detail${q ? `?${q}` : ""}`);
  },
};

// ---------- 主播汇总 ----------

export type OperatorStat = {
  name: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within20Days: number;
  dailyNew: number;
};

export type AnchorDailySummary = {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  recordDate: string;
  uploadedBy: string;
  uploaderName: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within20Days: number;
  dailyNew: number;
  operatorStats: OperatorStat[];
  rawRowCount: number;
  probationDays?: number;
  probationExcluded?: number;
  createdAt: string;
  updatedAt: string;
};

export type AnchorTrendPoint = {
  recordDate: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within20Days: number;
  dailyNew: number;
  probationDays?: number;
  probationExcluded?: number;
};

export type AnchorTrendResponse = {
  baseOrgId: string;
  baseOrgName: string;
  points: AnchorTrendPoint[];
  latest: AnchorDailySummary | null;
};

export const anchorSummaryApi = {
  getLatest: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<AnchorDailySummary | null>(`/anchor-summary/latest${q ? `?${q}` : ""}`);
  },
  getTrend: (scopeOrgId?: string, days = 7, probationDays = 0) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    params.set("days", String(days));
    if (probationDays > 0) params.set("probationDays", String(probationDays));
    const q = params.toString();
    return api.get<AnchorTrendResponse>(`/anchor-summary/trend?${q}`);
  },
  upload: (file: File, scopeOrgId?: string, recordDate?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (recordDate) formData.append("recordDate", recordDate);
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.postForm<AnchorDailySummary>(`/anchor-summary/upload${q ? `?${q}` : ""}`, formData);
  },
};

// ---------- 厅个数汇总 ----------

export type HallOperatorStat = {
  operator: string;
  formalHallCount: number;
  trainingHallCount: number;
  totalCount: number;
};

export type HallDailySummary = {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  recordDate: string;
  uploadedBy: string;
  uploaderName: string;
  formalHallCount: number;
  trainingHallCount: number;
  totalHallCount: number;
  operatorStats: HallOperatorStat[];
  rawRowCount: number;
  createdAt: string;
  updatedAt: string;
};

export type HallTrendPoint = {
  recordDate: string;
  formalHallCount: number;
  trainingHallCount: number;
  totalHallCount: number;
};

export type HallPrevDay = {
  recordDate: string;
  operatorStats: HallOperatorStat[];
};

export type HallTrendResponse = {
  baseOrgId: string;
  baseOrgName: string;
  points: HallTrendPoint[];
  latest: HallDailySummary | null;
  prevDay: HallPrevDay | null;
};

export const hallSummaryApi = {
  getLatest: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<HallDailySummary | null>(`/hall-summary/latest${q ? `?${q}` : ""}`);
  },
  getTrend: (scopeOrgId?: string, days = 7) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    params.set("days", String(days));
    const q = params.toString();
    return api.get<HallTrendResponse>(`/hall-summary/trend?${q}`);
  },
  upload: (file: File, scopeOrgId?: string, recordDate?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (recordDate) formData.append("recordDate", recordDate);
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    if (recordDate) params.set("recordDate", recordDate);
    const q = params.toString();
    return api.postForm<HallDailySummary>(`/hall-summary/upload${q ? `?${q}` : ""}`, formData);
  },
};

// ---------- 主播流失汇总 ----------

export type AnchorLossDailySummary = {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  recordDate: string;
  uploadedBy: string;
  uploaderName: string;
  lossWithin30Days: number;
  lossYesterday: number;
  totalLossCount: number;
  rawRowCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AnchorLossTrendPoint = {
  recordDate: string;
  lossWithin30Days: number;
  lossYesterday: number;
  lossDetail: Record<string, number>;
  lossOperatorDetail: Record<string, Record<string, number>>;
};

export type AnchorLossTrendResponse = {
  baseOrgId: string;
  baseOrgName: string;
  points: AnchorLossTrendPoint[];
  latest: Pick<AnchorLossDailySummary, "id" | "recordDate" | "lossWithin30Days" | "lossYesterday" | "totalLossCount"> & { lossDetail: Record<string, number>; lossOperatorDetail: Record<string, Record<string, number>> } | null;
};

export const anchorLossSummaryApi = {
  getLatest: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<AnchorLossDailySummary | null>(`/anchor-loss-summary/latest${q ? `?${q}` : ""}`);
  },
  getTrend: (scopeOrgId?: string, days = 7) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    params.set("days", String(days));
    const q = params.toString();
    return api.get<AnchorLossTrendResponse>(`/anchor-loss-summary/trend?${q}`);
  },
  upload: (file: File, scopeOrgId?: string, recordDate?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (recordDate) formData.append("recordDate", recordDate);
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    if (recordDate) params.set("recordDate", recordDate);
    const q = params.toString();
    return api.postForm<AnchorLossDailySummary>(`/anchor-loss-summary/upload${q ? `?${q}` : ""}`, formData);
  },
};

// ---------- 数据看板统一上传 ----------

export type DataOverviewUploadResult = {
  recordDate: string;
  baseOrgId: string;
  hall?: { formalHallCount: number; trainingHallCount: number };
  loss?: { lossWithin30Days: number; lossYesterday: number };
};

export const dataOverviewApi = {
  upload: (file: File, scopeOrgId?: string, recordDate?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (recordDate) formData.append("recordDate", recordDate);
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    if (recordDate) params.set("recordDate", recordDate);
    const q = params.toString();
    return api.postForm<DataOverviewUploadResult>(`/data-overview/upload${q ? `?${q}` : ""}`, formData);
  },
};

// ---------- 基地直播间空余 ----------

export type RoomTypeDetail = {
  typeName: string;          // 自定义房间类型名
  used: number;              // 已使用
  total: number;             // 总数
};

export type SiteDetail = {
  siteId: string;            // 对应 live_room_sites.id
  siteName: string;          // 冗余场地名
  rooms: RoomTypeDetail[];
};

export type LiveRoomCapacity = {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  siteDetails: SiteDetail[];  // 核心字段：多场地 + 自定义类型
  updatedBy: string;
  updaterName: string;
  createdAt: string;
  updatedAt: string;
};

export type LiveRoomSite = {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  name: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
};

export type LiveRoomCapacityUpsertInput = {
  siteDetails: SiteDetail[];
};

export const liveRoomCapacityApi = {
  getLatest: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<LiveRoomCapacity | null>(`/live-room-capacity/latest${q ? `?${q}` : ""}`);
  },
  upsert: (data: LiveRoomCapacityUpsertInput, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.post<LiveRoomCapacity>(`/live-room-capacity/upsert${q ? `?${q}` : ""}`, data);
  },
};

// ── 场地管理 API ──
export const liveRoomSiteApi = {
  list: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<LiveRoomSite[]>(`/live-room-sites${q ? `?${q}` : ""}`);
  },
  create: (data: { name: string; sort?: number }, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.post<LiveRoomSite>(`/live-room-sites${q ? `?${q}` : ""}`, data);
  },
  update: (id: string, data: { name?: string; sort?: number }) =>
    api.put<LiveRoomSite>(`/live-room-sites/${id}`, data),
  delete: (id: string) =>
    api.delete<{ id: string }>(`/live-room-sites/${id}`),
};

// ---------- 人均音浪 ----------

export type AnchorAvgWaveDaily = {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  recordDate: string;
  waveType: string;
  avgWaveValue: number;
  totalWave: number;
  anchorCount: number;
  uploadedBy: string;
  uploaderName: string;
  createdAt: string;
  updatedAt: string;
};

export type AnchorAvgWaveTrendPoint = {
  recordDate: string;
  avgWaveValue: number;
};

export type AnchorAvgWaveLatest = {
  id: string;
  recordDate: string;
  avgWaveValue: number;
  totalWave: number;
  anchorCount: number;
  uploadedBy: string;
  uploaderName: string;
};

export type WaveTypeTrend = {
  points: AnchorAvgWaveTrendPoint[];
  latest: AnchorAvgWaveLatest | null;
  prevDay: { recordDate: string; avgWaveValue: number } | null;
  change: number;
};

export type AnchorAvgWaveTrendResponse = {
  baseOrgId: string;
  baseOrgName: string;
  online: WaveTypeTrend;
  offline: WaveTypeTrend;
  total: WaveTypeTrend;
};

export type AnchorAvgWaveUpsertInput = {
  recordDate: string;
  avgWaveValue: number;
  waveType?: string;
  totalWave?: number;
  anchorCount?: number;
};

export type AnchorAvgWaveLatestResponse = {
  online: AnchorAvgWaveDaily | null;
  offline: AnchorAvgWaveDaily | null;
  total: AnchorAvgWaveDaily | null;
};

export const anchorAvgWaveApi = {
  getLatest: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<AnchorAvgWaveLatestResponse>(`/anchor-avg-wave/latest${q ? `?${q}` : ""}`);
  },
  getTrend: (scopeOrgId?: string, days = 7) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    params.set("days", String(days));
    const q = params.toString();
    return api.get<AnchorAvgWaveTrendResponse>(`/anchor-avg-wave/trend?${q}`);
  },
  upsert: (data: AnchorAvgWaveUpsertInput, scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.post<AnchorAvgWaveDaily>(`/anchor-avg-wave/upsert${q ? `?${q}` : ""}`, data);
  },
};
