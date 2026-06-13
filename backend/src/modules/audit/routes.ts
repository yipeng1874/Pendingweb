import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { ok } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";

export const auditRoutes = Router();
auditRoutes.use(authRequired, identityRequired);

auditRoutes.get("/audit/logs", permissionRequired("audit:view"), async (_req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return ok(res, logs);
});
