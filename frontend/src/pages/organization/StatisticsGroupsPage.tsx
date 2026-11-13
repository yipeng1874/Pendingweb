import { useEffect, useState } from "react";
import { api } from "../../services/http";
import { fetchOrgTree } from "../../services/organization";
import { useIdentityStore } from "../../stores/identityStore";
import type { OrgUnit } from "../../types";

type Group = { id: string; name: string; enabled: boolean; teamIds: string[] };
type Config = { groups: Group[]; revision: number };
const field = "rounded-xl border border-slate-200 px-3 py-2 bg-white";
// FRP may use HTTP, where crypto.randomUUID is unavailable.
function groupId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function StatisticsGroupsPage() {
  const identityId = useIdentityStore((s) => s.currentIdentity?.id);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [baseId, setBaseId] = useState("");
  const [config, setConfig] = useState<Config>({ groups: [], revision: 0 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setBaseId(""); setOrgs([]); setReady(false); setDirty(false);
    fetchOrgTree().then((items) => {
      if (cancelled) return;
      setOrgs(items);
      setBaseId(items.find((org) => org.orgType === "BASE" && org.status === "active")?.id ?? "");
    }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [identityId]);
  useEffect(() => {
    let cancelled = false;
    setReady(false); setMessage(""); setError(""); setSearch("");
    setCreating(false); setNewName(""); setAddingTo(null); setSelected([]);
    if (baseId) api.get<Config>(`/organization-statistics-groups/${baseId}`).then((data) => {
      if (!cancelled) { setConfig(data); setReady(true); setDirty(false); }
    }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [baseId, reload]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const teams = orgs.filter((org) => org.orgType === "TEAM" && org.parentId === baseId);
  const occupied = new Set(config.groups.flatMap((g) => g.teamIds));
  const available = teams.filter((t) => !occupied.has(t.id));
  function createGroup() {
    const name = newName.trim();
    if (!name) { setError("请先填写组名"); return; }
    if (config.groups.some((g) => g.name.trim() === name)) { setError("已存在同名分组，请换一个名称"); return; }
    const id = groupId();
    change([...config.groups, { id, name, enabled: true, teamIds: [] }]);
    setCreating(false); setNewName(""); setAddingTo(id); setSelected([]); setSearch(""); setError("");
  }
  function change(groups: Group[]) { setConfig((old) => ({ ...old, groups })); setDirty(true); setMessage(""); }
  function update(id: string, patch: Partial<Group>) { change(config.groups.map((g) => g.id === id ? { ...g, ...patch } : g)); }
  async function save() {
    if (config.groups.some((g) => !g.name.trim())) { setError("请为每个分组填写名称"); return; }
    setBusy(true); setError("");
    try {
      const result = await api.put<Config>(`/organization-statistics-groups/${baseId}`, config);
      setConfig(result); setDirty(false); setMessage("已保存，刷新仪表台即可按新分组查看统计。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <section className="rounded-3xl bg-white p-6 space-y-3">
      <h1 className="text-2xl font-semibold">合并统计</h1>
      <p className="text-sm text-slate-500">自定义团队统计分组，仅用于仪表台的主播、厅管日常任务历史完成率。不会迁移人员、改变组织归属或授予额外权限。</p>
      <p className="text-sm text-slate-500">各日期范围按当前分组展示，完成率按合计完成数 ÷（合计参与数 − 请假／豁免数）计算；基地总数不变。</p>
      <div className="flex flex-wrap gap-3 items-center">
        <label>选择基地 <select aria-label="选择基地" className={field} value={baseId} disabled={busy} onChange={(e) => {
          if (dirty && !window.confirm("尚有未保存的配置，确定放弃并切换基地吗？")) return;
          setReady(false); setBaseId(e.target.value);
        }}><option value="">请选择基地</option>{orgs.filter((o) => o.orgType === "BASE" && o.status === "active").map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <button className={field} disabled={busy || !baseId} onClick={() => { if (!dirty || window.confirm("放弃未保存修改并重新加载？")) setReload((n) => n + 1); }}>重新加载</button>
      </div>
    </section>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</div>}
    {message && <div role="status" className="rounded-xl bg-green-50 p-4 text-green-700">{message}</div>}
    {baseId && !ready && !error && <p>正在加载配置…</p>}
    {ready && <fieldset disabled={busy} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-xl bg-blue-600 px-4 py-2 text-white" onClick={() => { setCreating(true); setNewName(""); }}>＋ 新建统计分组</button>
        <span className="text-sm text-slate-500">未分组 {available.length} 个团队 · 已加入 A 组的团队不能加入 B 组，需先移出。</span>
      </div>
      {creating && <div className="rounded-2xl border border-blue-200 bg-white p-5 flex flex-wrap gap-3 items-center">
        <label htmlFor="new-statistics-group">组名</label>
        <input autoFocus id="new-statistics-group" className={field} maxLength={30} placeholder="例如：中台团队" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createGroup(); }} />
        <button className="rounded-xl bg-blue-600 px-4 py-2 text-white" onClick={createGroup}>创建分组并添加团队</button>
        <button className={field} onClick={() => setCreating(false)}>取消</button>
      </div>}
      {!config.groups.length && <div className="rounded-2xl bg-white p-8 text-slate-500">尚未设置分组，目前所有团队单独统计。</div>}
      {config.groups.map((group) => <section key={group.id} className="rounded-2xl bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <input aria-label="统计分组名称" className={field} maxLength={30} placeholder="分组名称，例如：中台团队" value={group.name} onChange={(e) => update(group.id, { name: e.target.value })} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={group.enabled} onChange={(e) => update(group.id, { enabled: e.target.checked })} />启用合并</label>
          <span className="text-sm text-slate-500">组内 {group.teamIds.length} 个团队</span>
          <button className="rounded-xl bg-blue-50 px-4 py-2 text-blue-600" onClick={() => { setAddingTo(group.id); setSelected([]); setSearch(""); }}>＋ 添加团队</button>
          <button className="ml-auto text-red-600" onClick={() => { if (window.confirm("解除此统计分组？保存后成员将恢复单独展示，不删除任何业务数据。")) change(config.groups.filter((g) => g.id !== group.id)); }}>解除分组</button>
        </div>
        {!group.enabled && <p className="text-sm text-amber-600">此分组已停用，保存后各成员单独展示；成员保留在分组中以便重新启用。</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-64 overflow-y-auto">
          {group.teamIds.map((id) => {
            const team = teams.find((t) => t.id === id);
            return <div key={id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 flex items-center justify-between gap-2 text-slate-700">
              <span>{team?.name ?? "团队已不在当前基地"}{team && team.status !== "active" ? "（已暂停）" : ""}</span>
              <button className="shrink-0 text-red-500 text-sm" aria-label={`移出${team?.name ?? "团队"}`} onClick={() => update(group.id, { teamIds: group.teamIds.filter((memberId) => memberId !== id) })}>移出</button>
            </div>;
          })}
        </div>
        {!group.teamIds.length && <p className="text-sm text-slate-400">分组已创建，点击“添加团队”将未分组团队加入。空组不会显示在统计中。</p>}
        {addingTo === group.id && <div className="rounded-xl border border-blue-200 bg-slate-50 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-medium">添加到「{group.name}」</h3>
            <input aria-label="搜索未分组团队" className={field} placeholder="搜索未分组团队" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="ml-auto text-slate-500" onClick={() => { setAddingTo(null); setSelected([]); }}>取消</button>
          </div>
          <p className="text-xs text-slate-500">只列出未分组团队；其他分组（含停用组）的成员不会出现在这里。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-60 overflow-y-auto">
            {available.filter((t) => t.name.includes(search.trim())).map((team) => <label key={team.id} className="flex gap-2 items-center rounded-lg border bg-white p-3">
              <input type="checkbox" checked={selected.includes(team.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, team.id] : ids.filter((id) => id !== team.id))} />
              {team.name}{team.status !== "active" ? "（已暂停）" : ""}
            </label>)}
          </div>
          {!available.filter((t) => t.name.includes(search.trim())).length && <p className="text-sm text-slate-500">没有符合条件的未分组团队。</p>}
          <button disabled={!selected.length} className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-40" onClick={() => {
            update(group.id, { teamIds: [...group.teamIds, ...selected.filter((id) => !occupied.has(id))] });
            setAddingTo(null); setSelected([]);
          }}>加入本组（{selected.length}）</button>
        </div>}
      </section>)}
      <div className="sticky bottom-3 rounded-2xl bg-white border p-4 flex items-center gap-4 shadow-lg">
        <button disabled={!dirty || busy} className="rounded-xl bg-blue-600 px-6 py-2 text-white disabled:opacity-40" onClick={save}>{busy ? "保存中…" : "保存配置"}</button>
        <span className="text-sm text-slate-500">{dirty ? "有未保存修改" : "配置已同步"} · 停用或解除合并均不会删除历史数据。</span>
      </div>
    </fieldset>}
  </div>;
}
