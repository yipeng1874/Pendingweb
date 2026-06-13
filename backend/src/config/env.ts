import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().default("dev-secret"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  DEV_ADMIN_PHONE: z.string().default("15555353696"),
  DEV_ADMIN_PASSWORD: z.string().default("Admin@123456"),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  FEISHU_REDIRECT_URI: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
