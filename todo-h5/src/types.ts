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
  orgId?: string | null;
  scopePath?: string | null;
  status?: string;
  grantedAt?: string;
  lastSwitchedAt?: string | null;
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
  status?: string;
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
  editingBlockedReason?: string;
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
  exemption?: { status: string } | null;
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

export interface AuthPayload {
  token: string;
  user: User;
  identities: Identity[];
  recommendedIdentityId?: string | null;
}

export type CollaborationQuestionType = "QA" | "FILL_BLANK" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "LINK" | "ATTACHMENT";

export interface CollaborationQuestion {
  id: string;
  title: string;
  itemType: CollaborationQuestionType;
  isRequired: boolean;
  options?: string[];
  linkUrl?: string | null;
}

export interface CollaborationAnswer {
  questionId: string;
  answerText?: string;
  answerOptions?: string[];
  isLinkConfirmed?: boolean;
  attachmentUrls?: string[];
}

export interface WorkflowTaskStep {
  id: string;
  order: number;
  title: string;
  requirement: string;
  questions: CollaborationQuestion[];
  assigneeUserId: string;
  assigneeName: string;
  assigneeOrgName?: string | null;
  status: "pending" | "active" | "completed";
  completedAt?: string | null;
  stepAnswers?: CollaborationAnswer[];
  submittedAt?: string | null;
}

export interface WorkflowTask {
  id: string;
  title: string;
  description?: string | null;
  targetOrgName: string;
  createdByName: string;
  dueAt?: string | null;
  status: "draft" | "in_progress" | "completed" | "ended";
  currentStepOrder: number;
  createdAt: string;
  steps: WorkflowTaskStep[];
}

export interface BroadcastTask {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  createdByName: string;
  hallOrgName: string;
  status: "active" | "ended";
  createdAt: string;
  questions: CollaborationQuestion[];
  myRecord: {
    id: string;
    status: TaskRecordStatus;
    submittedAt?: string | null;
    answers: CollaborationAnswer[];
  };
}

export interface HallDailyRecord {
  id: string;
  recordDate: string;
  status: TaskRecordStatus;
  totalItems: number;
  doneItems: number;
  hallOrg?: { id: string; name: string } | null;
  assignmentId?: string;
  assignment?: { id?: string; status?: string; template?: TaskTemplate | null } | null;
  itemRecords?: TaskItemRecord[];
  leaveRequests?: Array<{ id: string; reason: string; status: "pending" | "approved" | "rejected" | "cancelled" }>;
}

export interface OrgUnit {
  id: string;
  name: string;
  orgType: "HQ" | "BASE" | "TEAM" | "HALL" | string;
  path: string;
  status: string;
  parentId?: string | null;
}

export interface DailyDashboardOrgNode {
  orgId: string;
  orgName: string;
  orgType: "BASE" | "TEAM" | "HALL";
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  supplemented: number;
  exemptions: number;
  completionRate: number;
  halls?: DailyDashboardOrgNode[];
  children?: DailyDashboardOrgNode[];
}

export interface DailyDashboardResponse {
  taskDate: string;
  phase: "in_progress" | "supplement" | "closed";
  baseOrg: { id: string; name: string; orgType: string };
  summary: { total: number; completed: number; inProgress: number; pending: number; supplemented: number; exemptions: number; completionRate: number };
  tree: { teams: DailyDashboardOrgNode[]; halls: DailyDashboardOrgNode[] };
  subTaskSummaries: Array<{ taskItemId: string; title: string; doneCount: number; total: number; completionRate: number }>;
}

export interface DailyRangeStatsTeam {
  orgId: string;
  orgName: string;
  total: number;
  completed: number;
  exemptions: number;
  completionRate: number;
  exemptionRate: number;
}

export interface DailyRangeStatsResponse {
  startDate: string;
  endDate: string;
  effectiveDays: number;
  baseOrg: { id: string; name: string };
  summary: { total: number; completed: number; exemptions: number; completionRate: number; exemptionRate: number };
  teams: DailyRangeStatsTeam[];
}

export interface RoomAllocation {
  orgId: string;
  orgName: string;
  allocated: number;
  used: number;
}

export interface RoomTypeDetail {
  typeName: string;
  allocated: number;
  used: number;
  total: number;
  allocations?: RoomAllocation[];
}

export interface LiveRoomCapacity {
  id: string;
  baseOrgId: string;
  baseOrgName: string;
  siteDetails: Array<{ siteId: string; siteName: string; rooms: RoomTypeDetail[] }>;
  updaterName: string;
  updatedAt: string;
}

export interface AnchorSummaryLatest {
  recordDate: string;
  uploaderName: string;
  rawRowCount: number;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within20Days: number;
  probationDays?: number;
  probationExcluded?: number;
  operatorStats: AnchorOperatorStat[];
}

export interface AnchorOperatorStat {
  name: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within7DaysOnline: number;
  within7DaysOffline: number;
  within20Days: number;
  within20DaysOnline: number;
  within20DaysOffline: number;
}

export interface AnchorTrendResponse {
  baseOrgId: string;
  baseOrgName: string;
  teamOrgName?: string | null;
  latest: AnchorSummaryLatest | null;
}

export interface StaffTurnoverMetrics {
  lossCount: number;
  lossAvgWave: number;
  lossOnlineCount: number;
  lossOnlineAvgWave: number;
  lossOfflineCount: number;
  lossOfflineAvgWave: number;
  activeOnlineCount: number;
  activeOnlineAvgWave: number;
  activeOfflineCount: number;
  activeOfflineAvgWave: number;
  activeTotalCount: number;
  activeTotalAvgWave: number;
}

export interface StaffTurnoverTeamRecord extends StaffTurnoverMetrics {
  teamOrgId: string;
  teamOrgName: string;
}

export interface StaffTurnoverDateEntry {
  recordDate: string;
  aggregated: StaffTurnoverMetrics;
  teams: StaffTurnoverTeamRecord[];
}

export interface StaffTurnoverByDateResponse {
  baseOrgId: string;
  baseOrgName: string;
  dateEntries: StaffTurnoverDateEntry[];
}

export interface RetentionMetrics {
  loss3Days: number;
  loss15Days: number;
  loss30Days: number;
  activeCount: number;
}

export interface RetentionTeamRecord extends RetentionMetrics {
  teamOrgId: string;
  teamOrgName: string;
}

export interface RetentionMonthEntry {
  recordMonth: string;
  aggregated: RetentionMetrics;
  teams: RetentionTeamRecord[];
}

export interface RetentionByMonthResponse {
  baseOrgId: string;
  baseOrgName: string;
  monthEntries: RetentionMonthEntry[];
}

export interface ProcessMetricHall {
  hallName: string;
  percentage: number;
}

export interface ProcessMetricTeamEntry {
  teamOrgId: string;
  teamOrgName: string;
  halls: ProcessMetricHall[];
}

export interface ProcessMetricDateEntry {
  recordDate: string;
  teams: ProcessMetricTeamEntry[];
}

export interface ProcessMetricByDateResponse {
  baseOrgId: string;
  baseOrgName: string;
  dateEntries: ProcessMetricDateEntry[];
}

export interface ProcessMetricConfigResponse {
  baseOrgId: string;
  baseOrgName: string;
  teamIds: string[];
}
