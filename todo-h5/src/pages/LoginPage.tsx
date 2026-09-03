import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Building2, Eye, EyeOff, ListTodo, Loader2, LockKeyhole, Smartphone } from "lucide-react";
import { authApi } from "../services/auth";
import { useAuthStore } from "../stores/auth";
import { entryPathForIdentity } from "../utils/entry";
import { isInFeishuApp } from "../utils/feishu";
import { pickBestIdentity } from "../utils/identity";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setAuth = useAuthStore((state) => state.setAuth);
  const currentIdentity = useAuthStore((state) => state.currentIdentity);
  const token = useAuthStore((state) => state.token);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
  const savedFeishuAppId = localStorage.getItem("todo_h5_feishu_app_id") ?? "";

  useEffect(() => {
    if (token && currentIdentity) navigate(entryPathForIdentity(currentIdentity), { replace: true });
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
        const identity = pickBestIdentity(payload.identities, payload.recommendedIdentityId);
        setAuth(payload);
        navigate(identity ? entryPathForIdentity(identity) : "/identity", { replace: true });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "飞书登录失败"))
      .finally(() => setFeishuLoading(false));
  }, [navigate, searchParams, setAuth]);

  async function handleLogin() {
    if (loading || !phone.trim() || !password) return;
    setError("");
    setLoading(true);
    try {
      const payload = await authApi.login(phone.trim(), password);
      const identity = pickBestIdentity(payload.identities, payload.recommendedIdentityId);
      setAuth(payload);
      navigate(identity ? entryPathForIdentity(identity) : "/identity", { replace: true });
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
    <div className="page-shell login-shell">
      <main className="mobile-page login-page">
        <header className="login-brand"><span className="login-brand-mark"><ListTodo size={23} strokeWidth={2.1} /></span><div><strong>千广协同</strong><span>移动工作台</span></div></header>
        <section className="login-content" aria-labelledby="login-title">
          <div className="login-welcome"><span className="login-eyebrow">让协作更简单</span><h1 id="login-title">欢迎回来</h1><p>随时掌握任务进展，让每一份工作有序推进。</p></div>
          <div className="login-methods" aria-label="选择登录方式">
            <button type="button" className={loginTab === "account" ? "active" : ""} aria-pressed={loginTab === "account"} disabled={loading || feishuLoading} onClick={() => { setLoginTab("account"); setError(""); }}>账号登录</button>
            <button type="button" className={loginTab === "feishu" ? "active" : ""} aria-pressed={loginTab === "feishu"} disabled={loading || feishuLoading} onClick={() => { setLoginTab("feishu"); setError(""); }}>飞书登录</button>
          </div>
          {loginTab === "account" ? (
            <form className="login-form" onSubmit={(event) => { event.preventDefault(); void handleLogin(); }} aria-label="账号登录">
              <div className="login-field"><label htmlFor="login-phone">手机号</label><div className="login-input-wrap"><Smartphone size={19} aria-hidden="true" /><input id="login-phone" type="tel" inputMode="tel" autoComplete="username" placeholder="请输入手机号" value={phone} disabled={loading} onChange={(event) => setPhone(event.target.value)} required /></div></div>
              <div className="login-field"><label htmlFor="login-password">密码</label><div className="login-input-wrap"><LockKeyhole size={19} aria-hidden="true" /><input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="请输入密码" value={password} disabled={loading} onChange={(event) => setPassword(event.target.value)} required /><button className="login-password-toggle" type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
              {error ? <div className="login-error" role="alert">{error}</div> : null}
              <button className="login-submit" type="submit" disabled={loading || !phone.trim() || !password}>{loading ? <><Loader2 size={18} className="animate-spin" />登录中…</> : <>登录<ArrowRight size={18} /></>}</button>
              <p className="login-helper">请使用已开通的账号登录</p>
            </form>
          ) : (
            <div className="login-form">
              <p className="login-feishu-note">选择所属组织，使用飞书账号授权登录。</p>
              {inFeishu && savedFeishuAppId ? <button type="button" className="login-feishu-quick" disabled={feishuLoading} onClick={() => { window.location.href = "/feishu-entry?appId=" + encodeURIComponent(savedFeishuAppId); }}>飞书一键登录<ArrowRight size={16} /></button> : null}
              <div className="login-field"><label htmlFor="login-base">所属基地</label><div className="login-input-wrap"><Building2 size={18} aria-hidden="true" /><select id="login-base" value={selectedBaseId} disabled={feishuLoading} onChange={(event) => { setSelectedBaseId(event.target.value); setSelectedTeamId(""); setSelectedConfigId(""); }}><option value="">请选择基地</option>{baseOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
              <div className="login-field"><label htmlFor="login-team">所属团队</label><div className="login-input-wrap"><select id="login-team" value={selectedTeamId} disabled={!selectedBaseId || feishuLoading} onChange={(event) => { setSelectedTeamId(event.target.value); setSelectedConfigId(""); }}><option value="">请选择团队</option>{teamOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
              <div className="login-field"><label htmlFor="login-company">飞书企业</label><div className="login-input-wrap"><select id="login-company" value={selectedConfigId} disabled={!selectedTeamId || feishuLoading} onChange={(event) => setSelectedConfigId(event.target.value)}><option value="">请选择飞书企业</option>{configOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
              {error ? <div className="login-error" role="alert">{error}</div> : null}
              <button className="login-submit" type="button" disabled={feishuLoading} onClick={handleFeishuLogin}>{feishuLoading ? <><Loader2 size={18} className="animate-spin" />登录中…</> : <>使用飞书登录<ArrowRight size={18} /></>}</button>
            </div>
          )}
        </section>
        <footer className="login-footer"><span />任务有序 · 协作高效<span /></footer>
      </main>
    </div>
  );
}
