import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { authApi } from "../services/auth";
import { useAuthStore } from "../stores/auth";
import { entryPathForIdentity } from "../utils/entry";
import { getFeishuAuthCode, isInFeishuApp } from "../utils/feishu";
import { pickBestIdentity } from "../utils/identity";

export function FeishuEntryPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const appId = new URLSearchParams(window.location.search).get("appId")?.trim()
      || localStorage.getItem("todo_h5_feishu_app_id")
      || "";
    if (!appId) {
      setError("缺少飞书应用标识，请联系管理员检查工作台主页地址");
      return;
    }
    if (!isInFeishuApp()) {
      navigate("/login", { replace: true });
      return;
    }

    void (async () => {
      try {
        const configs = await authApi.getFeishuAppIds();
        const matched = configs.find((item) => item.appId === appId);
        if (!matched) throw new Error("当前飞书应用尚未关联系统组织");
        const code = await getFeishuAuthCode(appId, matched.configId);
        const payload = await authApi.completeFeishuAppLogin(code, matched.configId);
        const identity = pickBestIdentity(payload.identities, payload.recommendedIdentityId);
        setAuth(payload);
        localStorage.setItem("todo_h5_feishu_app_id", appId);
        navigate(identity ? entryPathForIdentity(identity) : "/identity", { replace: true });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "飞书免登失败，请稍后重试");
      }
    })();
  }, [navigate, setAuth]);

  return (
    <div className="page-shell">
      <div className="mobile-page" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card card-strong" style={{ width: "100%", padding: 22, textAlign: "center" }}>
          {error ? (
            <>
              <div className="card-title" style={{ marginBottom: 8 }}>飞书自动登录失败</div>
              <div className="error" style={{ marginBottom: 14 }}>{error}</div>
              <button className="btn btn-primary" onClick={() => navigate("/login", { replace: true })}>使用其他方式登录</button>
            </>
          ) : (
            <>
              <Loader2 size={28} className="animate-spin" style={{ margin: "0 auto 12px" }} />
              <div className="card-title">正在通过飞书自动登录</div>
              <div className="card-subtitle" style={{ marginTop: 6 }}>正在识别账号与组织身份，请稍候。</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
