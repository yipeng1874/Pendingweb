import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { ok } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";

export const identityRoutes = Router();

identityRoutes.get("/identities", authRequired, async (req, res) => {
  const list = await prisma.userIdentity.findMany({ where: { userId: req.userId, status: "active" }, include: { org: true, anchorProfile: true } });
  return ok(res, list);
});

identityRoutes.post("/identities/switch", authRequired, async (req, res) => {
  const identity = await prisma.userIdentity.findFirst({ where: { id: req.body.identityId, userId: req.userId, status: "active" }, include: { org: true, anchorProfile: true } });
  if (identity) await prisma.userIdentity.update({ where: { id: identity.id }, data: { lastSwitchedAt: new Date() } });
  return ok(res, { identity });
});

identityRoutes.get("/me/permissions", authRequired, identityRequired, async (req, res) => {
  const rows = await prisma.rolePermission.findMany({ where: { roleCode: req.identity!.roleCode }, select: { permissionCode: true } });
  return ok(res, rows.map((item) => item.permissionCode));
});

identityRoutes.get("/me", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return ok(res, null);
  const { passwordHash: _ph, ...safeU } = user as any;
  return ok(res, safeU);
});
