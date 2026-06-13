import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Smartphone } from "lucide-react";
import { authApi } from "../services/auth";
import { useAuthStore } from "../stores/auth";

function isInFeishuApp() {
  return /Lark|Feishu/i.test(window.navigator.userAgent);
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setAuth = useAuthStore((state) => state.setAuth);
  const currentIdentity = useAuthStore((state) => state.currentIdentity);
  const token = useAuthStore((state) => state.token);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [feishuLoading, setFeishuLoading] = useState(false);
  const [baseOptions, setBaseOptions] = useState<Array<{ id: string; name: string; orgType: string }>>([]);
  const [teamOptions, setTeamOptions] = useState<Array<{ id: string; name: string; orgType: string }>>([]);
  const [configOptions, setConfigOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [loginTab, setLoginTab] = useState<"account" | "feishu">("account");
  const inFeishu = useMemo(() => isInFeishuApp(), []);

  useEffect(() => {
    if (token && currentIdentity) navigate("/todos", { replace: true });
    else if (token) navigate("/identity", { replace: true });
  }, [token, currentIdentity, navigate]);

  useEffect(() => {
    if (inFeishu) setLoginTab("feishu");
  }, [inFeishu]);

  useEffect(() => {
    authApi.getFeishuBaseOptions().then(setBaseOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedBaseId) return void setTeamOptions([]);
    authApi.getFeishuTeamOptions(selectedBaseId).then(setTeamOptions).catch(() => undefined);
  }, [selectedBaseId]);

  useEffect(() => {
    if (!selectedBaseId || !selectedTeamId) return void setConfigOptions([]);
    authApi.getFeishuConfigs(selectedBaseId, selectedTeamId).then(setConfigOptions).catch(() => undefined);
  }, [selectedBaseId, selectedTeamId]);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !state) return;
    setFeishuLoading(true);
    authApi.completeFeishuLogin(code, state)
      .then((payload) => {
        setAuth(payload);
        navigate(payload.identities.length === 1 ? "/todos" : "/identity", { replace: true });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "飞书登录失败"))
      .finally(() => setFeishuLoading(false));
  }, [navigate, searchParams, setAuth]);

  async function handleLogin() {
    setError("");
    setLoading(true);
    try {
      const payload = await authApi.login(phone, password);
      setAuth(payload);
      navigate(payload.identities.length === 1 ? "/todos" : "/identity", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  function handleFeishuLogin() {
    if (!selectedBaseId || !selectedTeamId || !selectedConfigId) {
      setError("请先选择基地、团队和飞书企业");
      return;
    }
    setError("");
    window.location.href = `/api/auth/feishu/login?action=login&client=h5&configId=${encodeURIComponent(selectedConfigId)}`;
  }

  return (
    <div className="page-shell">
      <div className="mobile-page bottom-safe">
        <div className="hero-panel" style={{ paddingBottom: 8 }}>
          <div className="hero-kicker"><Smartphone size={13} /> 我的待办 H5</div>
          <h1 className="hero-title">把待办装进手机里</h1>
        </div>

        <div className="section" style={{ paddingTop: 0 }}>
          <div className="card" style={{ padding: 8, marginBottom: 12 }}>
            <div className="segmented">
              <button className={`btn ${loginTab === "account" ? "btn-primary" : "btn-ghost"}`} onClick={() => setLoginTab("account")}>账号登录</button>
              <button className={`btn ${loginTab === "feishu" ? "btn-primary" : "btn-ghost"}`} onClick={() => setLoginTab("feishu")}>飞书登录</button>
            </div>
          </div>

          {loginTab === "account" ? (
            <div className="card card-strong" style={{ padding: 14, display: "grid", gap: 12 }}>
              <div>
                <p className="card-title">账号登录</p>
                <p className="card-subtitle">输入手机号和密码后登录。</p>
              </div>
              <input className="input" placeholder="请输入手机号" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input className="input" type="password" placeholder="请输入密码" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error ? <div className="error">{error}</div> : null}
              <button className="btn btn-primary" disabled={loading || !phone || !password} onClick={() => void handleLogin()}>
                {loading ? "登录中..." : "登录"}
              </button>
            </div>
          ) : (
            <div className="card card-strong" style={{ padding: 14, display: "grid", gap: 12 }}>
              <div>
                <p className="card-title">飞书登录</p>
                <p className="card-subtitle">选择基地、团队与飞书企业后授权登录。</p>
              </div>
              <select className="select" value={selectedBaseId} onChange={(e) => { setSelectedBaseId(e.target.value); setSelectedTeamId(""); setSelectedConfigId(""); }}>
                <option value="">请选择基地</option>
                {baseOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select className="select" value={selectedTeamId} onChange={(e) => { setSelectedTeamId(e.target.value); setSelectedConfigId(""); }}>
                <option value="">请选择团队</option>
                {teamOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select className="select" value={selectedConfigId} onChange={(e) => setSelectedConfigId(e.target.value)}>
                <option value="">请选择飞书企业</option>
                {configOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {error ? <div className="error">{error}</div> : null}
              <button className="btn btn-primary" disabled={feishuLoading} onClick={handleFeishuLogin}>
                {feishuLoading ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "center" }}><Loader2 size={16} className="animate-spin" />登录中</span> : (inFeishu ? "使用飞书登录" : "前往飞书授权登录")}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
