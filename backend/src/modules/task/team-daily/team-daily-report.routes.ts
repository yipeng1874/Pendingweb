import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { canViewDailyDashboard, resolveBaseScopeOrg, resolveHallDailyReportStatus as resolveTeamDailyReportStatus, serializeHallDailyLeaveRequest as serializeTeamDailyLeaveRequest, calculateCompletionRate } from "../report/report.routes.js";
import { addBeijingDays, formatBeijingDate, getDailyTaskContext, getDailyTaskDayEnd, getDailyTaskSupplementDeadline } from "../record/daily-record-time.utils.js";
const t = (v: any): string => typeof v === "string" ? v.trim() : "";
export const teamDailyReportRoutes = Router();
teamDailyReportRoutes.use(authRequired, identityRequired);
teamDailyReportRoutes.get("/tasks/report/team-daily-dashboard", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  if (!canViewDailyDashboard(roleCode)) {
    return fail(res, "TEAM_DAILY_DASHBOARD_FORBIDDEN", "当前身份无权查看团队管理日常任务看板", 403);
  }
  if (roleCode !== "TEAM_ADMIN") {
    return fail(res, "TEAM_DAILY_DASHBOARD_ROLE_REQUIRED", "团队管理日常任务看板仅团队管理员角色可使用本接口，管理员请使用 /team-daily-dashboard/overview", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const teamOrgId = req.identity?.orgId as string | undefined;
  if (!teamOrgId) {
    return fail(res, "HALL_ORG_NOT_FOUND", "当前团队管理员身份未绑定团队", 400);
  }

  const hall = await prisma.orgUnit.findFirst({
    where: { id: teamOrgId, status: "active", orgType: "TEAM" },
    select: { id: true, name: true, path: true, parentId: true },
  });
  if (!hall) return fail(res, "HALL_NOT_FOUND", "当前团队不存在或已停用", 404);

  const now = new Date();
  const today = formatBeijingDate(now);
  const { canSupplementYesterday } = getDailyTaskContext(now);
  const phase = taskDate === today
    ? (now.getTime() <= getDailyTaskDayEnd(taskDate).getTime() ? "in_progress" : "supplement")
    : (now.getTime() < getDailyTaskSupplementDeadline(taskDate).getTime() ? "supplement" : "closed");

  // 查找当天该团队的所有活跃/已结束 TeamTaskRecord（含日期范围内有效的任务）
  const records = await prisma.teamTaskRecord.findMany({
    where: {
      teamOrgId,
      recordDate: taskDate,
      assignment: {
        status: { in: ["active", "ended"] },
      },
    },
    include: {
      assignment: {
        include: {
          template: {
            include: {
              items: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, title: true, itemType: true, isRequired: true, sortOrder: true, linkUrl: true },
              },
            },
          },
          targets: { select: { teamOrgId: true } },
        },
      },
      itemRecords: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          taskItemId: true,
          status: true,
          answerText: true,
          answerOptions: true,
          isLinkConfirmed: true,
          doneAt: true,
          doneBy: true,
        },
      },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
      },
      teamOrg: { select: { id: true, name: true } },
    },
    orderBy: { recordDate: "desc" },
  });

  // 取最新的一条有效 record（active assignment 优先）
  const activeRecord = records.find((r) => r.assignment.status === "active") ?? records[0] ?? null;

  const authorIds = [...new Set([activeRecord?.submittedBy, ...(activeRecord?.itemRecords.map(item=>item.doneBy) ?? [])].filter((id): id is string => !!id))];
  const authors = new Map((await prisma.user.findMany({where:{id:{in:authorIds}},select:{id:true,nickname:true}})).map(user=>[user.id,user.nickname]));
  const summary = {
    status: resolveTeamDailyReportStatus(activeRecord, taskDate, now),
    totalItems: activeRecord?.totalItems ?? 0,
    doneItems: activeRecord?.doneItems ?? 0,
    submittedAt: activeRecord?.submittedAt?.toISOString() ?? null,
    leaveRequest: serializeTeamDailyLeaveRequest(activeRecord),
    completionRate: activeRecord?.totalItems
      ? Math.round((activeRecord.doneItems / activeRecord.totalItems) * 100)
      : 0,
  };

  return ok(res, {
    taskDate,
    phase,
    hall: { id: hall.id, name: hall.name },
    viewer: { roleCode, orgId: teamOrgId },
    quickRanges: {
      today,
      yesterday: addBeijingDays(today, -1),
      canSupplementYesterday,
    },
    summary,
    record: activeRecord
      ? {
          id: activeRecord.id,
          assignmentId: activeRecord.assignmentId,
          status: resolveTeamDailyReportStatus(activeRecord, taskDate, now),
          totalItems: activeRecord.totalItems,
          doneItems: activeRecord.doneItems,
          submittedAt: activeRecord.submittedAt?.toISOString() ?? null,
          submittedByName: activeRecord.submittedBy ? authors.get(activeRecord.submittedBy) ?? null : null,
          leaveRequest: serializeTeamDailyLeaveRequest(activeRecord),
          templateTitle: activeRecord.assignment.template?.title ?? null,
          items: (activeRecord.assignment.template?.items ?? []).map((item) => {
            const ir = activeRecord.itemRecords.find((r) => r.taskItemId === item.id);
            return {
              taskItemId: item.id,
              title: item.title,
              itemType: item.itemType,
              isRequired: item.isRequired,
              sortOrder: item.sortOrder,
              linkUrl: item.linkUrl ?? null,
              done: ir?.status === "done",
              doneAt: ir?.doneAt?.toISOString() ?? null,
              doneByName: ir?.doneBy ? authors.get(ir.doneBy) ?? null : null,
              answerText: ir?.answerText ?? null,
              answerOptions: Array.isArray(ir?.answerOptions) ? ir.answerOptions : null,
              isLinkConfirmed: ir?.isLinkConfirmed ?? false,
            };
          }),
        }
      : null,
  });
});

// ── 团队管理日常任务看板：管理员总览（按基地→基地汇总）──────────────────────────
teamDailyReportRoutes.get("/tasks/report/team-daily-dashboard/overview", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  const allowedAdminRoles = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"];
  if (!allowedAdminRoles.includes(roleCode)) {
    return fail(res, "TEAM_DAILY_OVERVIEW_FORBIDDEN", "当前身份无权查看团队管理日常任务管理员看板", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;

  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后查看团队管理日常任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "TEAM_DAILY_OVERVIEW_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const now = new Date();
  const today = formatBeijingDate(now);
  const { canSupplementYesterday } = getDailyTaskContext(now);
  const phase = taskDate === today
    ? (now.getTime() <= getDailyTaskDayEnd(taskDate).getTime() ? "in_progress" : "supplement")
    : (now.getTime() < getDailyTaskSupplementDeadline(taskDate).getTime() ? "supplement" : "closed");

  // TEAM_ADMIN scope 过滤
  const viewerScopePath = req.identity?.scopePath;

  // ① 查询基地下全量 active 基地（用于展示"未参与任务"的基地）
  const allTeams = await prisma.orgUnit.findMany({
    where: {
      status: "active",
      orgType: "BASE",
      id: baseOrg.id,
    },
    select: { id: true, name: true, path: true },
    orderBy: { path: "asc" },
  });

  // TEAM_ADMIN 只能看自己基地（精确匹配或子路径）
  const scopedTeams = roleCode === "BASE_ADMIN" && viewerScopePath
    ? allTeams.filter((t) => t.path === viewerScopePath || t.path.startsWith(`${viewerScopePath}/`))
    : allTeams;

  // ② 查询基地下全量 active 团队（用于展示"未参与任务"的团队）
  const scopedTeamIds = scopedTeams.map((t) => t.id);
  const allHalls = scopedTeamIds.length ? await prisma.orgUnit.findMany({
    where: { status: "active", orgType: "TEAM", parentId: { in: scopedTeamIds } },
    select: { id: true, name: true, path: true, parentId: true },
  }) : [];

  // ③ 直接查询 taskDate 当天有 TeamTaskRecord 的团队（权威数据源，精确到日期）
  const allHallIdsArr = allHalls.map((h) => h.id);
  const records = allHallIdsArr.length ? await prisma.teamTaskRecord.findMany({
    where: {
      teamOrgId: { in: allHallIdsArr },
      recordDate: taskDate,
      assignment: { status: { in: ["active", "ended"] } },
    },
    select: {
      id: true,
      teamOrgId: true,
      assignmentId: true,
      status: true,
      totalItems: true,
      doneItems: true,
      submittedAt: true,
      createdAt: true,
      assignment: {
        select: {
          status: true,
          baseOrgId: true,
          template: { select: { title: true } },
        },
      },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  }) : [];

  // 从 records 推导当天真实有任务的团队集合
  const assignedHallIds = new Set(records.map((r) => r.teamOrgId));

  // ④ 每个团队取当天最优一条 record：active assignment 优先，都是 ended 则取 createdAt 最晚的
  const hallRecordMap = new Map<string, typeof records[number]>();
  for (const rec of records) {
    const existing = hallRecordMap.get(rec.teamOrgId);
    if (!existing) {
      hallRecordMap.set(rec.teamOrgId, rec);
    } else if (rec.assignment.status === "active" && existing.assignment.status !== "active") {
      // active 优先
      hallRecordMap.set(rec.teamOrgId, rec);
    } else if (rec.assignment.status !== "active" && existing.assignment.status !== "active"
      && rec.createdAt > existing.createdAt) {
      // 同为 ended，取创建时间更晚的（即对应更晚生效的任务）
      hallRecordMap.set(rec.teamOrgId, rec);
    }
  }

  // baseOrgId -> templateTitle（按团队当前所属基地归集）
  const teamTemplateTitleMap = new Map<string, string>();
  for (const rec of hallRecordMap.values()) {
    const teamId = allHalls.find((hall) => hall.id === rec.teamOrgId)?.parentId;
    if (teamId && rec.assignment.template?.title && !teamTemplateTitleMap.has(teamId)) {
      teamTemplateTitleMap.set(teamId, rec.assignment.template.title);
    }
  }

  // ⑤ 统计每个基地（全量，包含无任务基地）
  const teamSummaries = scopedTeams.map((team) => {
    const teamAllHalls = allHalls.filter((h) => h.parentId === team.id);
    const teamAssignedHallIds = teamAllHalls.filter((h) => assignedHallIds.has(h.id)).map((h) => h.id);

    const totalHalls = teamAllHalls.length;      // 基地下全量团队数
    const assignedHalls = teamAssignedHallIds.length; // 参与任务的团队数
    const hasTask = assignedHalls > 0;

    let submittedCount = 0;
    let leaveApprovedCount = 0;
    let leavePendingCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;
    let noRecordCount = 0;

    for (const hallId of teamAssignedHallIds) {
      const rec = hallRecordMap.get(hallId);
      const displayStatus = resolveTeamDailyReportStatus(rec, taskDate, now);
      if (!displayStatus) {
        noRecordCount += 1;
      } else if (displayStatus === "submitted") {
        submittedCount += 1;
      } else if (displayStatus === "leave_approved") {
        leaveApprovedCount += 1;
      } else if (displayStatus === "leave_pending") {
        leavePendingCount += 1;
      } else if (displayStatus === "in_progress") {
        inProgressCount += 1;
      } else if (displayStatus === "overdue") {
        overdueCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    // 完成率 = 已提交 + 已请假 / 参与任务的团队（分母不排除 noRecord，保留透明度）
    const completionRate = calculateCompletionRate(submittedCount, assignedHalls, leaveApprovedCount);

    return {
      baseOrgId: team.id,
      baseOrgName: team.name,
      hasTask,
      totalHalls,
      assignedHalls,
      submittedCount,
      leaveApprovedCount,
      leavePendingCount,
      inProgressCount,
      pendingCount,
      overdueCount,
      noRecordCount,
      completionRate,
      templateTitle: teamTemplateTitleMap.get(team.id) ?? null,
    };
  });

  // 基地整体汇总
  const baseTotalTeams = scopedTeams.length;
  const baseAssignedTeams = teamSummaries.filter((t) => t.hasTask).length;
  const baseTotalHalls = allHalls.length;
  const baseAssignedHalls = assignedHallIds.size;
  const baseSubmittedHalls = teamSummaries.reduce((s, t) => s + t.submittedCount, 0);
  const baseLeaveApprovedHalls = teamSummaries.reduce((s, t) => s + t.leaveApprovedCount, 0);
  const baseLeavePendingHalls = teamSummaries.reduce((s, t) => s + t.leavePendingCount, 0);
  const baseCompletionRate = calculateCompletionRate(baseSubmittedHalls, baseAssignedHalls, baseLeaveApprovedHalls);

  return ok(res, {
    taskDate,
    phase,
    baseOrg: { id: baseOrg.id, name: baseOrg.name },
    quickRanges: {
      today,
      yesterday: addBeijingDays(today, -1),
      canSupplementYesterday,
    },
    baseSummary: {
      totalTeams: baseTotalTeams,
      assignedTeams: baseAssignedTeams,
      totalHalls: baseTotalHalls,
      assignedHalls: baseAssignedHalls,
      submittedHalls: baseSubmittedHalls,
      leaveApprovedHalls: baseLeaveApprovedHalls,
      leavePendingHalls: baseLeavePendingHalls,
      completionRate: baseCompletionRate,
    },
    teams: teamSummaries,
  });
});

// ── 团队管理日常任务看板：管理员-某基地下各团队进度列表 ─────────────────────────────
teamDailyReportRoutes.get("/tasks/report/team-daily-dashboard/teams/:baseOrgId/halls", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  const allowedAdminRoles = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"];
  if (!allowedAdminRoles.includes(roleCode)) {
    return fail(res, "TEAM_DAILY_TEAM_HALLS_FORBIDDEN", "当前身份无权查看", 403);
  }

  const { baseOrgId } = req.params;
  const now = new Date();
  const taskDate = t(req.query.taskDate) || formatBeijingDate(now);

  const team = await prisma.orgUnit.findFirst({
    where: { id: baseOrgId, status: "active", orgType: "BASE" },
    select: { id: true, name: true, path: true },
  });
  if (!team) return fail(res, "TEAM_ORG_NOT_FOUND", "基地不存在或已停用", 404);

  // scope 校验：TEAM_ADMIN 只能看自己基地
  const viewerScopePath = req.identity?.scopePath;
  if (roleCode !== "DEV_ADMIN") {
    if (!viewerScopePath) return fail(res, "FORBIDDEN", "缺少管理范围", 403);
    if (!(team.path === viewerScopePath || team.path.startsWith(`${viewerScopePath}/`))) {
      return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    }
  }

  // ① 查询基地下全量 active 团队
  const allTeamHalls = await prisma.orgUnit.findMany({
    where: { status: "active", orgType: "TEAM", parentId: baseOrgId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // ② 直接查询 taskDate 当天有 TeamTaskRecord 的团队（权威数据源，精确到日期）
  const allTeamHallIds = allTeamHalls.map((h) => h.id);
  const records = allTeamHallIds.length ? await prisma.teamTaskRecord.findMany({
    where: {
      teamOrgId: { in: allTeamHallIds },
      recordDate: taskDate,
      assignment: { status: { in: ["active", "ended"] } },
    },
    select: {
      id: true,
      teamOrgId: true,
      status: true,
      totalItems: true,
      doneItems: true,
      submittedAt: true,
      assignmentId: true,
      createdAt: true,
      assignment: { select: { status: true } },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  }) : [];

  // 从 records 推导当天真实有任务的团队集合
  const assignedHallIds = new Set(records.map((r) => r.teamOrgId));

  // 每个团队取最优一条：active assignment 优先，都是 ended 则取 createdAt 最晚的（对应最后生效的任务）
  const hallRecordMap = new Map<string, typeof records[number]>();
  for (const rec of records) {
    const existing = hallRecordMap.get(rec.teamOrgId);
    if (!existing) {
      hallRecordMap.set(rec.teamOrgId, rec);
    } else if (rec.assignment.status === "active" && existing.assignment.status !== "active") {
      hallRecordMap.set(rec.teamOrgId, rec);
    } else if (rec.assignment.status !== "active" && existing.assignment.status !== "active"
      && rec.createdAt > existing.createdAt) {
      hallRecordMap.set(rec.teamOrgId, rec);
    }
  }

  // ④ 返回全量团队列表（有任务的含进度，无任务的 hasTask=false）
  const result = allTeamHalls.map((hall) => {
    const hasTask = assignedHallIds.has(hall.id);
    const rec = hasTask ? hallRecordMap.get(hall.id) : undefined;
    return {
      teamOrgId: hall.id,
      teamOrgName: hall.name,
      hasTask,
      status: resolveTeamDailyReportStatus(rec, taskDate, now),
      totalItems: rec?.totalItems ?? 0,
      doneItems: rec?.doneItems ?? 0,
      completionRate: rec?.totalItems ? Math.round((rec.doneItems / rec.totalItems) * 100) : 0,
      submittedAt: rec?.submittedAt?.toISOString() ?? null,
      recordId: rec?.id ?? null,
    };
  });

  return ok(res, result);
});

// ── 团队管理日常任务看板：管理员-某团队详情（只读）────────────────────────────────
teamDailyReportRoutes.get("/tasks/report/team-daily-dashboard/halls/:teamOrgId/detail", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  const allowedAdminRoles = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"];
  if (!allowedAdminRoles.includes(roleCode)) {
    return fail(res, "TEAM_DAILY_HALL_DETAIL_FORBIDDEN", "当前身份无权查看", 403);
  }

  const { teamOrgId } = req.params;
  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());

  const hall = await prisma.orgUnit.findFirst({
    where: { id: teamOrgId, status: "active", orgType: "TEAM" },
    select: { id: true, name: true, path: true, parentId: true },
  });
  if (!hall) return fail(res, "HALL_NOT_FOUND", "团队不存在或已停用", 404);

  // scope 校验
  const viewerScopePath = req.identity?.scopePath;
  if (roleCode !== "DEV_ADMIN") {
    if (!viewerScopePath) return fail(res, "FORBIDDEN", "缺少管理范围", 403);
    const inScope = hall.path === viewerScopePath || hall.path.startsWith(`${viewerScopePath}/`);
    if (!inScope) return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该团队", 403);
  }

  const now = new Date();
  const today = formatBeijingDate(now);
  const phase = taskDate === today
    ? (now.getTime() <= getDailyTaskDayEnd(taskDate).getTime() ? "in_progress" : "supplement")
    : (now.getTime() < getDailyTaskSupplementDeadline(taskDate).getTime() ? "supplement" : "closed");

  const records = await prisma.teamTaskRecord.findMany({
    where: {
      teamOrgId,
      recordDate: taskDate,
      assignment: { status: { in: ["active", "ended"] } },
    },
    include: {
      assignment: {
        include: {
          template: {
            include: {
              items: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, title: true, itemType: true, isRequired: true, sortOrder: true, linkUrl: true },
              },
            },
          },
        },
      },
      itemRecords: {
        orderBy: { id: "asc" },
        include: {
          attachments: {
            select: { id: true, fileName: true, fileUrl: true, fileSize: true, mimeType: true },
          },
        },
      },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // active assignment 优先；都是 ended 则取 createdAt 最晚的（对应最后生效的任务）
  const activeRecord = records.find((r) => r.assignment.status === "active")
    ?? records.reduce<typeof records[number] | null>((best, rec) => {
      if (!best) return rec;
      return rec.createdAt > best.createdAt ? rec : best;
    }, null);

  const authorIds = [...new Set([activeRecord?.submittedBy, ...(activeRecord?.itemRecords.map(item=>item.doneBy) ?? [])].filter((id): id is string => !!id))];
  const authors = new Map((await prisma.user.findMany({where:{id:{in:authorIds}},select:{id:true,nickname:true}})).map(user=>[user.id,user.nickname]));
  const summary = {
    status: resolveTeamDailyReportStatus(activeRecord, taskDate, now),
    totalItems: activeRecord?.totalItems ?? 0,
    doneItems: activeRecord?.doneItems ?? 0,
    submittedAt: activeRecord?.submittedAt?.toISOString() ?? null,
    leaveRequest: serializeTeamDailyLeaveRequest(activeRecord),
    completionRate: activeRecord?.totalItems
      ? Math.round((activeRecord.doneItems / activeRecord.totalItems) * 100)
      : 0,
  };

  return ok(res, {
    taskDate,
    phase,
    hall: { id: hall.id, name: hall.name },
    summary,
    record: activeRecord
      ? {
          id: activeRecord.id,
          assignmentId: activeRecord.assignmentId,
          status: resolveTeamDailyReportStatus(activeRecord, taskDate, now),
          totalItems: activeRecord.totalItems,
          doneItems: activeRecord.doneItems,
          submittedAt: activeRecord.submittedAt?.toISOString() ?? null,
          submittedByName: activeRecord.submittedBy ? authors.get(activeRecord.submittedBy) ?? null : null,
          leaveRequest: serializeTeamDailyLeaveRequest(activeRecord),
          templateTitle: activeRecord.assignment.template?.title ?? null,
          items: (activeRecord.assignment.template?.items ?? []).map((item) => {
            const ir = activeRecord.itemRecords.find((r) => r.taskItemId === item.id);
            return {
              taskItemId: item.id,
              title: item.title,
              itemType: item.itemType,
              isRequired: item.isRequired,
              sortOrder: item.sortOrder,
              linkUrl: item.linkUrl ?? null,
              done: ir?.status === "done",
              doneAt: ir?.doneAt?.toISOString() ?? null,
              doneByName: ir?.doneBy ? authors.get(ir.doneBy) ?? null : null,
              answerText: ir?.answerText ?? null,
              answerOptions: Array.isArray(ir?.answerOptions) ? ir.answerOptions : null,
              isLinkConfirmed: ir?.isLinkConfirmed ?? false,
              attachments: (ir?.attachments ?? []).map((a) => ({
                id: a.id,
                fileName: a.fileName,
                fileUrl: a.fileUrl,
                fileSize: a.fileSize,
                mimeType: a.mimeType,
              })),
            };
          }),
        }
      : null,
  });
});

