import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, CheckCircle2, ShieldAlert } from "lucide-react";
import { api } from "../../services/http";
import { fetchOrgTree } from "../../services/organization";
import type { OrgUnit } from "../../types";

type TransferPreview = {
  revision: string;
  source: { hall: { id: string; name: string; orgCode: string }; team: { id: string; name: string } | null; base: { id: string; name: string } | null };
  target: { team: { id: string; name: string }; base: { id: string; name: string } | null };
  affected: { anchorCount: number; identityCount: number; taskRecordCount: number; hallTaskRecordCount: number; pendingLeaveCount: number; registrationCount: number };
  hallDaily: {
    detachedAssignments: Array<{ id: string; title: string; status: string }>;
    attachedAssignments: Array<{ id: string; title: string; status: string; alreadyAttached: boolean }>;
  };
  warnings: string[];
  blockers: string[];
  canExecute: boolean;
};

export function OrganizationDataTransferPage() {
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [sourceBaseOrgId, setSourceBaseOrgId] = useState("");
  const [sourceTeamOrgId, setSourceTeamOrgId] = useState("");
  const [hallOrgId, setHallOrgId] = useState("");
  const [targetBaseOrgId, setTargetBaseOrgId] = useState("");
  const [targetTeamOrgId, setTargetTeamOrgId] = useState("");
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchOrgTree().then(setOrgs).catch((err) => setError(err instanceof Error ? err.message : "组织数据加载失败"));
  }, []);

  const hall = useMemo(() => orgs.find((item) => item.id === hallOrgId), [orgs, hallOrgId]);
  const bases = useMemo(() => orgs.filter((item) => item.orgType === "BASE" && item.status === "active").sort((a, b) => a.name.localeCompare(b.name)), [orgs]);
  const sourceTeams = useMemo(() => orgs.filter((item) => item.orgType === "TEAM" && item.status === "active" && item.parentId === sourceBaseOrgId).sort((a, b) => a.name.localeCompare(b.name)), [orgs, sourceBaseOrgId]);
  const sourceHalls = useMemo(() => orgs.filter((item) => item.orgType === "HALL" && item.status === "active" && item.parentId === sourceTeamOrgId).sort((a, b) => a.name.localeCompare(b.name)), [orgs, sourceTeamOrgId]);
  const targetTeams = useMemo(() => orgs.filter((item) => item.orgType === "TEAM" && item.status === "active" && item.parentId === targetBaseOrgId && item.id !== hall?.parentId).sort((a, b) => a.name.localeCompare(b.name)), [orgs, targetBaseOrgId, hall]);

  function resetPreview() {
    setPreview(null);
    setConfirmationText("");
    setMessage("");
    setError("");
  }

  async function loadPreview() {
    if (!hallOrgId || !targetTeamOrgId) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await api.post<TransferPreview>("/organization-data-transfer/preview", { hallOrgId, targetTeamOrgId });
      setPreview(result);
      setConfirmationText("");
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "转移预检失败");
    } finally {
      setLoading(false);
    }
  }

  async function executeTransfer() {
    if (!preview || !preview.canExecute || confirmationText !== preview.source.hall.name) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await api.post("/organization-data-transfer/execute", {
        hallOrgId,
        targetTeamOrgId,
        expectedRevision: preview.revision,
        confirmationText,
      });
      setMessage(`“${preview.source.hall.name}”的数据已全部转移至“${preview.target.team.name}”`);
      setPreview(null);
      setConfirmationText("");
      setSourceBaseOrgId("");
      setSourceTeamOrgId("");
      setHallOrgId("");
      setTargetBaseOrgId("");
      setTargetTeamOrgId("");
      setOrgs(await fetchOrgTree());
    } catch (err) {
      setError(err instanceof Error ? err.message : "组织数据转移失败");
    } finally {
      setLoading(false);
    }
  }

  const affectedRows = preview ? [
    ["主播档案", preview.affected.anchorCount],
    ["组织身份", preview.affected.identityCount],
    ["主播任务记录", preview.affected.taskRecordCount],
    ["厅管日常记录", preview.affected.hallTaskRecordCount],
    ["待审批请假", preview.affected.pendingLeaveCount],
    ["注册申请", preview.affected.registrationCount],
  ] as const : [];

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-feishu-blue"><ArrowRightLeft size={22} /></span>
          <div>
            <h1 className="text-[24px] font-semibold text-slate-950">组织数据转移</h1>
            <p className="mt-1 text-sm text-slate-500">将一个厅及其全部历史和未来数据转入其他团队。原团队转移后立即失去管理和查看权限。</p>
          </div>
        </div>
      </section>

      {(message || error) && <div className={`rounded-[20px] border px-4 py-3 text-sm ${error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <h2 className="text-lg font-semibold text-slate-950">第一步：选择转移对象</h2>
        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
          <div className="rounded-[22px] border border-blue-100 bg-blue-50/40 p-5">
            <p className="font-medium text-slate-900">来源组织</p>
            <p className="mt-1 text-xs text-slate-500">按基地 → 团队 → 厅逐级选择</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <label className="block text-xs font-medium text-slate-600">
                1. 来源基地
                <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-feishu-blue" value={sourceBaseOrgId} onChange={(event) => { setSourceBaseOrgId(event.target.value); setSourceTeamOrgId(""); setHallOrgId(""); setTargetBaseOrgId(""); setTargetTeamOrgId(""); resetPreview(); }}>
                  <option value="">请选择基地</option>
                  {bases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                2. 来源团队
                <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-feishu-blue disabled:bg-slate-100" value={sourceTeamOrgId} disabled={!sourceBaseOrgId} onChange={(event) => { setSourceTeamOrgId(event.target.value); setHallOrgId(""); setTargetBaseOrgId(""); setTargetTeamOrgId(""); resetPreview(); }}>
                  <option value="">请选择团队</option>
                  {sourceTeams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                3. 待转移厅
                <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-feishu-blue disabled:bg-slate-100" value={hallOrgId} disabled={!sourceTeamOrgId} onChange={(event) => { const nextHallOrgId = event.target.value; setHallOrgId(nextHallOrgId); setTargetBaseOrgId(nextHallOrgId ? sourceBaseOrgId : ""); setTargetTeamOrgId(""); resetPreview(); }}>
                  <option value="">请选择厅</option>
                  {sourceHalls.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.orgCode}）</option>)}
                </select>
              </label>
            </div>
          </div>

          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm"><ArrowRightLeft size={20} /></span>

          <div className="rounded-[22px] border border-emerald-100 bg-emerald-50/40 p-5">
            <p className="font-medium text-slate-900">目标组织</p>
            <p className="mt-1 text-xs text-slate-500">按基地 → 团队逐级选择接收方</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <label className="block text-xs font-medium text-slate-600">
                1. 目标基地
                <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-feishu-blue disabled:bg-slate-100" value={targetBaseOrgId} disabled={!hallOrgId} onChange={(event) => { setTargetBaseOrgId(event.target.value); setTargetTeamOrgId(""); resetPreview(); }}>
                  <option value="">请选择基地</option>
                  {bases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                2. 目标团队
                <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-feishu-blue disabled:bg-slate-100" value={targetTeamOrgId} disabled={!targetBaseOrgId || !hallOrgId} onChange={(event) => { setTargetTeamOrgId(event.target.value); resetPreview(); }}>
                  <option value="">请选择目标团队</option>
                  {targetTeams.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.orgCode}）</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button className="feishu-button-primary h-11 px-6" disabled={loading || !hallOrgId || !targetTeamOrgId} onClick={loadPreview}>{loading ? "正在预检..." : "预检转移影响"}</button>
        </div>
      </section>

      {preview && (
        <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
          <h2 className="text-lg font-semibold text-slate-950">第二步：确认影响范围</h2>
          <div className="mt-4 rounded-2xl bg-slate-50 px-5 py-4 text-sm text-slate-700">
            {preview.source.base?.name} / {preview.source.team?.name} / <b>{preview.source.hall.name}</b>
            <span className="mx-3 text-slate-400">→</span>
            {preview.target.base?.name} / <b>{preview.target.team.name}</b>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {affectedRows.map(([label, count]) => <div key={label} className="rounded-2xl border border-slate-100 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-950">{count}</p></div>)}
          </div>

          <div className="mt-5 space-y-2">
            {preview.warnings.map((warning) => <p key={warning} className="flex gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800"><ShieldAlert className="mt-0.5 shrink-0" size={17} />{warning}</p>)}
            {preview.blockers.map((blocker) => <p key={blocker} className="flex gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><ShieldAlert className="mt-0.5 shrink-0" size={17} />{blocker}</p>)}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 p-4"><p className="font-medium text-slate-800">停止原团队后续投放</p><p className="mt-1 text-sm text-slate-500">{preview.hallDaily.detachedAssignments.length ? preview.hallDaily.detachedAssignments.map((item) => item.title).join("、") : "当前无关联的生效任务"}</p></div>
            <div className="rounded-2xl border border-slate-100 p-4"><p className="font-medium text-slate-800">接入目标团队任务</p><p className="mt-1 text-sm text-slate-500">{preview.hallDaily.attachedAssignments.length ? preview.hallDaily.attachedAssignments.map((item) => item.title).join("、") : "目标团队当前无可接入任务"}</p></div>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-5">
            <label className="block text-sm font-medium text-slate-700">请输入厅名称 <b>{preview.source.hall.name}</b> 确认不可逆的数据归属变化</label>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input className="h-11 flex-1 rounded-2xl border border-slate-200 px-4 outline-none focus:border-feishu-blue" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder="输入完整厅名称" />
              <button className="h-11 rounded-2xl bg-red-600 px-6 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={loading || !preview.canExecute || confirmationText !== preview.source.hall.name} onClick={executeTransfer}>{loading ? "正在转移..." : "确认转移全部数据"}</button>
            </div>
            {preview.canExecute && <p className="mt-3 flex items-center gap-2 text-xs text-emerald-600"><CheckCircle2 size={15} />预检通过；执行过程使用数据库事务，失败将整体回滚。</p>}
          </div>
        </section>
      )}
    </div>
  );
}
