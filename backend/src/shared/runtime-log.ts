import fs from "fs";
import path from "path";

type RuntimeLogLevel = "info" | "warn" | "error";

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { value: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: (error as Error & { code?: unknown }).code,
  };
}

export function writeRuntimeLog(level: RuntimeLogLevel, event: string, details: Record<string, unknown> = {}) {
  try {
    const cwd = process.cwd();
    const backendRoot = path.basename(cwd).toLowerCase() === "backend"
      ? cwd
      : fs.existsSync(path.join(cwd, "backend"))
        ? path.join(cwd, "backend")
        : cwd;
    const logDir = path.join(backendRoot, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "backend-runtime.log"),
      `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details })}\n`,
      "utf8",
    );
  } catch (error) {
    console.error("[runtime-log-write-failed]", serializeError(error));
  }
}

export function runtimeErrorDetails(error: unknown) {
  return serializeError(error);
}
