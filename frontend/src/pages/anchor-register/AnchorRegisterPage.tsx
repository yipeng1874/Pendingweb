import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../services/http";
import type { OrgUnit } from "../../types";

function maskDouyinNo(value?: string) {
  const text = value?.trim() ?? "";
  if (!text) return "未登记";
  if (text.length <= 4) return `${text.slice(0, 1)}**${text.slice(-1)}`;
  return `${text.slice(0, 2)}**${text.slice(-2)}`;
}

export function AnchorRegisterPage() {
  const [bases, setBases] = useState<OrgUnit[]>([]);
  const [teams, setTeams] = useState<OrgUnit[]>([]);
  const [halls, setHalls] = useState<OrgUnit[]>([]);
  const [baseId, setBaseId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [form, setForm] = useState({ nickname: "", phone: "", password: "", targetHallOrgId: "", douyinNo: "", douyinUid: "" });
  const [phoneError, setPhoneError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function handlePhoneChange(phone: string) {
    setForm((current) => ({ ...current, phone }));
    if (phone && !/^\d{11}$/.test(phone)) {
      setPhoneError("请输入11位手机号");
    } else {
      setPhoneError("");
    }
  }

  useEffect(() => {
    api.get<OrgUnit[]>("/anchors/register/orgs?orgType=BASE").then(setBases).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setTeams([]);
    setHalls([]);
    setTeamId("");
    setForm((current) => ({ ...current, targetHallOrgId: "" }));
    if (!baseId) return;
    api.get<OrgUnit[]>(`/anchors/register/orgs?orgType=TEAM&parentId=${baseId}`).then(setTeams).catch((err) => setError(err.message));
  }, [baseId]);

  useEffect(() => {
    setHalls([]);
    setForm((current) => ({ ...current, targetHallOrgId: "" }));
    if (!teamId) return;
    api.get<OrgUnit[]>(`/anchors/register/orgs?orgType=HALL&parentId=${teamId}&includeVirtual=true`).then(setHalls).catch((err) => setError(err.message));
  }, [teamId]);

  async function submit() {
    setMessage("");
    setError("");
    try {
      await api.post("/anchors/register", form);
      setMessage("账号注册申请已提交，请等待上级审核。审核通过后即可使用账号；如需管理权限，将由上级在组织账号管理中开通。");
      setBaseId("");
      setTeamId("");
      setTeams([]);
      setHalls([]);
      setPhoneError("");
      setForm({ nickname: "", phone: "", password: "", targetHallOrgId: "", douyinNo: "", douyinUid: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#EDF3FF_0%,#F7FAFF_45%,#F4F7FB_100%)] px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[1280px] items-center justify-center">
        <div className="grid w-full gap-8 rounded-[30px] border border-slate-100 bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.09)] lg:grid-cols-[1fr_1.2fr] lg:p-10">
          <section className="flex flex-col justify-between rounded-[24px] bg-[linear-gradient(180deg,#F7FAFF_0%,#FFFFFF_100%)] p-6 lg:p-8">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-feishu-blue to-[#7B9DFF] text-base font-semibold text-white shadow-[0_8px_20px_rgba(76,114,255,0.22)]">
                  千
                </div>
                <span className="text-sm font-medium text-feishu-blue">千广传媒 · 成长协同平台</span>
              </div>
              <h1 className="mt-6 break-keep text-[26px] font-semibold leading-snug tracking-[-0.02em] text-slate-900">
                申请“凡星”账号申请，进入千广协同体系
              </h1>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                请填写真实信息并按基地、团队、厅逐级选择归属。审核通过后即可使用账号，如需管理权限由上级在组织账号管理中授权。
              </p>
            </div>
            <div className="mt-8 grid gap-3 text-sm text-slate-600">
              <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">1. 填写账号信息</div>
              <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">2. 选择基地 / 团队 / 厅</div>
              <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">3. 等待上级审核</div>
            </div>
          </section>

          <section className="rounded-[24px] bg-white p-0 lg:p-2">
            <div className="rounded-[22px] bg-white p-2 lg:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[30px] font-semibold tracking-[-0.03em] text-slate-900">账号注册申请</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">请填写真实信息并完成账号申请，审核通过后即可使用账号。</p>
                </div>
                <Link className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50" to="/login">返回登录</Link>
              </div>

              {(message || error) && <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm leading-6 ${error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}

              <div className="mt-8 grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
                <Field label="昵称" value={form.nickname} required onChange={(nickname) => setForm({ ...form, nickname })} />
                <Field label="手机号" value={form.phone} required error={phoneError} onChange={handlePhoneChange} />
                <Field label="密码" type="password" value={form.password} required onChange={(password) => setForm({ ...form, password })} />
                <SelectField label="所属基地" value={baseId} required onChange={setBaseId} placeholder="请选择基地" options={bases.map((base) => ({ value: base.id, label: `${base.name}（${base.orgCode}）` }))} />
                <SelectField label="所属团队" value={teamId} required disabled={!baseId} onChange={setTeamId} placeholder={baseId ? "请选择团队" : "请先选择基地"} options={teams.map((team) => ({ value: team.id, label: `${team.name}（${team.orgCode}）` }))} />
                <SelectField label="归属厅" value={form.targetHallOrgId} required disabled={!teamId} onChange={(targetHallOrgId) => setForm({ ...form, targetHallOrgId })} placeholder={teamId ? "请选择归属厅" : "请先选择团队"} options={halls.map((hall) => ({ value: hall.id, label: hall.isVirtual ? `${hall.name}（模拟厅，仅管理归属）` : `${hall.name}（抖音号：${maskDouyinNo(hall.douyinNo)}）` }))} />
                <Field label="抖音号" value={form.douyinNo} onChange={(douyinNo) => setForm({ ...form, douyinNo })} />
                <Field label="抖音 UID" value={form.douyinUid} onChange={(douyinUid) => setForm({ ...form, douyinUid })} />
              </div>

              <button className="mt-8 h-12 w-full rounded-2xl bg-feishu-blue text-[15px] font-semibold text-white shadow-[0_12px_28px_rgba(82,126,255,0.24)] transition hover:bg-feishu-deep disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none" disabled={!form.nickname || !form.phone || !!phoneError || !/^\d{11}$/.test(form.phone) || !form.password || !form.targetHallOrgId} onClick={submit}>提交账号注册申请</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, type = "text", required, error, onChange }: { label: string; value: string; type?: string; required?: boolean; error?: string; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-slate-500">{label}{required && <span className="ml-1 text-red-500">*</span>}</span>
      <input className={`mt-2 h-12 w-full rounded-2xl border bg-slate-50 px-4 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-feishu-blue focus:bg-white ${error ? "border-red-400" : "border-slate-200"}`} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

function SelectField({ label, value, required, disabled, placeholder, options, onChange }: { label: string; value: string; required?: boolean; disabled?: boolean; placeholder: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-slate-500">{label}{required && <span className="ml-1 text-red-500">*</span>}</span>
      <select className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-[15px] text-slate-900 outline-none transition focus:border-feishu-blue focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
