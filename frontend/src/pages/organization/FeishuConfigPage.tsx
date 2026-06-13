import { useEffect, useState } from "react";
import { api } from "../../services/http";
import type { FeishuEnterpriseConfig, OrgUnit } from "../../types";

type FeishuConfigForm = {
  name: string;
  appId: string;
  appSecret: string;
  baseOrgId: string;
  teamOrgId: string;
};

type FeishuConfigStatusFilter = "all" | "active" | "paused";
type FeishuSubmitMode = "create" | "edit";

const emptyForm: FeishuConfigForm = {
  name: "",
  appId: "",
  appSecret: "",
  baseOrgId: "",
  teamOrgId: "",
};

const UNIFIED_REDIRECT_URI = `${window.location.origin}/pc/auth/callback`;

export function FeishuConfigPage() {
  const [configs, setConfigs] = useState<FeishuEnterpriseConfig[]>([]);
  const [baseOptions, setBaseOptions] = useState<OrgUnit[]>([]);
  const [listTeamOptions, setListTeamOptions] = useState<OrgUnit[]>([]);
  const [formTeamOptions, setFormTeamOptions] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [baseOptionsLoading, setBaseOptionsLoading] = useState(true);
  const [listTeamOptionsLoading, setListTeamOptionsLoading] = useState(false);
  const [formTeamOptionsLoading, setFormTeamOptionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FeishuConfigForm>(emptyForm);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<FeishuConfigStatusFilter>("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  async function loadBaseOptions() {
    setBaseOptionsLoading(true);
    try {
      const bases = await api.get<OrgUnit[]>("/org/feishu-base-options");
      setBaseOptions(bases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载基地失败");
    } finally {
      setBaseOptionsLoading(false);
    }
  }

  async function loadConfigs(baseOrgId = selectedBaseId, teamOrgId = selectedTeamId, status = selectedStatus) {
    if (!baseOrgId) {
      setConfigs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("baseOrgId", baseOrgId);
      if (teamOrgId) params.set("teamOrgId", teamOrgId);
      if (status !== "all") params.set("status", status);
      const configList = await api.get<FeishuEnterpriseConfig[]>(`/org/feishu-configs?${params.toString()}`);
      setConfigs(configList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载飞书企业配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBaseOptions();
  }, []);

  useEffect(() => {
    if (baseOptions.length === 1 && !selectedBaseId) {
      setSelectedBaseId(baseOptions[0].id);
    }
    if (baseOptions.length === 1 && !form.baseOrgId) {
      setForm((prev) => ({ ...prev, baseOrgId: baseOptions[0].id }));
    }
  }, [baseOptions, selectedBaseId, form.baseOrgId]);

  useEffect(() => {
    if (!selectedBaseId) {
      setListTeamOptions([]);
      setConfigs([]);
      setListTeamOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setListTeamOptions([]);
    setListTeamOptionsLoading(true);
    api.get<OrgUnit[]>(`/org/feishu-team-options?baseOrgId=${encodeURIComponent(selectedBaseId)}`)
      .then((teams) => {
        if (cancelled) return;
        setListTeamOptions(teams);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载团队失败");
      })
      .finally(() => {
        if (!cancelled) setListTeamOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBaseId]);

  useEffect(() => {
    if (!form.baseOrgId) {
      setFormTeamOptions([]);
      setFormTeamOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setFormTeamOptions([]);
    setFormTeamOptionsLoading(true);
    api.get<OrgUnit[]>(`/org/feishu-team-options?baseOrgId=${encodeURIComponent(form.baseOrgId)}`)
      .then((teams) => {
        if (cancelled) return;
        setFormTeamOptions(teams);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载团队失败");
      })
      .finally(() => {
        if (!cancelled) setFormTeamOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.baseOrgId]);

  useEffect(() => {
    void loadConfigs();
  }, [selectedBaseId, selectedTeamId, selectedStatus]);

  function resetForm() {
    setEditingId(null);
    setSubmitConfirmOpen(false);
    setForm({
      ...emptyForm,
      baseOrgId: baseOptions.length === 1 ? baseOptions[0].id : "",
    });
  }

  function startEdit(item: FeishuEnterpriseConfig) {
    setEditingId(item.id);
    setSubmitConfirmOpen(false);
    setForm({
      name: item.name,
      appId: item.appId,
      appSecret: "",
      baseOrgId: item.baseOrgId,
      teamOrgId: item.teamOrgId,
    });
    setMessage("");
    setError("");
  }

  function getValidatedForm() {
    setMessage("");
    setError("");

    const nextForm: FeishuConfigForm = {
      name: form.name.trim(),
      appId: form.appId.trim(),
      appSecret: form.appSecret.trim(),
      baseOrgId: form.baseOrgId,
      teamOrgId: form.teamOrgId,
    };

    if (!nextForm.name) {
      setError("请填写飞书企业名称");
      return null;
    }
    if (!nextForm.appId) {
      setError("请填写 App ID");
      return null;
    }
    if (!editingId && !nextForm.appSecret) {
      setError("新增时必须填写 App Secret");
      return null;
    }
    if (!nextForm.baseOrgId) {
      setError("请选择基地");
      return null;
    }
    if (!nextForm.teamOrgId) {
      setError("请选择团队");
      return null;
    }

    return nextForm;
  }

  function handleSubmit() {
    const nextForm = getValidatedForm();
    if (!nextForm) return;
    setForm(nextForm);
    setSubmitConfirmOpen(true);
  }

  async function confirmSubmit() {
    const nextForm = getValidatedForm();
    if (!nextForm) return;

    const nextBaseId = nextForm.baseOrgId;
    const nextTeamId = nextForm.teamOrgId;

    setSaving(true);
    try {
      if (editingId) {
        await api.patch(`/org/feishu-configs/${editingId}`, {
          ...nextForm,
          appSecret: nextForm.appSecret || undefined,
        });
        setMessage("飞书企业配置已更新");
      } else {
        await api.post("/org/feishu-configs", nextForm);
        setMessage("飞书企业配置已创建");
      }
      resetForm();
      setSelectedBaseId(nextBaseId);
      setSelectedTeamId(nextTeamId);
      setSelectedStatus("all");
      await loadConfigs(nextBaseId, nextTeamId, "all");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
      setSubmitConfirmOpen(false);
    }
  }

  async function toggleStatus(item: FeishuEnterpriseConfig) {
    setMessage("");
    setError("");
    try {
      await api.patch(`/org/feishu-configs/${item.id}/status`, {
        status: item.status === "active" ? "paused" : "active",
      });
      setMessage(item.status === "active" ? "配置已停用" : "配置已启用");
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "状态更新失败");
    }
  }

  const submitMode: FeishuSubmitMode = editingId ? "edit" : "create";
  const confirmBaseName = baseOptions.find((base) => base.id === form.baseOrgId)?.name ?? "未选择基地";
  const confirmTeamName = formTeamOptions.find((team) => team.id === form.teamOrgId)?.name
    ?? configs.find((item) => item.id === editingId)?.teamOrg.name
    ?? "未选择团队";
  const confirmName = form.name.trim() || "-";
  const confirmAppId = form.appId.trim() || "-";
  const secretHint = submitMode === "edit"
    ? form.appSecret.trim()
      ? "本次会同步更新 App Secret。"
      : "未填写 App Secret，本次会保留原有密钥。"
    : "确认后会新增一套新的 App Secret 配置。";
  const confirmDescription = `请确认以下信息无误后再${submitMode === "edit" ? "保存" : "新增"}，避免误触：\n企业名称：${confirmName}\n基地：${confirmBaseName}\n团队：${confirmTeamName}\nApp ID：${confirmAppId}\n${secretHint}`;

  return (
    <div className="space-y-6">
      <section className="feishu-panel p-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-slate-950">飞书企业配置</h1>
        <p className="mt-1 text-sm text-slate-500">维护基地 / 团队下的飞书企业 App ID 与 App Secret。配置列表已改为按基地、团队、状态分级筛选加载，避免一次拉全量数据。</p>
      </section>

      {(message || error) && (
        <div className={`rounded-[20px] border px-4 py-3 text-sm ${error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
          {error || message}
        </div>
      )}

      <section className="feishu-panel p-6">
        <div className="rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          统一回调地址：<span className="font-medium">{UNIFIED_REDIRECT_URI}</span>
          <div className="mt-1 text-xs text-blue-600">请确保所有飞书开放平台应用的“重定向 URL”白名单都已配置为该地址，服务端环境变量 `FEISHU_REDIRECT_URI` 也应保持一致。</div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">飞书企业名称</span>
            <input className="feishu-input mt-2" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">基地</span>
            <select
              className="feishu-input mt-2"
              value={form.baseOrgId}
              onChange={(e) => setForm((prev) => ({ ...prev, baseOrgId: e.target.value, teamOrgId: "" }))}
              disabled={baseOptionsLoading}
            >
              <option value="">请选择基地</option>
              {baseOptions.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">团队</span>
            <select
              className="feishu-input mt-2"
              value={form.teamOrgId}
              onChange={(e) => setForm((prev) => ({ ...prev, teamOrgId: e.target.value }))}
              disabled={!form.baseOrgId || formTeamOptionsLoading}
            >
              <option value="">请选择团队</option>
              {formTeamOptions.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">App ID</span>
            <input className="feishu-input mt-2" value={form.appId} onChange={(e) => setForm((prev) => ({ ...prev, appId: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">App Secret {editingId ? "（留空则不修改）" : ""}</span>
            <input className="feishu-input mt-2" value={form.appSecret} onChange={(e) => setForm((prev) => ({ ...prev, appSecret: e.target.value }))} />
          </label>
        </div>
        <div className="mt-4 flex gap-3">
          <button className="feishu-button-primary" disabled={saving} onClick={handleSubmit}>{saving ? "保存中..." : editingId ? "保存修改" : "新增配置"}</button>
          {editingId && <button className="feishu-button-secondary" onClick={resetForm}>取消编辑</button>}
        </div>
      </section>

      <section className="feishu-panel p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">配置列表</h2>
            <p className="mt-1 text-sm text-slate-500">先选基地，再按团队或状态缩小范围，避免无差别全量拉取配置。</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3 lg:min-w-[720px]">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">基地筛选</span>
              <select
                className="feishu-input mt-2"
                value={selectedBaseId}
                onChange={(e) => {
                  setSelectedBaseId(e.target.value);
                  setSelectedTeamId("");
                  setMessage("");
                  setError("");
                }}
                disabled={baseOptionsLoading}
              >
                <option value="">请选择基地后加载列表</option>
                {baseOptions.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">团队筛选</span>
              <select
                className="feishu-input mt-2"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                disabled={!selectedBaseId || listTeamOptionsLoading}
              >
                <option value="">全部团队</option>
                {listTeamOptions.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">状态筛选</span>
              <select className="feishu-input mt-2" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value as FeishuConfigStatusFilter)}>
                <option value="all">全部状态</option>
                <option value="active">仅启用</option>
                <option value="paused">仅停用</option>
              </select>
            </label>
          </div>
        </div>

        {!selectedBaseId ? (
          <p className="mt-4 text-sm text-slate-500">请先选择基地后再加载配置列表。</p>
        ) : loading ? (
          <p className="mt-4 text-sm text-slate-500">加载中...</p>
        ) : configs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">当前筛选条件下暂无飞书企业配置。</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-3 py-3 font-medium">名称</th>
                  <th className="px-3 py-3 font-medium">基地</th>
                  <th className="px-3 py-3 font-medium">团队</th>
                  <th className="px-3 py-3 font-medium">App ID</th>
                  <th className="px-3 py-3 font-medium">统一回调地址</th>
                  <th className="px-3 py-3 font-medium">状态</th>
                  <th className="px-3 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50 text-slate-700">
                    <td className="px-3 py-3">{item.name}</td>
                    <td className="px-3 py-3">{item.baseOrg.name}</td>
                    <td className="px-3 py-3">{item.teamOrg.name}</td>
                    <td className="px-3 py-3">{item.appId}</td>
                    <td className="max-w-[280px] truncate px-3 py-3" title={UNIFIED_REDIRECT_URI}>{UNIFIED_REDIRECT_URI}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${item.status === "active" ? "border border-emerald-100 bg-emerald-50 text-emerald-600" : "border border-amber-100 bg-amber-50 text-amber-600"}`}>
                        {item.status === "active" ? "启用" : "停用"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50" onClick={() => startEdit(item)}>编辑</button>
                        <button className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50" onClick={() => toggleStatus(item)}>
                          {item.status === "active" ? "停用" : "启用"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {submitConfirmOpen && (
        <ConfirmModal
          title={submitMode === "edit" ? "确认保存飞书企业配置？" : "确认新增飞书企业配置？"}
          description={confirmDescription}
          confirmLabel={saving ? (submitMode === "edit" ? "保存中..." : "创建中...") : (submitMode === "edit" ? "确认保存" : "确认新增")}
          onCancel={() => {
            if (!saving) setSubmitConfirmOpen(false);
          }}
          onConfirm={() => void confirmSubmit()}
          disabled={saving}
        />
      )}
    </div>
  );
}

function ConfirmModal({ title, description, confirmLabel, onCancel, onConfirm, disabled }: { title: string; description: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void; disabled?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[4px]"
      onClick={() => {
        if (!disabled) onCancel();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.16)]" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-100 px-6 py-5">
          <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">{title}</h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <div className="flex justify-end gap-2 bg-slate-50/60 px-6 py-4">
          <button className="feishu-button-secondary h-10 px-4" onClick={onCancel} disabled={disabled}>取消</button>
          <button className="feishu-button-primary h-10 px-4" onClick={onConfirm} disabled={disabled}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
