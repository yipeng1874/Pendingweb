export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface User {
  id: string;
  phone: string;
  nickname?: string | null;
  status?: string;
}

export interface OrgUnitLite {
  id: string;
  name: string;
  orgType: "HQ" | "BASE" | "TEAM" | "HALL" | string;
}

export interface AnchorProfileLite {
  id: string;
  nickname?: string | null;
}

export interface Identity {
  id: string;
  userId: string;
  roleCode: string;
  scopePath?: string;
  org?: OrgUnitLite | null;
  anchorProfile?: AnchorProfileLite | null;
}

export type TaskRecordStatus = "pending" | "in_progress" | "submitted" | "overdue";
export type TaskItemType = "QA" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "FILL_BLANK" | "LINK" | "ATTACHMENT" | string;

export interface TaskItemOption {
  id: string;
  label: string;
  sortOrder: number;
}

export interface TaskItemAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  itemType: TaskItemType;
  isRequired: boolean;
  linkUrl?: string | null;
  options?: TaskItemOption[];
}

export interface TaskTemplate {
  id: string;
  title: string;
  description?: string | null;
  items?: TaskItem[];
}

export interface TaskAssignment {
  id: string;
  category: "DAILY" | "TEMPORARY";
  temporaryMode?: "ACCOUNT" | "ANCHOR" | "MANAGER" | string;
  template?: TaskTemplate;
  publisher?: { label?: string | null; phone?: string | null } | null;
}

export interface VisibleIdentityLink {
  id: string;
  identityId: string;
  userId: string;
  roleCode: string;
  userName?: string | null;
  userPhone?: string | null;
  orgName?: string | null;
  orgType?: string | null;
}

export interface TaskItemRecord {
  id: string;
  taskRecordId: string;
  taskItemId: string;
  status: "pending" | "done";
  answerText?: string | null;
  answerOptions?: string[] | null;
  isLinkConfirmed?: boolean;
  doneAt?: string | null;
  completedByUserId?: string | null;
  completedByIdentityId?: string | null;
  completedByName?: string | null;
  attachments?: TaskItemAttachment[];
}

export interface TaskRecord {
  id: string;
  assignmentId: string;
  subjectType: "USER" | "ORG" | string;
  subjectKey: string;
  subjectUserId?: string | null;
  subjectOrgId?: string | null;
  subjectName?: string | null;
  subjectOrgType?: string | null;
  recordDate?: string | null;
  status: TaskRecordStatus;
  doneItems: number;
  totalItems: number;
  deadlineAt: string;
  submittedAt?: string | null;
  lastSubmittedAt?: string | null;
  lastSubmittedByName?: string | null;
  assignment?: TaskAssignment;
  itemRecords?: TaskItemRecord[];
  visibleIdentityLinks?: VisibleIdentityLink[];
  exemptionStatus?: string | null;
  exemptionReason?: string | null;
}

export type ReminderStatus = "active" | "done" | "dismissed" | string;

export interface PersonalReminder {
  id: string;
  userId: string;
  title: string;
  note?: string | null;
  remindAt?: string | null;
  remindEnd?: string | null;
  remindStart?: string | null;
  repeatType?: "once" | "daily" | "weekly" | "workday" | null;
  isImportant: boolean;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
}
