import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../services/http";
import { useAuthStore } from "../../stores/authStore";
import { useIdentityStore } from "../../stores/identityStore";
import type { FeishuEnterpriseConfig, Identity, RoleCode, User } from "../../types";
import { isInFeishuApp } from "../../shared/utils/feishu";

const ROLE_LEVEL: Record<RoleCode, number> = {
  DEV_ADMIN: 1,
  HQ_ADMIN: 2,
  BASE_ADMIN: 3,
  TEAM_ADMIN: 4,
  HALL_MANAGER: 5,
  ANCHOR: 6,
};

function pickBestIdentity(identities: Identity[]): Identity | null {
  if (!identities.length) return null;
  return [...identities].sort((a, b) => {
    // 1. 等级高的优先
    const lvDiff = (ROLE_LEVEL[a.roleCode] ?? 99) - (ROLE_LEVEL[b.roleCode] ?? 99);
    if (lvDiff !== 0) return lvDiff;
    // 2. 最近切换的优先（null 排后面）
    const aSwitch = a.lastSwitchedAt ? new Date(a.lastSwitchedAt).getTime() : 0;
    const bSwitch = b.lastSwitchedAt ? new Date(b.lastSwitchedAt).getTime() : 0;
    if (bSwitch !== aSwitch) return bSwitch - aSwitch;
    // 3. 最早授权的优先
    const aGrant = a.grantedAt ? new Date(a.grantedAt).getTime() : 0;
    const bGrant = b.grantedAt ? new Date(b.grantedAt).getTime() : 0;
    if (aGrant !== bGrant) return aGrant - bGrant;
    // 4. id 兜底
    return a.id.localeCompare(b.id);
  })[0];
}

export function LoginPage() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feishuLoading, setFeishuLoading] = useState(false);
  const [baseOptions, setBaseOptions] = useState<FeishuEnterpriseConfig["baseOrg"][]>([]);
  const [teamOptions, setTeamOptions] = useState<FeishuEnterpriseConfig["teamOrg"][]>([]);
  const [configOptions, setConfigOptions] = useState<FeishuEnterpriseConfig[]>([]);
  const [baseOptionsLoading, setBaseOptionsLoading] = useState(true);
  const [teamOptionsLoading, setTeamOptionsLoading] = useState(false);
  const [configOptionsLoading, setConfigOptionsLoading] = useState(false);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [loginTab, setLoginTab] = useState<"account" | "feishu">("account");
  const setAuth = useAuthStore((state) => state.setAuth);
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const navigate = useNavigate();

  const inFeishu = isInFeishuApp();
  // 飞书环境下，若 localStorage 有上次登录的 appId，则支持一键重登
  const savedAppId = localStorage.getItem("feishu_entry_app_id") ?? "";
  const canOneClick = inFeishu && !!savedAppId;
  // 有一键登录时默认折叠手动选择区；非飞书或无 appId 时默认展开
  const [orgSelectorOpen, setOrgSelectorOpen] = useState(!canOneClick);
  const feishuOptionsLoading = baseOptionsLoading || teamOptionsLoading || configOptionsLoading;

  useEffect(() => {
    if (inFeishu) {
      setLoginTab("feishu");
    }
  }, [inFeishu]);

  /** 一键飞书重登：跳回 feishu-entry 重走免登流程 */
  function handleOneClickFeishu() {
    window.location.href = `/feishu-entry?appId=${encodeURIComponent(savedAppId)}`;
  }

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
        setError(err instanceof Error ? err.message : "加载飞书基地失败");
      })
      .finally(() => {
        if (!cancelled) setBaseOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        setError(err instanceof Error ? err.message : "加载飞书团队失败");
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
        setError(err instanceof Error ? err.message : "加载飞书企业失败");
      })
      .finally(() => {
        if (!cancelled) setConfigOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBaseId, selectedTeamId]);

  function ensureFeishuSelection() {
    if (!selectedBaseId) {
      setError("请先选择基地");
      return false;
    }
    if (!selectedTeamId) {
      setError("请先选择团队");
      return false;
    }
    if (!selectedConfigId) {
      setError("请先选择飞书企业");
      return false;
    }
    return true;
  }

  function handleFeishuLogin() {
    setError("");
    if (!ensureFeishuSelection()) return;
    setFeishuLoading(true);
    window.location.href = `/api/auth/feishu/login?action=login&configId=${encodeURIComponent(selectedConfigId)}`;
  }

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const data = await api.post<{ token: string; user: User; identities: Identity[] }>("/auth/login", { phone, password });
      setAuth(data);
      const best = pickBestIdentity(data.identities);
      if (best) {
        setIdentity(best);
        navigate("/dashboard");
      } else {
        navigate("/identity");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col lg:flex-row">
        <section className="hidden flex-1 flex-col justify-between px-12 py-12 lg:flex xl:px-16">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-feishu-blue to-[#7B9DFF] text-[26px] font-semibold text-white shadow-[0_16px_36px_rgba(76,114,255,0.28)]">
              千
            </div>
            <div className="leading-snug">
              <p className="text-[22px] font-semibold tracking-[-0.02em] text-slate-950">千广传媒 · 成长协同平台</p>
              <p className="mt-0.5 text-sm text-slate-500">组织、账号、主播与任务协同工作台</p>
            </div>
          </div>

          <div className="max-w-2xl space-y-6">
            <div className="space-y-4">
              <h1 className="max-w-2xl text-[48px] font-semibold leading-[1.08] tracking-[-0.04em] text-slate-950">
                让每一项任务，都有清晰进度、可靠回收、持续成长。
              </h1>
              <p className="max-w-xl text-[17px] leading-8 text-slate-600">
                连接凡星，共赴闪耀。用更清晰的协同方式，支持每一次价值成长。
              </p>
            </div>
            <div className="grid max-w-xl grid-cols-3 gap-4 text-sm text-slate-600">
              <div className="feishu-card px-5 py-5">全维度共成长</div>
              <div className="feishu-card px-5 py-5">多进度可视化</div>
              <div className="feishu-card px-5 py-5">团队同步进化</div>
            </div>
          </div>

          <div className="text-sm text-slate-500">记录每一次进步，为路途留灯影，为未来留光影</div>
        </section>

        <section className="flex flex-1 items-center justify-center px-6 py-10 lg:px-8">
          <div className="feishu-panel w-full max-w-[460px] p-8">
            <div className="mb-8 space-y-2">
              <h2 className="text-[30px] font-semibold tracking-[-0.03em] text-slate-950">欢迎回来</h2>
              <p className="text-sm leading-6 text-slate-500">
                {loginTab === "feishu"
                  ? (canOneClick
                    ? "检测到您的飞书账号，可一键登录；或展开手动选择组织。"
                    : inFeishu
                      ? "请先选择基地、团队和飞书企业，再手动发起飞书登录。"
                      : "如需使用飞书登录，请先选择基地、团队和飞书企业账号后手动发起。")
                  : "适合管理员或已分配系统账号的成员直接进入系统。"}
              </p>
            </div>

            <div className="mb-6 rounded-[18px] bg-slate-100/80 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  className={`rounded-[14px] px-4 py-3 text-sm font-medium transition ${loginTab === "account" ? "bg-white text-slate-950 shadow-[0_10px_24px_rgba(15,23,42,0.08)]" : "text-slate-500 hover:text-slate-700"}`}
                  onClick={() => setLoginTab("account")}
                >
                  账号密码登录
                </button>
                <button
                  type="button"
                  className={`rounded-[14px] px-4 py-3 text-sm font-medium transition ${loginTab === "feishu" ? "bg-white text-slate-950 shadow-[0_10px_24px_rgba(15,23,42,0.08)]" : "text-slate-500 hover:text-slate-700"}`}
                  onClick={() => setLoginTab("feishu")}
                >
                  飞书登录
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {loginTab === "account" ? (
                <>
                  <form
                    onSubmit={(e) => { e.preventDefault(); submit(); }}
                    autoComplete="on"
                  >
                    <div className="space-y-4">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-500">手机号</span>
                        <input
                          className="feishu-input mt-2"
                          name="tel"
                          autoComplete="username"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="请输入手机号"
                        />
                      </label>

                      <label className="block">
                        <span className="text-xs font-medium text-slate-500">密码</span>
                        <input
                          className="feishu-input mt-2"
                          type="password"
                          name="password"
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="请输入密码"
                        />
                      </label>

                      <button type="submit" className="feishu-button-primary w-full" disabled={loading}>
                        {loading ? "登录中..." : "账号密码登录"}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  {/* 一键飞书登录：仅在飞书环境且有保存 appId 时显示 */}
                  {canOneClick && (
                    <button
                      className="feishu-button-primary w-full"
                      type="button"
                      onClick={handleOneClickFeishu}
                    >
                      一键飞书登录
                    </button>
                  )}

                  {/* 折叠/展开手动选择区 */}
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-[14px] px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100/70 hover:text-slate-700"
                    onClick={() => setOrgSelectorOpen((v) => !v)}
                  >
                    <span className={canOneClick ? "text-base font-semibold text-slate-700" : ""}>{canOneClick ? "一键登录失败请点击此处" : "选择组织归属"}</span>
                    <svg
                      className={`h-4 w-4 transition-transform duration-200 ${orgSelectorOpen ? "rotate-180" : ""}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                    </svg>
                  </button>

                  {orgSelectorOpen && (
                    <>
                      <div className="rounded-[20px] border border-slate-100 bg-slate-50/80 p-4">
                        <p className="text-sm font-medium text-slate-700">飞书登录前请选择组织归属</p>
                        <div className="mt-4 space-y-3">
                          <label className="block">
                            <span className="text-xs font-medium text-slate-500">基地</span>
                            <select
                              className="feishu-input mt-2"
                              value={selectedBaseId}
                              onChange={(e) => {
                                setError("");
                                setSelectedBaseId(e.target.value);
                                setSelectedTeamId("");
                                setSelectedConfigId("");
                              }}
                              disabled={baseOptionsLoading}
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
                                setError("");
                                setSelectedTeamId(e.target.value);
                                setSelectedConfigId("");
                              }}
                              disabled={!selectedBaseId || teamOptionsLoading}
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
                              onChange={(e) => {
                                setError("");
                                setSelectedConfigId(e.target.value);
                              }}
                              disabled={!selectedTeamId || configOptionsLoading}
                            >
                              <option value="">请选择飞书企业</option>
                              {configOptions.map((config) => (
                                <option key={config.id} value={config.id}>{config.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>

                      <button
                        className="feishu-button-primary w-full"
                        type="button"
                        disabled={feishuLoading || feishuOptionsLoading}
                        onClick={handleFeishuLogin}
                      >
                        {feishuLoading ? "飞书登录中..." : feishuOptionsLoading ? "加载飞书选项中..." : "使用飞书登录"}
                      </button>

                      <p className="text-xs leading-5 text-slate-400">
                        当前页面不会自动发起飞书登录，只有在你完成选择并点击按钮后才会跳转授权。
                      </p>
                    </>
                  )}
                </>
              )}

              {error && (
                <div className="rounded-[18px] border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-600 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-sm">
                <span className="text-slate-400">还没有账号？</span>
                <Link className="font-medium text-feishu-blue transition hover:text-feishu-blue-strong" to="/anchor-register">
                  主播注册申请
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
