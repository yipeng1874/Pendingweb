import fs from "fs";
import path from "path";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { reconcileTemporaryAssignments } from "./modules/task/assignment/assignment.service.js";
import { activateHallDailyScheduled, ensureHallDailyRecordsForToday } from "./modules/task/hall-daily/hall-daily.service.js";
import { runDailyNotifyScheduleTick } from "./modules/task/notify/notify.routes.js";
import { runTemporaryNotifyScheduleTick } from "./modules/task/notify/temporary-notify-schedule.routes.js";
import { ensureTaskAssignmentSchemaCompatibility } from "./shared/task-assignment-schema-compat.js";
import { runtimeErrorDetails, writeRuntimeLog } from "./shared/runtime-log.js";
function startTemporaryAssignmentReconciler() {
    const intervalMs = 60 * 1000;
    void reconcileTemporaryAssignments().catch((error) => {
        console.error("临时任务启动收口失败", error);
    });
    setInterval(() => {
        void reconcileTemporaryAssignments().catch((error) => {
            console.error("临时任务定时收口失败", error);
        });
    }, intervalMs);
}
function startDailyNotifyScheduler() {
    const intervalMs = 60 * 1000;
    const tick = async () => {
        const result = await runDailyNotifyScheduleTick();
        if (!result.checked)
            return;
        const sentItems = result.processed.filter((item) => item.status === "SENT");
        const failedItems = result.processed.filter((item) => item.status === "FAILED");
        if (sentItems.length) {
            console.log(`[daily-notify] 槽位 ${result.slotKey} 已处理 ${sentItems.length} 个基地：${sentItems
                .map((item) => `${item.baseOrgName}(频率=${item.intervalHours}h, 触达=${item.targetCount ?? 0}, 成功=${item.successCount ?? 0})`)
                .join("；")}`);
        }
        if (failedItems.length) {
            console.error(`[daily-notify] 槽位 ${result.slotKey} 有 ${failedItems.length} 个基地发送失败：${failedItems
                .map((item) => `${item.baseOrgName}(频率=${item.intervalHours}h): ${item.error ?? "未知错误"}`)
                .join("；")}`);
        }
    };
    void tick().catch((error) => {
        console.error("自动通知启动检查失败", error);
    });
    setInterval(() => {
        void tick().catch((error) => {
            console.error("自动通知定时检查失败", error);
        });
    }, intervalMs);
}
function startTemporaryNotifyScheduler() {
    const intervalMs = 60 * 1000;
    const tick = async () => {
        const result = await runTemporaryNotifyScheduleTick();
        if (!result.checked)
            return;
        const sentItems = result.processed.filter((item) => item["status"] === "SENT");
        const failedItems = result.processed.filter((item) => item["status"] === "FAILED");
        if (sentItems.length) {
            console.log(`[temp-notify] 槽位 ${result.slotKey} 已发送 ${sentItems.length} 条：${sentItems
                .map((item) => `${item["assignmentTitle"] ?? item["assignmentId"]}(剩${item["daysLeft"]}天, 触达=${item["audienceCount"] ?? 0}, 成功=${item["successCount"] ?? 0})`)
                .join("；")}`);
        }
        if (failedItems.length) {
            console.error(`[temp-notify] 槽位 ${result.slotKey} 有 ${failedItems.length} 条发送失败：${failedItems
                .map((item) => `${item["assignmentId"]}: ${item["error"] ?? "未知错误"}`)
                .join("；")}`);
        }
    };
    void tick().catch((error) => {
        console.error("临时催办启动检查失败", error);
    });
    setInterval(() => {
        void tick().catch((error) => {
            console.error("临时催办定时检查失败", error);
        });
    }, intervalMs);
}
function startHallDailyActivator() {
    const intervalMs = 60 * 1000;
    const tick = async () => {
        const activateResult = await activateHallDailyScheduled().catch((err) => {
            console.error("[hall-daily] 定时激活失败", err);
            return { activated: 0 };
        });
        if (activateResult.activated > 0) {
            console.log(`[hall-daily] 已激活 ${activateResult.activated} 个厅管日常任务`);
        }
        const recordResult = await ensureHallDailyRecordsForToday().catch((err) => {
            console.error("[hall-daily] 每日 Record 创建失败", err);
            return { created: 0 };
        });
        if (recordResult.created > 0) {
            console.log(`[hall-daily] 已为今日新建 ${recordResult.created} 条厅管执行记录`);
        }
    };
    void tick();
    setInterval(() => void tick(), intervalMs);
}
async function bootstrap() {
    // 确保上传目录存在
    fs.mkdirSync(path.join(process.cwd(), "uploads", "tasks"), { recursive: true });
    await ensureTaskAssignmentSchemaCompatibility();
    const app = createApp();
    const server = app.listen(env.PORT, () => {
        console.log(`主播待办系统 API 已启动：http://localhost:${env.PORT}`);
        startTemporaryAssignmentReconciler();
        startHallDailyActivator();
        startDailyNotifyScheduler();
        startTemporaryNotifyScheduler();
    });
    server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            const message = `后端端口 ${env.PORT} 已被占用：可能已有一个后端在运行，请勿重复启动。`;
            console.error(message);
            writeRuntimeLog("warn", "server_port_in_use", { port: env.PORT, error: runtimeErrorDetails(error) });
        }
        else {
            console.error("后端监听失败", error);
            writeRuntimeLog("error", "server_listen_failed", { port: env.PORT, error: runtimeErrorDetails(error) });
        }
        process.exit(1);
    });
}
bootstrap().catch((error) => {
    console.error("服务启动失败", error);
    process.exit(1);
});
