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
};

function buildQuery(params?: Record<string, string | number | boolean | undefined>) {
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
  getHallDailyDashboard: (taskDate?: string) => {
    const params = new URLSearchParams();
    if (taskDate) params.set("taskDate", taskDate);
    const q = params.toString();
    return api.get<import("../types").HallDailyDashboardResponse>(`/tasks/report/hall-daily-dashboard${q ? `?${q}` : ""}`);
  },
};

// ---------- 主播汇总 ----------

export type OperatorStat = {
  name: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within30Days: number;
};

export type AnchorDailySummary = {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  uploadDate: string;
  uploadedBy: string;
  uploaderName: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within30Days: number;
  operatorStats: OperatorStat[];
  rawRowCount: number;
  createdAt: string;
  updatedAt: string;
};

export const anchorSummaryApi = {
  getLatest: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.get<AnchorDailySummary | null>(`/anchor-summary/latest${q ? `?${q}` : ""}`);
  },
  upload: (file: File, scopeOrgId?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    const q = params.toString();
    return api.postForm<AnchorDailySummary>(`/anchor-summary/upload${q ? `?${q}` : ""}`, formData);
  },
};
