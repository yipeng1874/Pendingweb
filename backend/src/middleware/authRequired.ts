import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { fail } from "../shared/response.js";
import { prisma } from "../shared/prisma.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Only reuse successful validation within the same HTTP request.
const verifiedRequests = new WeakMap<Request, { token: string; userId: string }>();

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return fail(res, "UNAUTHORIZED", "请先登录", 401);
    const verified = verifiedRequests.get(req);
    if (verified?.token === token && verified.userId === req.userId) return next();
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    const user = await prisma.user.findFirst({ where: { id: payload.userId, status: "active" } });
    if (!user) return fail(res, "UNAUTHORIZED", "账号不存在或已停用", 401);
    req.userId = user.id;
    verifiedRequests.set(req, { token, userId: user.id });
    return next();
  } catch {
    return fail(res, "UNAUTHORIZED", "登录状态无效或已过期", 401);
  }
}
