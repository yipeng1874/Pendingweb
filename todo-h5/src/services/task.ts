import { api } from "./http";
import { useAuthStore } from "../stores/auth";
import type { AnchorTrendResponse, BroadcastTask, DailyDashboardResponse, DailyRangeStatsResponse, HallDailyRecord, LiveRoomCapacity, OrgUnit, PersonalReminder, ProcessMetricByDateResponse, ProcessMetricConfigResponse, RetentionByMonthResponse, StaffTurnoverByDateResponse, TaskItemRecord, TaskRecord, WorkflowTask } from "../types";

export const taskApi = {
  getMyRecords: () => api.get<TaskRecord[]>("/tasks/my-records"),
  getHallDailyRecords: () => api.get<HallDailyRecord[]>("/hall-daily/my-records"),
  getWorkflowTasks: () => api.get<WorkflowTask[]>("/tasks/collaboration/workflows/mine"),
  getBroadcastTasks: () => api.get<BroadcastTask[]>("/tasks/collaboration/broadcast/mine"),
  getOrgTree: () => api.get<OrgUnit[]>("/orgs/tree"),
  getPermissions: () => api.get<string[]>("/me/permissions"),
  getReportSummary: () => api.get<{ activeAssignments: number; totalTemplates: number; pendingExemptions: number }>("/tasks/report/summary"),
  getDailyDashboard: (taskDate: string, scopeOrgId?: string) => {
    const params = new URLSearchParams({ taskDate });
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<DailyDashboardResponse>(`/tasks/report/daily-dashboard?${params.toString()}`);
  },
  getDailyRangeStats: (startDate: string, endDate: string, scopeOrgId?: string) => {
    const params = new URLSearchParams({ startDate, endDate });
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<DailyRangeStatsResponse>(`/tasks/report/daily-range-stats?${params.toString()}`);
  },
  getHallDailyRangeStats: (startDate: string, endDate: string, scopeOrgId?: string) => {
    const params = new URLSearchParams({ startDate, endDate });
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<DailyRangeStatsResponse>(`/tasks/report/hall-daily-range-stats?${params.toString()}`);
  },
  getLiveRoomCapacity: (scopeOrgId?: string) => api.get<LiveRoomCapacity | null>(`/live-room-capacity/latest${scopeOrgId ? `?scopeOrgId=${encodeURIComponent(scopeOrgId)}` : ""}`),
  getAnchorTrend: (scopeOrgId?: string, probationDays = 0) => {
    const params = new URLSearchParams({ days: "7" });
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    if (probationDays > 0) params.set("probationDays", String(probationDays));
    return api.get<AnchorTrendResponse>(`/anchor-summary/trend?${params.toString()}`);
  },
  getStaffTurnoverByDate: (scopeOrgId?: string, days = 6) => {
    const params = new URLSearchParams({ days: String(days) });
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<StaffTurnoverByDateResponse>(`/staff-turnover/by-date?${params.toString()}`);
  },
  getRetentionByMonth: (scopeOrgId?: string, months = 6) => {
    const params = new URLSearchParams({ months: String(months) });
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<RetentionByMonthResponse>(`/retention/by-month?${params.toString()}`);
  },
  getProcessMetrics: (scopeOrgId?: string, days = 60) => {
    const params = new URLSearchParams({ days: String(days) });
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<ProcessMetricByDateResponse>(`/process-metric/by-date?${params.toString()}`);
  },
  getProcessMetricConfig: (scopeOrgId?: string) => {
    const params = new URLSearchParams();
    if (scopeOrgId) params.set("scopeOrgId", scopeOrgId);
    return api.get<ProcessMetricConfigResponse>(`/process-metric/config?${params.toString()}`);
  },
  getRecord: (id: string) => api.get<TaskRecord>(`/tasks/my-records/${id}`),
  submitItemRecord: (data: { taskRecordId: string; taskItemId: string; answerText?: string; answerOptions?: string[]; isLinkConfirmed?: boolean; done: boolean }) =>
    api.post<TaskItemRecord | TaskRecord>("/tasks/item-records", data),
  submitRecord: (id: string) => api.post<TaskRecord>(`/tasks/my-records/${id}/submit`),
  getReminders: (status?: string) => api.get<PersonalReminder[]>(`/tasks/reminders${status ? `?status=${status}` : ""}`),
  createReminder: (data: { title: string; note?: string; remindEnd?: string; isImportant?: boolean; remindAt?: string; remindStart?: string; repeatType?: string }) => api.post<PersonalReminder>("/tasks/reminders", data),
  updateReminder: (id: string, data: Partial<PersonalReminder>) => api.patch<PersonalReminder>(`/tasks/reminders/${id}`, data),
  deleteReminder: (id: string) => api.delete<{ deleted: boolean }>(`/tasks/reminders/${id}`),
  markReminderDone: (id: string) => api.post<PersonalReminder>(`/tasks/reminders/${id}/done`),
  upload: async (taskItemRecordId: string, file: File): Promise<{ fileUrl: string; id: string }> => {
    const { token, currentIdentity } = useAuthStore.getState();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("taskItemRecordId", taskItemRecordId);
    const response = await fetch("/api/tasks/upload", {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(currentIdentity?.id ? { "X-Identity-Id": currentIdentity.id } : {}),
      },
      body: formData,
    });
    const body = await response.json();
    if (!body.success) throw new Error(body.error?.message ?? "上传失败");
    return body.data;
  },
};
