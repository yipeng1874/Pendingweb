import type { NextFunction, Request, Response } from "express";
import { fail } from "../shared/response.js";
import { prisma } from "../shared/prisma.js";
import type { Identity } from "../shared/types.js";

declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}

export async function identityRequired(req: Request, res: Response, next: NextFunction) {
  try {
    const identityId = req.header("X-Identity-Id") ?? String(req.body.identityId ?? "");
    const identity = await prisma.userIdentity.findFirst({ where: { id: identityId, userId: req.userId, status: "active" } });
    if (!identity) return fail(res, "IDENTITY_REQUIRED", "当前身份无效或不属于该账号", 403);
    req.identity = {
      id: identity.id,
      userId: identity.userId,
      roleCode: identity.roleCode as Identity["roleCode"],
      orgId: identity.orgId ?? undefined,
      anchorProfileId: identity.anchorProfileId ?? undefined,
      scopePath: identity.scopePath ?? undefined,
      status: identity.status,
    };
    return next();
  } catch (error) {
    console.error("身份校验失败", error);
    return fail(res, "IDENTITY_CHECK_FAILED", "身份校验失败，请稍后重试", 500);
  }
}
