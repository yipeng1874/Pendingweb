import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { getFeishuAuthCode, isInFeishuApp } from "../../shared/utils/feishu";

/**
 * 飞书免登中转页
 *
 * 飞书开放平台「网页应用 → 桌面端主页」配置：
 *   http://frp7.ccszxc.site:29266/feishu-entry?appId=cli_xxx
 *
 * 流程：
 *   1. 从 URL query 读取 appId
 *   2. 调 GET /api/auth/feishu/app-ids 找到对应 configId
 *   3. 调 getFeishuAuthCode(appId) 获取临时 code
 *   4. POST /api/auth/feishu/app-login 换取 token
 *   5. 成功 → 跳转 /tasks/cockpit；失败 → 跳转 /login
 */
export function FeishuEntryPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const appId = params.get("appId")?.trim() ?? "";

    if (!appId) {
      setStatus("error");
      setErrorMsg("缺少 appId 参数，请联系管理员检查飞书开放平台配置");
      return;
    }

    if (!isInFeishuApp()) {
      // 非飞书环境直接跳登录页
      navigate(`/login`, { replace: true });
      return;
    }

    (async () => {
      try {
        // 1. 拉取所有飞书企业配置，本地找到 configId
        const listResp = await fetch("/api/auth/feishu/app-ids");
        const listJson = (await listResp.json()) as { success: boolean; data?: Array<{ configId: string; appId: string }> };
        if (!listJson.success || !listJson.data) throw new Error("获取飞书配置列表失败");

        const matched = listJson.data.find((item) => item.appId === appId);
        if (!matched) throw new Error(`未找到 appId=${appId} 对应的企业配置，请联系管理员`);

        const { configId } = matched;

        // 2. 获取飞书授权 code
        const code = await getFeishuAuthCode(appId);

        // 3. 后端登录
        const loginResp = await fetch("/api/auth/feishu/app-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, configId }),
        });
        const loginJson = (await loginResp.json()) as {
          success: boolean;
          data?: unknown;
          error?: { code?: string; message?: string };
        };

        if (!loginJson.success) {
          const errCode = loginJson.error?.code ?? "";
          if (errCode === "FEISHU_UNBOUND" || errCode === "USER_NOT_FOUND") {
            // 飞书账号未绑定系统账号，跳登录页提示
            navigate("/login?feishuUnbound=1", { replace: true });
            return;
          }
          throw new Error(loginJson.error?.message ?? "登录失败");
        }

        // 4. 写入 auth store，跳转首页
        // 保存 appId 供退出重登、token 过期重登使用
        localStorage.setItem("feishu_entry_app_id", appId);
        setAuth(loginJson.data as Parameters<typeof setAuth>[0]);
        navigate("/tasks/cockpit", { replace: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "未知错误";
        console.error("[FeishuEntryPage] 免登失败:", msg);
        setStatus("error");
        setErrorMsg(msg);
      }
    })();
  }, [navigate, setAuth]);

  if (status === "error") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          background: "#f8fafc",
          color: "#334155",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>飞书自动登录失败</div>
        <div style={{ fontSize: 13, color: "#64748b", textAlign: "center", maxWidth: 320 }}>{errorMsg}</div>
        <button
          onClick={() => navigate("/login", { replace: true })}
          style={{
            marginTop: 8,
            padding: "8px 24px",
            background: "#3b7af5",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          手动登录
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "#f8fafc",
        color: "#64748b",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: "3px solid #3b7af5",
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontSize: 14 }}>正在通过飞书自动登录...</div>
    </div>
  );
}
