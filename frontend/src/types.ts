export type RoleCode = "DEV_ADMIN" | "HQ_ADMIN" | "BASE_ADMIN" | "TEAM_ADMIN" | "HALL_MANAGER" | "ANCHOR";

export interface User {
  id: string;
  phone: string;
  nickname: string;
  status: string;
  mustChangePassword: boolean;
  createdAt?: string;
  feishuConfigId?: string | null;
  feishuOpenId?: string | null;
  feishuUnionId?: string | null;
  feishuName?: string | null;
  feishuAvatarUrl?: string | null;
  feishuBoundAt?: string | null;
  anchorProfile?: {
    id: string;
    nickname: string;
    douyinNo?: string;
    douyinUid?: string;
    status: string;
    hallOrgId?: string;
  } | null;
}

export interface OrgUnit {
  id: string;
  orgCode: string;
  orgType: "HQ" | "BASE" | "TEAM" | "HALL";
  name: string;
  parentId?: string;
  path: string;
  depth: number;
  principalName?: string;
  contactPhone?: string;
  douyinNo?: string;
  douyinUid?: string;
  brokerName?: string;
  isVirtual?: boolean;
  remark?: string;
  status: "active" | "paused";
  hasChildren?: boolean;
  childCount?: number;
}

export interface FeishuEnterpriseConfig {
  id: string;
  name: string;
  appId: string;
  baseOrgId: string;
  teamOrgId: string;
  status: string;
  redirectUri?: string;
  baseOrg: Pick<OrgUnit, "id" | "name" | "orgCode" | "orgType">;
  teamOrg: Pick<OrgUnit, "id" | "name" | "orgCode" | "orgType">;
}

export interface Identity {
  id: string;
  userId: string;
  roleCode: RoleCode;
  orgId?: string;
  anchorProfileId?: string;
  scopePath?: string;
  status: string;
  grantedAt?: string;
  expiredAt?: string;
  lastSwitchedAt?: string | null;
  org?: OrgUnit;
  anchorProfile?: { id: string; nickname: string; douyinUid: string; status: string };
}

export interface AnchorApplication {
  id: string;
  userId: string;
  anchorNickname: string;
  targetHallOrgId: string;
  douyinNo?: string;
  douyinUid: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  hall?: OrgUnit;
  teamOrg?: OrgUnit | null;
  baseOrg?: OrgUnit | null;
  user?: { id: string; phone: string; nickname: string; status: string };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export type TaskCategory = "DAILY" | "TEMPORARY";
export type TaskItemType = "QA" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "FILL_BLANK" | "LINK" | "ATTACHMENT";
export type TaskTemplateStatus = "draft" | "published" | "archived";
export type TaskAssignmentStatus = "draft" | "scheduled" | "active" | "ended" | "deleted";
export type TaskEffectMode = "immediate" | "next_midnight";
export type TaskAssignmentExclusionType = "ORG" | "ANCHOR";
export type TaskRecordStatus = "pending" | "in_progress" | "submitted" | "overdue";
export type TaskItemRecordStatus = "pending" | "done";
export type ExemptionStatus = "pending" | "approved" | "rejected";
export type ReminderStatus = "active" | "done";
export type TemporaryTaskMode = "ACCOUNT" | "ANCHOR" | "MANAGER";
export type TaskRecordSubjectType = "USER" | "ORG";
export type TemporaryDashboardProgressFilter = "all" | "submitted" | "in_progress" | "pending" | "overdue";

export interface TaskItemOption {
  id: string;
  taskItemId: string;
  sortOrder: number;
  label: string;
}

export interface TaskItemAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
}

export interface TaskItem {
  id: string;
  templateId: string;
  sortOrder: number;
  itemType: TaskItemType;
  title: string;
  isRequired: boolean;
  linkUrl?: string;
  options?: TaskItemOption[];
}

export interface TaskTemplate {
  id: string;
  title: string;
  description?: string;
  category: TaskCategory;
  orgId: string;
  createdBy: string;
  version: number;
  status: TaskTemplateStatus;
  createdAt: string;
  updatedAt: string;
  items?: TaskItem[];
  _count?: { assignments: number };
}

export interface TaskAssignmentTarget {
  id: string;
  assignmentId: string;
  orgId: string;
  orgPathSnapshot: string;
  createdAt: string;
  org?: OrgUnit;
}

export interface TaskAssignmentExclusion {
  id: string;
  assignmentId: string;
  exclusionType: TaskAssignmentExclusionType;
  orgId?: string | null;
  orgPathSnapshot?: string | null;
  anchorProfileId?: string | null;
  createdAt: string;
  org?: OrgUnit | null;
  anchorProfile?: {
    id: string;
    nickname: string;
    douyinNo?: string | null;
    douyinUid?: string | null;
    hallOrgId?: string;
    hallOrg?: OrgUnit | null;
    identities?: Array<{ user?: User | null }> | null;
  } | null;
}

export interface TaskAssignment {
  id: string;
  templateId: string;
  templateVersion?: number | null;
  category: TaskCategory;
  status: TaskAssignmentStatus;
  effectMode?: TaskEffectMode | null;
  effectiveAt?: string | null;
  publishedAt?: string | null;
  endedAt?: string | null;
  deletedAt?: string | null;
  ownerScopePath?: string | null;
  targetRoleType?: string;
  targetAdminLevels?: string[] | null;
  targetRoleCodes?: string[] | null;
  targetUserIds?: string[] | null;
  temporaryMode?: TemporaryTaskMode | null;
  temporarySubjectOrgType?: OrgUnit["orgType"] | null;
  createdByIdentityId?: string | null;
  deadlineAt?: string | null;
  deadlinePolicy?: string | null;
  isActive: boolean;
  createdBy: string;
  createdByOrgId: string;
  createdAt: string;
  updatedAt: string;
  exclusions?: TaskAssignmentExclusion[];
  targets?: TaskAssignmentTarget[];
  template?: TaskTemplate;
  _count?: { records: number; assignments?: number };
  publisher?: { label?: string | null; nickname?: string | null; phone?: string | null } | null;
}

export interface TaskItemRecord {
  id: string;
  taskRecordId: string;
  taskItemId: string;
  status: TaskItemRecordStatus;
  answerText?: string | null;
  answerOptions?: string[] | null;
  isLinkConfirmed?: boolean;
  doneAt?: string | null;
  completedByUserId?: string | null;
  completedByIdentityId?: string | null;
  completedByName?: string | null;
  attachments?: TaskItemAttachment[];
  taskItem?: TaskItem;
}

export interface TaskExemption {
  id: string;
  taskRecordId: string;
  userId: string;
  reason: string;
  status: ExemptionStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskRecord {
  id: string;
  assignmentId: string;
  userId?: string | null;
  identityId?: string | null;
  subjectType: TaskRecordSubjectType;
  subjectKey: string;
  subjectUserId?: string | null;
  subjectOrgId?: string | null;
  subjectName?: string | null;
  subjectOrgType?: OrgUnit["orgType"] | null;
  templateVersion: number;
  recordDate?: string | null;
  deadlineAt: string;
  status: TaskRecordStatus;
  totalItems: number;
  doneItems: number;
  submittedAt?: string | null;
  lastSubmittedByUserId?: string | null;
  lastSubmittedByIdentityId?: string | null;
  lastSubmittedAt?: string | null;
  lastSubmittedByName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  exemptionStatus?: ExemptionStatus | null;
  exemptionReason?: string | null;
  assignment?: TaskAssignment;
  user?: User | null;
  subjectOrg?: OrgUnit | null;
  itemRecords?: TaskItemRecord[];
  visibleIdentityLinks?: Array<{ id: string; identityId: string; userId: string; roleCode: string; orgId?: string | null; userName?: string | null; userPhone?: string | null; orgName?: string | null; orgType?: string | null }>;
  itemContributionSummaries?: Array<{ taskItemId: string; contributions: Array<{ identityId: string; userId: string; createdAt: string; content: string; contributorName?: string | null; contributorPhone?: string | null }> }>;
  exemption?: TaskExemption | null;
}

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

export interface AssignmentProgressReport {
  assignmentId: string;
  total: number;
  submitted: number;
  overdue: number;
  pending: number;
  inProgress: number;
  completionRate: number;
  overdueRate: number;
  exempted: number;
  records: TaskRecord[];
}

export interface AssignmentDailyReportItem {
  date: string;
  total: number;
  submitted: number;
  overdue: number;
  exempted: number;
}

export interface DailyPublishPreview {
  affectedAssignmentCount: number;
  affectedAnchorCount: number;
  autoEndedAssignmentCount: number;
  overlappingAssignments: Array<{
    id: string;
    relation: "same_scope" | "ancestor_scope" | "descendant_scope" | string;
    affectedAnchorCount: number;
    templateTitle: string;
    targetOrgName: string;
    willAutoEnd: boolean;
  }>;
}

export interface TemporaryPublishPreview {
  assignmentId?: string;
  mode: TemporaryTaskMode;
  totalTargets: number;
  targetRoleCodes?: string[] | null;
  targetUserIds?: string[] | null;
  orgSummaries?: Array<{ orgId: string; orgName: string; total: number }>;
  subjectCount: number;
  userSubjectCount: number;
  orgSubjectCount: number;
  visibleIdentityCount: number;
  missingManagerOrgs?: Array<{ orgId: string; orgName: string; orgType: "BASE" | "TEAM" | "HALL" | string }>;
  subjectSummaries: Array<{ subjectName: string; subjectType: "USER" | "ORG"; visibleIdentityCount: number }>;
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
  viewer: { roleCode?: string; scopeOrgId?: string | null; scopePath?: string };
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    supplemented: number;
    exemptions: number;
    completionRate: number;
  };
  tree: {
    teams: DailyDashboardOrgNode[];
    halls: DailyDashboardOrgNode[];
  };
  quickRanges: {
    today: string;
    yesterday: string;
    canSupplementYesterday: boolean;
  };
  subTaskSummaries: Array<{
    taskItemId: string;
    title: string;
    doneCount: number;
    total: number;
    completionRate: number;
    teamBreakdown: Array<{
      teamOrgId: string;
      teamName: string;
      done: number;
      inProgress: number;
      pending: number;
      total: number;
      completionRate: number;
    }>;
  }>;
}

export interface DailyDashboardTeamChildrenResponse {
  taskDate: string;
  baseOrg: { id: string; name: string; orgType: string };
  team: DailyDashboardOrgNode;
  halls: DailyDashboardOrgNode[];
}

export interface DailyDashboardHallDetailItem {
  userId: string;
  subjectKey: string;
  subjectName: string;
  doneItems: number;
  totalItems: number;
  submittedAt?: string | null;
  lastSubmittedAt?: string | null;
  status: "pending" | "in_progress" | "completed" | "supplemented";
  completionRate: number;
  exemptionStatus?: ExemptionStatus | null;
  exemptionReason?: string | null;
  taskRecordId?: string | null;
}

export interface DailyDashboardHallDetailsResponse {
  taskDate: string;
  baseOrg: { id: string; name: string; orgType: string };
  hall: { id: string; name: string };
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    supplemented: number;
    exemptions: number;
  };
  details: DailyDashboardHallDetailItem[];
}

export interface DailyDashboardAnchorItemDetailResponse {
  taskDate: string;
  baseOrg: { id: string; name: string; orgType: string };
  hall: { id: string; name: string };
  anchor: {
    userId: string;
    subjectKey: string;
    subjectName: string;
    status: "pending" | "in_progress" | "completed" | "supplemented";
    requiredDoneItems: number;
    requiredTotalItems: number;
    completedAt?: string | null;
    taskRecordId?: string | null;
    exemptionStatus?: ExemptionStatus | null;
    exemptionReason?: string | null;
    exemptionReviewedAt?: string | null;
    exemptionReviewerName?: string | null;
  };
  items: Array<{
    taskItemId: string;
    title: string;
    itemType: TaskItemType;
    isRequired: boolean;
    done: boolean;
    doneAt?: string | null;
    completedByUserId?: string | null;
    completedByIdentityId?: string | null;
    completedByName?: string | null;
    answerText?: string | null;
    answerOptions?: string[] | null;
    isLinkConfirmed?: boolean;
    attachments: TaskItemAttachment[];
    options: TaskItemOption[];
    contributions?: Array<{
      identityId: string;
      userId: string;
      createdAt: string;
      content: string;
      contributorName?: string | null;
      contributorPhone?: string | null;
    }>;
  }>;
}

export interface TemporaryDashboardRecordItem {
  id: string;
  userId?: string | null;
  subjectType: string;
  subjectKey: string;
  subjectUserId?: string | null;
  subjectOrgId?: string | null;
  subjectName?: string | null;
  subjectOrgType?: string | null;
  user?: { id: string; nickname?: string | null; phone?: string | null; status?: string | null } | null;
  douyinNo?: string | null;
  douyinUid?: string | null;
  recordDate?: string | null;
  status: TaskRecordStatus;
  doneItems: number;
  totalItems: number;
  deadlineAt: string;
  submittedAt?: string | null;
  lastSubmittedByUserId?: string | null;
  lastSubmittedByIdentityId?: string | null;
  lastSubmittedAt?: string | null;
  lastSubmittedByName?: string | null;
  publisherName?: string | null;
  publisherPhone?: string | null;
  participantCount?: number;
  submissionCount?: number;
  visibleIdentityNames?: string[];
  exemptionStatus?: string | null;
  exemptionReason?: string | null;
}

export interface TemporaryDashboardSummaryResponse {
  assignmentId: string;
  total: number;
  submitted: number;
  overdue: number;
  pending: number;
  inProgress: number;
  completionRate: number;
  overdueRate: number;
  exempted: number;
}

export interface TemporaryDashboardRecordListResponse {
  assignmentId: string;
  filter: TemporaryDashboardProgressFilter;
  keyword: string;
  total: number;
  items: TemporaryDashboardRecordItem[];
  hasMore: boolean;
}

export interface TemporaryDashboardAnchorOrgNode {
  orgId: string;
  orgName: string;
  orgType: string;
  path?: string;
  parentOrgId?: string | null;
  total: number;
  submitted: number;
  inProgress: number;
  pending: number;
  overdue: number;
  completionRate: number;
  hasChildren?: boolean;
}

export interface TemporaryDashboardAnchorTeamNodeResponse {
  assignmentId: string;
  items: TemporaryDashboardAnchorOrgNode[];
}

export interface TemporaryDashboardAnchorHallNodeResponse {
  assignmentId: string;
  teamOrgId: string;
  items: TemporaryDashboardAnchorOrgNode[];
}

export interface TemporaryDashboardRecordDetailResponse {
  record: TaskRecord & {
    publisherName?: string | null;
    publisherPhone?: string | null;
    participantCount?: number;
    submissionCount?: number;
    visibleIdentityNames?: string[];
    visibleIdentities?: Array<{
      id: string;
      identityId: string;
      userId: string;
      roleCode: string;
      userName?: string | null;
      phone?: string | null;
      orgName?: string | null;
      orgType?: string | null;
    }>;
  };
  items: Array<{
    taskItemId: string;
    title: string;
    itemType: TaskItemType;
    isRequired: boolean;
    done: boolean;
    doneAt?: string | null;
    answerText?: string | null;
    answerOptions?: string[] | null;
    isLinkConfirmed?: boolean;
    completedByUserId?: string | null;
    completedByIdentityId?: string | null;
    completedByName?: string | null;
    attachments: TaskItemAttachment[];
    options: TaskItemOption[];
    contributions?: Array<{
      identityId: string;
      userId: string;
      createdAt: string;
      content: string;
      contributorName?: string | null;
      contributorPhone?: string | null;
    }>;
  }>;
}

export interface TemporaryDashboardAssignmentListResponse {
  items: TaskAssignment[];
  hasMore: boolean;
  scopeOrg: { id: string; name: string; orgType: string };
}
