import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/auth";
import { useAuthStore } from "../stores/auth";

export function FeishuCallbackPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [status, setStatus] = useState("正在完成飞书登录...");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") ?? "";
    const state = params.get("state") ?? "";
    const errorParam = params.get("error") ?? "";
    let timer: number | null = null;

    if (errorParam) {
      setIsError(true);
      setStatus(`飞书授权失败：${errorParam}`);
      timer = window.setTimeout(() => navigate("/login", { replace: true }), 2500);
      return () => {
        if (timer) window.clearTimeout(timer);
      };
    }

    if (!code || !state) {
      setIsError(true);
      setStatus("缺少飞书授权信息，请重新发起登录");
      timer = window.setTimeout(() => navigate("/login", { replace: true }), 2500);
      return () => {
        if (timer) window.clearTimeout(timer);
      };
    }

    authApi.completeFeishuLogin(code, state)
      .then((payload) => {
        setAuth(payload);
        navigate(payload.identities.length === 1 ? "/todos" : "/identity", { replace: true });
      })
      .catch((err) => {
        setIsError(true);
        setStatus(err instanceof Error ? err.message : "飞书登录失败，请稍后重试");
        timer = window.setTimeout(() => navigate("/login", { replace: true }), 2500);
      });

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [navigate, setAuth]);

  return (
    <div className="page-shell">
      <div className="mobile-page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card card-strong" style={{ padding: 20, width: "100%", textAlign: "center" }}>
          <div className="card-title" style={{ marginBottom: 8 }}>{isError ? "飞书登录失败" : "飞书授权处理中"}</div>
          <div className="card-subtitle">{status}</div>
        </div>
      </div>
    </div>
  );
}
