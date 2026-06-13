import { api } from "./http";
import { useAuthStore } from "../stores/auth";
import type { PersonalReminder, TaskItemRecord, TaskRecord } from "../types";

export const taskApi = {
  getMyRecords: () => api.get<TaskRecord[]>("/tasks/my-records"),
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
