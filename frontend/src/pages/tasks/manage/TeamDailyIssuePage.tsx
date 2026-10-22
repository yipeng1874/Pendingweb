import { useEffect, useRef, useState } from "react";
import type { OrgUnit } from "../../../types";
import { fetchOrgTree } from "../../../services/organization";
import { teamDailyApi, type TeamTaskAssignment, type TeamTaskTemplate } from "../../../services/teamDaily";
import { useIdentityStore } from "../../../stores/identityStore";
import { TeamDailyTaskWizard } from "./components/TeamDailyTaskWizard";
import { DailyIssueBaseWelcome } from "./components/DailyIssueBaseWelcome";
export function TeamDailyIssuePage() {
  const identity = useIdentityStore(s => s.currentIdentity);
  const permissions = useIdentityStore(s => s.permissions);
  const [orgs,setOrgs] = useState<OrgUnit[]>([]);
  const [baseId,setBaseId] = useState("");
  const [loading,setLoading] = useState(true);
  const requestVersion=useRef(0);
  const [error,setError] = useState("");
  const [data,setData] = useState<{templates:TeamTaskTemplate[]; drafts:TeamTaskTemplate[]; scheduled:TeamTaskAssignment[]; active:TeamTaskAssignment[]; ended:TeamTaskAssignment[]}>({templates:[],drafts:[],scheduled:[],active:[],ended:[]});
  const bases = orgs.filter(o => o.orgType === "BASE" && o.status === "active" && (identity?.roleCode === "DEV_ADMIN" || !!identity?.scopePath && (o.path === identity.scopePath || o.path.startsWith(identity.scopePath + "/"))));
  useEffect(() => { let active=true; requestVersion.current++; setBaseId(""); setOrgs([]); setLoading(true); fetchOrgTree().then(rows=>{if(active)setOrgs(rows);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);}); return ()=>{active=false;requestVersion.current++;}; },[identity?.id]);
  useEffect(() => { if (!baseId && bases.length === 1) setBaseId(bases[0].id); },[orgs,identity?.id,baseId]);
  async function load(showLoading = false) {
    const version=++requestVersion.current;
    if (!baseId) return;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [templates,drafts,scheduled,active,ended] = await Promise.all([
        teamDailyApi.listTemplates({baseOrgId:baseId,limit:100}),
        teamDailyApi.listTemplates({baseOrgId:baseId,status:"draft",neverPublished:true,limit:3}),
        teamDailyApi.listAssignments({baseOrgId:baseId,status:"scheduled",limit:3}),
        teamDailyApi.listAssignments({baseOrgId:baseId,status:"active",limit:3}),
        teamDailyApi.listAssignments({baseOrgId:baseId,status:"ended",limit:3})
      ]);
      if(version===requestVersion.current) setData({templates,drafts,scheduled,active,ended});
    } catch(e) { if(version===requestVersion.current) setError(e instanceof Error ? e.message : "加载失败"); } finally { if(version===requestVersion.current) setLoading(false); }
  }
  useEffect(() => { void load(true); },[baseId,identity?.id]);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
      <span className="text-sm text-slate-500 whitespace-nowrap">当前权限定位基地：</span>
      <span className="text-sm font-medium text-slate-800 flex-1">{bases.find(b=>b.id===baseId)?.name ?? <span className="text-amber-500">{bases.length ? "未选择" : "暂无可管理基地"}</span>}</span>
      {bases.length>1 && <select aria-label="选择基地" className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-blue-400" value={baseId} onChange={e=>setBaseId(e.target.value)}><option value="">请选择基地</option>{bases.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}
    </div>
    {error && <div role="alert" className="text-red-600">{error}<button onClick={()=>void load()} className="ml-3 underline">重试</button></div>}
    {loading && <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400">任务发放配置加载中...</div>}
    {!loading && !baseId && <DailyIssueBaseWelcome title="团队管理日常任务协同中心" description="选择基地发放任务，每个团队每日共同完成一份。" availableBaseOrgs={bases} onSelect={setBaseId} />}
    {!loading && baseId && <TeamDailyTaskWizard key={identity?.id + baseId} orgs={orgs} templates={data.templates} draftTemplatesPage={data.drafts} managementOrgId={baseId} managementOrgName={bases.find(b=>b.id===baseId)?.name} currentOrgId={identity?.orgId} canManageTemplates={permissions.includes("*") || permissions.includes("task:template:manage")} scheduledAssignments={data.scheduled} activeAssignments={data.active} endedAssignments={data.ended} onReload={load} onIssued={()=>void load()} loadAssignmentsByStatus={(id,status,offset=0,limit=3)=>teamDailyApi.listAssignments({baseOrgId:id,status,offset,limit})} loadDraftTemplatesPage={(id,offset=0,limit=3)=>teamDailyApi.listTemplates({baseOrgId:id,status:"draft",neverPublished:true,offset,limit})}/>} 
  </div>;
}
