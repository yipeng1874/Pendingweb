import type { NextFunction, Request, Response } from "express";
import { fail } from "../shared/response.js";
import { prisma } from "../shared/prisma.js";

export function permissionRequired(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identity = req.identity;
      if (!identity) return fail(res, "IDENTITY_REQUIRED", "请先选择身份", 403);
      const permissions = await prisma.rolePermission.findMany({ where: { roleCode: identity.roleCode }, select: { permissionCode: true } });
      const codes = permissions.map((item) => item.permissionCode);
      if (!codes.includes("*") && !codes.includes(permission)) {
        return fail(res, "FORBIDDEN", "当前身份无权执行该操作", 403);
      }
      return next();
    } catch (error) {
      console.error("权限校验失败", error);
      return fail(res, "PERMISSION_CHECK_FAILED", "权限校验失败，请稍后重试", 500);
    }
  };
}
