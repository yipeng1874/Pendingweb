import { Prisma } from "@prisma/client";
import { prisma } from "../../../shared/prisma.js";
// ─── 内部辅助：Prisma 行 → 业务类型 ────────────────────────────────────────────
function mapQuestion(q) {
    return {
        id: q.id,
        title: q.title,
        itemType: q.itemType,
        isRequired: q.isRequired,
        options: Array.isArray(q.options) ? q.options : [],
        linkUrl: q.linkUrl,
    };
}
function mapAnchorRecord(r) {
    return {
        id: r.id,
        anchorUserId: r.anchorUserId,
        anchorNickname: r.anchorNickname,
        anchorPhone: r.anchorPhone,
        anchorDouyinNo: r.anchorDouyinNo,
        anchorOrgId: r.anchorOrgId,
        anchorOrgName: r.anchorOrgName,
        status: r.status,
        submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    };
}
function mapAnswers(rawAnswers) {
    return rawAnswers.map((a) => ({
        questionId: a.questionId,
        answerText: a.answerText ?? undefined,
        answerOptions: Array.isArray(a.answerOptions) ? a.answerOptions : undefined,
        isLinkConfirmed: a.isLinkConfirmed ?? undefined,
        attachmentUrls: Array.isArray(a.attachmentUrls) ? a.attachmentUrls : undefined,
    }));
}
async function findTaskWithAll(taskId) {
    return prisma.broadcastTask.findUnique({
        where: { id: taskId },
        include: {
            questions: { orderBy: { id: "asc" } },
            anchorRecords: {
                include: { answers: true },
                orderBy: { id: "asc" },
            },
        },
    });
}
function dbTaskToBroadcastTask(t) {
    return {
        id: t.id,
        title: t.title,
        description: t.description,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        createdByUserId: t.createdByUserId,
        createdByIdentityId: t.createdByIdentityId,
        createdByName: t.createdByName,
        hallOrgId: t.hallOrgId,
        hallOrgName: t.hallOrgName,
        questions: t.questions.map(mapQuestion),
        anchorRecords: t.anchorRecords.map(mapAnchorRecord),
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
    };
}
// ─── 过期处理（数据库版，批量更新） ────────────────────────────────────────────
async function applyExpire() {
    const now = new Date();
    // 找出所有到期的 active 任务
    const expiredTasks = await prisma.broadcastTask.findMany({
        where: { status: "active", dueAt: { lt: now } },
        select: { id: true },
    });
    if (expiredTasks.length === 0)
        return;
    const ids = expiredTasks.map((t) => t.id);
    await prisma.$transaction([
        prisma.broadcastTask.updateMany({
            where: { id: { in: ids } },
            data: { status: "ended" },
        }),
        prisma.broadcastAnchorRecord.updateMany({
            where: {
                taskId: { in: ids },
                status: { in: ["pending", "in_progress"] },
            },
            data: { status: "overdue" },
        }),
    ]);
}
// ─── 查询 ──────────────────────────────────────────────────────────────────────
export async function listBroadcastTasksByIssuer(userId) {
    await applyExpire();
    const tasks = await prisma.broadcastTask.findMany({
        where: { createdByUserId: userId },
        include: {
            questions: { orderBy: { id: "asc" } },
            anchorRecords: { orderBy: { id: "asc" } },
        },
        orderBy: { createdAt: "desc" },
    });
    return tasks.map((t) => ({
        ...dbTaskToBroadcastTask({ ...t, anchorRecords: t.anchorRecords.map((r) => ({ ...r, answers: [] })) }),
        anchorRecords: t.anchorRecords.map(mapAnchorRecord),
    }));
}
/** 厅管看板专用：返回含每位主播 answers 的完整数据（已废弃，保留兼容） */
export async function listBroadcastTasksByIssuerWithAnswers(userId) {
    await applyExpire();
    const tasks = await prisma.broadcastTask.findMany({
        where: { createdByUserId: userId },
        include: {
            questions: { orderBy: { id: "asc" } },
            anchorRecords: { include: { answers: true }, orderBy: { id: "asc" } },
        },
        orderBy: { createdAt: "desc" },
    });
    return tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        createdByUserId: t.createdByUserId,
        createdByIdentityId: t.createdByIdentityId,
        createdByName: t.createdByName,
        hallOrgId: t.hallOrgId,
        hallOrgName: t.hallOrgName,
        questions: t.questions.map(mapQuestion),
        anchorRecords: t.anchorRecords.map((r) => ({
            ...mapAnchorRecord(r),
            answers: mapAnswers(r.answers),
        })),
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
    }));
}
/** 厅管看板分页查询：anchorRecords.answers 为空数组，需点击后懒加载 */
export async function listBroadcastTasksByIssuerPaged(userId, opts) {
    await applyExpire();
    const [total, tasks] = await prisma.$transaction([
        prisma.broadcastTask.count({ where: { createdByUserId: userId } }),
        prisma.broadcastTask.findMany({
            where: { createdByUserId: userId },
            include: {
                questions: { orderBy: { id: "asc" } },
                anchorRecords: { orderBy: { id: "asc" } },
            },
            orderBy: { createdAt: "desc" },
            skip: (opts.page - 1) * opts.pageSize,
            take: opts.pageSize,
        }),
    ]);
    const result = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        createdByUserId: t.createdByUserId,
        createdByIdentityId: t.createdByIdentityId,
        createdByName: t.createdByName,
        hallOrgId: t.hallOrgId,
        hallOrgName: t.hallOrgName,
        questions: t.questions.map(mapQuestion),
        anchorRecords: t.anchorRecords.map((r) => ({ ...mapAnchorRecord(r), answers: [] })),
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
    }));
    return {
        tasks: result,
        total,
        page: opts.page,
        pageSize: opts.pageSize,
        hasMore: (opts.page - 1) * opts.pageSize + tasks.length < total,
    };
}
/** 懒加载：获取单个任务所有主播的答案 */
export async function getBroadcastTaskAnchorAnswers(taskId, userId) {
    const task = await prisma.broadcastTask.findUnique({
        where: { id: taskId, createdByUserId: userId },
        include: {
            anchorRecords: { include: { answers: true }, orderBy: { id: "asc" } },
        },
    });
    if (!task)
        return null;
    return task.anchorRecords.map((r) => ({
        ...mapAnchorRecord(r),
        answers: mapAnswers(r.answers),
    }));
}
export async function getBroadcastTaskById(taskId) {
    const t = await findTaskWithAll(taskId);
    if (!t)
        return null;
    return dbTaskToBroadcastTask(t);
}
export async function createBroadcastTask(input) {
    const task = await prisma.broadcastTask.create({
        data: {
            title: input.title,
            description: input.description ?? null,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            createdByUserId: input.createdByUserId,
            createdByIdentityId: input.createdByIdentityId,
            createdByName: input.createdByName,
            hallOrgId: input.hallOrgId,
            hallOrgName: input.hallOrgName,
            status: "active",
            questions: {
                create: input.questions.map((q) => ({
                    title: q.title,
                    itemType: q.itemType,
                    isRequired: q.isRequired,
                    options: (q.options ?? []),
                    linkUrl: q.linkUrl ?? null,
                })),
            },
            anchorRecords: {
                create: input.anchors.map((anchor) => ({
                    anchorUserId: anchor.userId,
                    anchorNickname: anchor.nickname,
                    anchorPhone: anchor.phone,
                    anchorDouyinNo: anchor.douyinNo ?? null,
                    anchorOrgId: anchor.orgId ?? null,
                    anchorOrgName: anchor.orgName ?? null,
                    status: "pending",
                })),
            },
        },
        include: {
            questions: { orderBy: { id: "asc" } },
            anchorRecords: { include: { answers: true }, orderBy: { id: "asc" } },
        },
    });
    return dbTaskToBroadcastTask(task);
}
// ─── 保存单道题目答案 ──────────────────────────────────────────────────────────
export async function saveBroadcastAnswer(taskId, userId, answer) {
    // 查任务 + 主播记录
    const task = await prisma.broadcastTask.findUnique({
        where: { id: taskId },
        include: { questions: true },
    });
    if (!task)
        return { success: false, error: "TASK_NOT_FOUND" };
    const rec = await prisma.broadcastAnchorRecord.findUnique({
        where: { taskId_anchorUserId: { taskId, anchorUserId: userId } },
        include: { answers: true },
    });
    if (!rec)
        return { success: false, error: "FORBIDDEN" };
    if (rec.status === "submitted")
        return { success: false, error: "ALREADY_SUBMITTED" };
    if (rec.status === "overdue")
        return { success: false, error: "OVERDUE" };
    // upsert 答案
    await prisma.broadcastAnchorAnswer.upsert({
        where: { recordId_questionId: { recordId: rec.id, questionId: answer.questionId } },
        create: {
            recordId: rec.id,
            questionId: answer.questionId,
            answerText: answer.answerText ?? null,
            answerOptions: answer.answerOptions ?? Prisma.JsonNull,
            isLinkConfirmed: answer.isLinkConfirmed ?? null,
            attachmentUrls: answer.attachmentUrls ?? Prisma.JsonNull,
        },
        update: {
            answerText: answer.answerText ?? null,
            answerOptions: answer.answerOptions ?? Prisma.JsonNull,
            isLinkConfirmed: answer.isLinkConfirmed ?? null,
            attachmentUrls: answer.attachmentUrls ?? Prisma.JsonNull,
        },
    });
    // 激活中
    let newStatus = rec.status;
    if (rec.status === "pending") {
        newStatus = "in_progress";
    }
    // 重新拉最新答案，检查必填题是否全部完成
    const freshAnswers = await prisma.broadcastAnchorAnswer.findMany({ where: { recordId: rec.id } });
    const allRequiredDone = task.questions.every((q) => {
        if (!q.isRequired)
            return true;
        const ans = freshAnswers.find((a) => a.questionId === q.id);
        if (!ans)
            return false;
        if (q.itemType === "QA" || q.itemType === "FILL_BLANK")
            return !!(ans.answerText?.trim());
        if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE")
            return (Array.isArray(ans.answerOptions) ? ans.answerOptions.length : 0) > 0;
        if (q.itemType === "LINK")
            return !!ans.isLinkConfirmed;
        if (q.itemType === "ATTACHMENT")
            return (Array.isArray(ans.attachmentUrls) ? ans.attachmentUrls.length : 0) > 0;
        return false;
    });
    let recordCompleted = false;
    const now = new Date();
    if (allRequiredDone && newStatus !== "submitted") {
        newStatus = "submitted";
        recordCompleted = true;
    }
    // 更新主播记录状态
    const updatedRec = await prisma.broadcastAnchorRecord.update({
        where: { id: rec.id },
        data: {
            status: newStatus,
            submittedAt: recordCompleted ? now : undefined,
        },
        include: { answers: true },
    });
    // 组装 BroadcastTaskForAnchor 返回
    const taskBase = {
        id: task.id,
        title: task.title,
        description: task.description,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        createdByUserId: task.createdByUserId,
        createdByIdentityId: task.createdByIdentityId,
        createdByName: task.createdByName,
        hallOrgId: task.hallOrgId,
        hallOrgName: task.hallOrgName,
        questions: task.questions.map(mapQuestion),
        status: task.status,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
    };
    return {
        success: true,
        task: {
            ...taskBase,
            myRecord: {
                ...mapAnchorRecord(updatedRec),
                answers: mapAnswers(updatedRec.answers),
            },
        },
        recordCompleted,
    };
}
// ─── 查询"我的"群发任务 ────────────────────────────────────────────────────────
export async function getBroadcastTasksForAnchor(userId) {
    const now = new Date();
    const records = await prisma.broadcastAnchorRecord.findMany({
        where: {
            anchorUserId: userId,
            task: {
                status: "active",
                OR: [
                    { dueAt: null },
                    { dueAt: { gt: now } },
                ],
            },
        },
        include: {
            task: { include: { questions: { orderBy: { id: "asc" } } } },
            answers: true,
        },
        orderBy: { task: { createdAt: "desc" } },
    });
    const result = [];
    for (const rec of records) {
        const taskBase = {
            id: rec.task.id,
            title: rec.task.title,
            description: rec.task.description,
            dueAt: rec.task.dueAt ? rec.task.dueAt.toISOString() : null,
            createdByUserId: rec.task.createdByUserId,
            createdByIdentityId: rec.task.createdByIdentityId,
            createdByName: rec.task.createdByName,
            hallOrgId: rec.task.hallOrgId,
            hallOrgName: rec.task.hallOrgName,
            questions: rec.task.questions.map(mapQuestion),
            status: rec.task.status,
            createdAt: rec.task.createdAt.toISOString(),
            updatedAt: rec.task.updatedAt.toISOString(),
        };
        result.push({
            ...taskBase,
            myRecord: {
                ...mapAnchorRecord(rec),
                answers: mapAnswers(rec.answers),
            },
        });
    }
    return result;
}
