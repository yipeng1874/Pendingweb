import fs from "fs";
import path from "path";
function serializeError(error) {
    if (!(error instanceof Error))
        return { value: String(error) };
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
    };
}
export function writeRuntimeLog(level, event, details = {}) {
    try {
        const cwd = process.cwd();
        const backendRoot = path.basename(cwd).toLowerCase() === "backend"
            ? cwd
            : fs.existsSync(path.join(cwd, "backend"))
                ? path.join(cwd, "backend")
                : cwd;
        const logDir = path.join(backendRoot, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(path.join(logDir, "backend-runtime.log"), `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details })}\n`, "utf8");
    }
    catch (error) {
        console.error("[runtime-log-write-failed]", serializeError(error));
    }
}
export function runtimeErrorDetails(error) {
    return serializeError(error);
}
