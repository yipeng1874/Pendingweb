import { api } from "./http";
import type { PublishQuestion } from "./workflowPublish";
import type { CollaborationAnswer } from "../types";
export type RecipientType = "ANCHOR" | "HALL_MANAGER";
export type Recipient = { userId: string; nickname: string; phone: string; orgName?: string; douyinNo?: string };
export type BroadcastSummary = { status?: string; createdByName?: string; hallOrgName?: string; id: string; title: string; description?: string; dueAt?: string; questions: (PublishQuestion & { id: string })[]; _count: { anchorRecords: number }; completedCount: number };
export type RecipientRecord = { id: string; anchorNickname: string; anchorOrgName?: string; status: string; answers: CollaborationAnswer[] };
const base = "/tasks/collaboration/broadcast";
export const broadcastPublishApi = {
  search: (type: RecipientType, q: string, offset = 0) => api.get<{ anchors: Recipient[]; hallManagers: Recipient[]; nextOffset: number | null }>(`${base}/recipients?type=${type}&q=${encodeURIComponent(q)}&offset=${offset}`),
  create: (data: { title: string; description: string; dueAt?: string; recipientType: RecipientType; selectedRecipientUserIds: string[]; questions: PublishQuestion[] }) => api.post(base, data),
  issued: (status: string, page: number) => api.get<{ tasks: BroadcastSummary[]; hasMore: boolean }>(`${base}/mobile-issued?status=${status}&page=${page}`),
  recipients: (id: string, page: number) => api.get<{ items: RecipientRecord[]; hasMore: boolean }>(`${base}/mobile-issued/${id}/recipients?page=${page}`),
};
