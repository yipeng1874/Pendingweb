import type { Response } from "express";

export function ok<T>(res: Response, data: T) {
  return res.json({ success: true, data });
}

export function fail(res: Response, code: string, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}
