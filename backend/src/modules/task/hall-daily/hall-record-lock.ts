import type { Prisma } from "@prisma/client";
import { prisma } from "../../../shared/prisma.js";

// All leave/answer mutations serialize on the same record, across server processes.
export function withHallRecordLock<T>(recordId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM hall_task_records WHERE id = ${recordId} FOR UPDATE`;
    return action(tx);
  });
}
