import { useEffect, useState } from "react";
import { api } from "../../services/http";
import { useAuthStore } from "../../stores/authStore";
import { isInFeishuApp } from "../../shared/utils/feishu";
import type { FeishuEnterpriseConfig, User } from "../../types";

export function SettingsPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bindLoading, setBindLoading] = useState(false);
  const [unbindLoading, setUnbindLoading] = useState(false);
  const [bindMessage, setBindMessage] = useState("");
  const [bindError, setBindError] = useState("");
  const [baseOptions, setBaseOptions] = useState<FeishuEnterpriseConfig["baseOrg"][]>([]);
  const [teamOptions, setTeamOptions] = useState<FeishuEnterpriseConfig["teamOrg"][]>([]);
  const [configOptions, setConfigOptions] = useState<FeishuEnterpriseConfig[]>([]);
  const [boundConfig, setBoundConfig] = useState<FeishuEnterpriseConfig | null>(null);
  const [baseOptionsLoading, setBaseOptionsLoading] = useState(true);
  const [teamOptionsLoading, setTeamOptionsLoading] = useState(false);
  const [configOptionsLoading, setConfigOptionsLoading] = useState(false);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedConfigId, setSelectedConfigId] = useState("");

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);

  const [freshUser, setFreshUser] = useState<User | null>(null);
  useEffect(() => {
    api.get<User>("/me")
      .then(setFreshUser)
      .catch(() => setFreshUser(null));
  }, [bindMessage]);

  useEffect(() => {
    let cancelled = false;
    setBaseOptionsLoading(true);
    api.get<FeishuEnterpriseConfig["baseOrg"][]>("/auth/feishu/base-options")
      .then((bases) => {
        if (cancelled) return;
        setBaseOptions(bases);
      })
      .catch((err) => {
        if (cancelled) return;
        setBindError(err instanceof Error ? err.message : "加载飞书基地失败");
      })
      .finally(() => {
        if (!cancelled) setBaseOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayUser = freshUser ?? user;
  const isBound = !!displayUser?.feishuBoundAt;
  const feishuOptionsLoading = baseOptionsLoading || teamOptionsLoading || configOptionsLoading;

  useEffect(() => {
    const configId = displayUser?.feishuConfigId;
    if (!configId) {
      setBoundConfig(null);
      return;
    }

    let cancelled = false;
    api.get<FeishuEnterpriseConfig[]>(`/auth/feishu/configs?configId=${encodeURIComponent(configId)}`)
      .then((configs) => {
        if (cancelled) return;
        const currentConfig = configs[0] ?? null;
        setBoundConfig(currentConfig);
        if (!currentConfig) return;
        setSelectedBaseId(currentConfig.baseOrgId);
        setSelectedTeamId(currentConfig.teamOrgId);
        setSelectedConfigId(currentConfig.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setBoundConfig(null);
        setBindError(err instanceof Error ? err.message : "加载当前飞书绑定信息失败");
      });
    return () => {
      cancelled = true;
    };
  }, [displayUser?.feishuConfigId]);

  useEffect(() => {
    if (!selectedBaseId) {
      setTeamOptions([]);
      setConfigOptions([]);
      setTeamOptionsLoading(false);
      setConfigOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setTeamOptions([]);
    setConfigOptions([]);
    setTeamOptionsLoading(true);
    api.get<FeishuEnterpriseConfig["teamOrg"][]>(`/auth/feishu/team-options?baseOrgId=${encodeURIComponent(selectedBaseId)}`)
      .then((teams) => {
        if (cancelled) return;
        setTeamOptions(teams);
      })
      .catch((err) => {
        if (cancelled) return;
        setBindError(err instanceof Error ? err.message : "加载飞书团队失败");
      })
      .finally(() => {
        if (!cancelled) setTeamOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBaseId]);

  useEffect(() => {
    if (!selectedBaseId || !selectedTeamId) {
      setConfigOptions([]);
      setConfigOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setConfigOptions([]);
    setConfigOptionsLoading(true);
    api.get<FeishuEnterpriseConfig[]>(`/auth/feishu/configs?baseOrgId=${encodeURIComponent(selectedBaseId)}&teamOrgId=${encodeURIComponent(selectedTeamId)}`)
      .then((configs) => {
        if (cancelled) return;
        setConfigOptions(configs);
      })
      .catch((err) => {
        if (cancelled) return;
        setBindError(err instanceof Error ? err.message : "加载飞书企业失败");
      })
      .finally(() => {
        if (!cancelled) setConfigOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBaseId, selectedTeamId]);

  async function submitPasswordChange() {

    setMessage("");
    setError("");
    if (!oldPassword || !newPassword) return setError("请填写旧密码和新密码");
    if (newPassword.length < 8) return setError("新密码至少 8 位");
    if (newPassword !== confirmPassword) return setError("两次输入的新密码不一致");
    setLoading(true);
    try {
      await api.post("/auth/change-password", { oldPassword, newPassword });
      setMessage("密码已修改成功");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setLoading(false);
    }
  }

  function ensureFeishuSelection() {
    if (!selectedBaseId) {
      setBindError("请先选择基地");
      return false;
    }
    if (!selectedTeamId) {
      setBindError("请先选择团队");
      return false;
    }
    if (!selectedConfigId) {
      setBindError("请先选择飞书企业");
      return false;
    }
    return true;
  }

  async function handleBindFeishu() {
    setBindError("");
    setBindMessage("");
    setBindLoading(true);

    try {
      if (!token) {
        setBindError("未登录，无法绑定");
        return;
      }
      if (!ensureFeishuSelection()) return;
      sessionStorage.setItem("feishu_bind_token", token);
      window.location.href = `/api/auth/feishu/login?action=bind&token=${encodeURIComponent(token)}&configId=${encodeURIComponent(selectedConfigId)}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "绑定失败，请重试";
      setBindError(msg);
    } finally {
      setBindLoading(false);
    }
  }

  async function handleUnbindFeishu() {
    setBindError("");
    setBindMessage("");
    if (!window.confirm("确定要解绑当前飞书账号吗？解绑后将不能使用飞书自动登录。")) return;

    setUnbindLoading(true);
    try {
      await api.delete<{ bound: boolean }>("/auth/feishu/bind");
      setFreshUser((prev) => prev ? ({
        ...prev,
        feishuConfigId: null,
        feishuName: null,
        feishuBoundAt: null,
        feishuOpenId: null,
        feishuUnionId: null,
        feishuAvatarUrl: null,
      }) : prev);
      setBindMessage("飞书账号已解绑。解绑后将不能使用飞书自动登录。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解绑失败，请重试";
      setBindError(msg);
    } finally {
      setUnbindLoading(false);
    }
  }




  return (
    <div className="space-y-6">
      <section className="feishu-panel p-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-slate-950">个人账号管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          {displayUser?.nickname}（{displayUser?.phone}）
        </p>
      </section>

      {(message || error) && (
        <div className={`rounded-[20px] border px-4 py-3 text-sm ${error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
          {error || message}
        </div>
      )}

      <section className="feishu-panel p-6">
        <h2 className="text-xl font-semibold text-slate-950">修改密码</h2>
        <div className="mt-5 grid max-w-xl gap-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">旧密码</span>
            <input className="feishu-input mt-2" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">新密码</span>
            <input className="feishu-input mt-2" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">确认新密码</span>
            <input className="feishu-input mt-2" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>
          <button className="feishu-button-primary w-full sm:w-fit" disabled={loading} onClick={submitPasswordChange}>
            {loading ? "提交中..." : "保存新密码"}
          </button>
        </div>
      </section>

      <section className="feishu-panel p-6">
        <h2 className="text-xl font-semibold text-slate-950">飞书绑定</h2>

        <div className="mt-4 rounded-[20px] border border-slate-100 bg-slate-50/80 p-4">
          <p className="text-sm font-medium text-slate-700">绑定前请选择基地、团队与飞书企业</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">基地</span>
              <select
                className="feishu-input mt-2"
                value={selectedBaseId}
                onChange={(e) => {
                  setSelectedBaseId(e.target.value);
                  setSelectedTeamId("");
                  setSelectedConfigId("");
                }}
                disabled={feishuOptionsLoading}
              >
                <option value="">请选择基地</option>
                {baseOptions.map((base) => (
                  <option key={base.id} value={base.id}>{base.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">团队</span>
              <select
                className="feishu-input mt-2"
                value={selectedTeamId}
                onChange={(e) => {
                  setSelectedTeamId(e.target.value);
                  setSelectedConfigId("");
                }}
                disabled={!selectedBaseId || feishuOptionsLoading}
              >
                <option value="">请选择团队</option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">飞书企业</span>
              <select
                className="feishu-input mt-2"
                value={selectedConfigId}
                onChange={(e) => setSelectedConfigId(e.target.value)}
                disabled={!selectedTeamId || feishuOptionsLoading}
              >
                <option value="">请选择飞书企业</option>
                {configOptions.map((config) => (
                  <option key={config.id} value={config.id}>{config.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isBound ? (
          <>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-feishu-pale text-sm font-semibold text-feishu-blue">
                {displayUser?.feishuName?.slice(0, 1) ?? "飞"}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">{displayUser?.feishuName ?? "已绑定"}</p>
                <p className="text-xs text-slate-400">
                  {boundConfig ? `${boundConfig.baseOrg.name} / ${boundConfig.teamOrg.name} / ${boundConfig.name}` : "飞书账号已绑定，可在飞书 App 内自动登录"}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">已绑定</span>
                <button
                  className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  disabled={unbindLoading}
                  onClick={handleUnbindFeishu}
                >
                  {unbindLoading ? "解绑中..." : "解绑"}
                </button>
              </div>
            </div>
            {(bindMessage || bindError) && (
              <div className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${bindError ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
                {bindError || bindMessage}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-500">
              {isInFeishuApp()
                ? "检测到飞书 App 环境，选择归属后可直接授权绑定当前飞书账号。"
                : "绑定后可在飞书 App 内自动登录，无需手动输入账号密码。"}
            </p>
            {(bindMessage || bindError) && (
              <div className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${bindError ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
                {bindError || bindMessage}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="feishu-button-secondary"
                type="button"
                disabled={bindLoading || feishuOptionsLoading}
                onClick={handleBindFeishu}
              >
                {bindLoading ? "绑定中..." : feishuOptionsLoading ? "加载飞书选项中..." : isInFeishuApp() ? "授权绑定当前飞书账号" : "绑定飞书"}

              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
