import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { ok } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";
export const reportRoutes = Router();
reportRoutes.use(authRequired, identityRequired);
reportRoutes.get("/reports/tasks/:id/summary", permissionRequired("report:view"), async (req, res) => {
    const [total, submitted] = await Promise.all([
        prisma.taskTarget.count({ where: { taskId: req.params.id } }),
        prisma.taskTarget.count({ where: { taskId: req.params.id, status: "submitted" } }),
    ]);
    return ok(res, { taskId: req.params.id, total, submitted, pending: total - submitted, completionRate: total ? submitted / total : 0 });
});
reportRoutes.get("/reports/tasks/:id/targets", permissionRequired("report:view_detail"), async (req, res) => {
    const targets = await prisma.taskTarget.findMany({ where: { taskId: req.params.id }, include: { task: true, submissions: true }, orderBy: { submittedAt: "desc" } });
    return ok(res, targets);
});
reportRoutes.get("/reports/orgs/summary", permissionRequired("report:view"), async (_req, res) => {
    const orgs = await prisma.orgUnit.findMany({ orderBy: [{ depth: "asc" }, { orgCode: "asc" }] });
    const data = await Promise.all(orgs.map(async (org) => {
        const [total, submitted] = await Promise.all([
            prisma.taskTarget.count({ where: { snapshotOrgPath: { startsWith: org.path } } }),
            prisma.taskTarget.count({ where: { snapshotOrgPath: { startsWith: org.path }, status: "submitted" } }),
        ]);
        return { orgId: org.id, orgName: org.name, total, submitted, completionRate: total ? submitted / total : 0 };
    }));
    return ok(res, data);
});
reportRoutes.get("/reports/dashboard", permissionRequired("report:view"), async (_req, res) => {
    const [taskCount, published, targetCount, submitted] = await Promise.all([
        prisma.task.count(),
        prisma.task.count({ where: { status: "published" } }),
        prisma.taskTarget.count(),
        prisma.taskTarget.count({ where: { status: "submitted" } }),
    ]);
    return ok(res, { taskCount, published, targetCount, submitted, pending: targetCount - submitted });
});
