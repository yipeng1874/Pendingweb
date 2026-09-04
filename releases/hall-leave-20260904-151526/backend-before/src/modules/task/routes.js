import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { ok } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";
export const taskRoutes = Router();
taskRoutes.use(authRequired, identityRequired);
const normalizeTask = (task) => ({
    ...task,
    questions: task.questions?.map((q) => ({ ...q, options: q.optionsJson ?? undefined })),
    targetCount: task._count?.targets,
});
taskRoutes.get("/tasks", permissionRequired("task:view"), async (_req, res) => {
    const tasks = await prisma.task.findMany({ include: { questions: { orderBy: { sortOrder: "asc" } }, _count: { select: { targets: true } } }, orderBy: { createdAt: "desc" } });
    return ok(res, tasks.map(normalizeTask));
});
taskRoutes.post("/tasks", permissionRequired("task:create"), async (req, res) => {
    const task = await prisma.task.create({
        data: {
            taskType: req.body.taskType,
            title: req.body.title,
            description: req.body.description,
            publisherUserId: req.userId,
            publisherIdentityId: req.identity.id,
            publisherOrgId: req.identity.orgId,
            status: "draft",
            dueAt: req.body.dueAt ? new Date(req.body.dueAt) : undefined,
            questions: {
                create: (req.body.questions ?? []).map((item, index) => ({ questionType: item.questionType ?? "text", title: item.title ?? "任务反馈", optionsJson: item.options ?? undefined, linkUrl: item.linkUrl, required: item.required ?? true, sortOrder: index + 1 })),
            },
        },
        include: { questions: true, _count: { select: { targets: true } } },
    });
    return ok(res, normalizeTask(task));
});
taskRoutes.patch("/tasks/:id", permissionRequired("task:create"), async (req, res) => {
    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.status !== "draft")
        return ok(res, existing);
    const task = await prisma.task.update({ where: { id: req.params.id }, data: req.body });
    return ok(res, task);
});
function isVirtualHall(org) {
    return Boolean(org?.orgCode?.startsWith("HALL-VIRTUAL-") || org?.douyinUid?.startsWith("virtual-") || org?.name?.includes("模拟厅"));
}
taskRoutes.post("/tasks/:id/publish", permissionRequired("task:publish"), async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    const identities = await prisma.userIdentity.findMany({
        where: {
            status: "active",
            ...(req.body.roleCode ? { roleCode: req.body.roleCode } : {}),
            ...(req.body.orgPath ? { scopePath: { startsWith: req.body.orgPath } } : {}),
        },
        include: { org: true },
    });
    const selected = req.body.roleCode === "ANCHOR" ? identities.filter((identity) => !isVirtualHall(identity.org)) : identities;
    for (const identity of selected) {
        await prisma.taskTarget.upsert({
            where: { taskId_targetIdentityId: { taskId: req.params.id, targetIdentityId: identity.id } },
            update: {},
            create: { taskId: req.params.id, targetIdentityId: identity.id, targetUserId: identity.userId, targetOrgId: identity.orgId, targetAnchorProfileId: identity.anchorProfileId, snapshotRoleCode: identity.roleCode, snapshotOrgPath: identity.scopePath, status: "pending" },
        });
    }
    const publishedTask = task ? await prisma.task.update({ where: { id: task.id }, data: { status: "published" } }) : null;
    return ok(res, { task: publishedTask, targetCount: selected.length });
});
taskRoutes.get("/my/todos", permissionRequired("task:view"), async (req, res) => {
    const list = await prisma.taskTarget.findMany({ where: { targetIdentityId: req.identity.id }, include: { task: true }, orderBy: { task: { createdAt: "desc" } } });
    return ok(res, list);
});
taskRoutes.get("/my/todos/:id", permissionRequired("task:view"), async (req, res) => {
    const target = await prisma.taskTarget.findFirst({ where: { id: req.params.id, targetIdentityId: req.identity.id }, include: { task: true } });
    if (!target)
        return ok(res, undefined);
    const questions = await prisma.taskQuestion.findMany({ where: { taskId: target.taskId }, orderBy: { sortOrder: "asc" } });
    return ok(res, { ...target, questions: questions.map((q) => ({ ...q, options: q.optionsJson ?? undefined })) });
});
taskRoutes.post("/my/todos/:id/submit", permissionRequired("task:submit"), async (req, res) => {
    const target = await prisma.taskTarget.findFirst({ where: { id: req.params.id, targetIdentityId: req.identity.id } });
    if (!target)
        return ok(res, undefined);
    const submittedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.taskTarget.update({ where: { id: target.id }, data: { status: "submitted", submittedAt } });
        await tx.taskSubmission.create({ data: { taskTargetId: target.id, submitterUserId: req.userId, submitterIdentityId: req.identity.id, answersJson: req.body.answers ?? {}, submittedAt } });
        return updated;
    });
    return ok(res, result);
});
