import { Redis } from "ioredis";
import { env } from "./env.js";

export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { lazyConnect: true }) : undefined;

export async function readCache<T>(key: string): Promise<T | undefined> {
  if (!redis) return undefined;
  const value = await redis.get(key);
  return value ? (JSON.parse(value) as T) : undefined;
}

export async function writeCache(key: string, value: unknown, seconds = 300) {
  if (!redis) return;
  await redis.set(key, JSON.stringify(value), "EX", seconds);
}
