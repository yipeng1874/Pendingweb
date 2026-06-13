import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Upload, ChevronDown } from "lucide-react";
import { StatusTag } from "../../components/StatusTag";
import { api } from "../../services/http";
import { useIdentityStore } from "../../stores/identityStore";
import { ORG_TREE_SIDEBAR_WIDTH } from "../../shared/constants/layout";
import type { Identity, OrgUnit } from "../../types";
import { buildOrgTree, getDefaultExpandedOrgIds, getDefaultSelectedOrgId } from "../../shared/utils/orgTree";
import { OrgTree } from "../../shared/components/tree/OrgTree";

type OrgType = OrgUnit["orgType"];

const nextTypeMap: Record<OrgType, OrgType | undefined> = {
  HQ: "BASE",
  BASE: "TEAM",
  TEAM: "HALL",
  HALL: undefined,
};

const parentTypeMap: Record<OrgType, OrgType | undefined> = {
  HQ: undefined,
  BASE: "HQ",
  TEAM: "BASE",
  HALL: "TEAM",
};

const orgTypeMeta: Record<OrgType, { label: string; badge: string; text: string; size: string }> = {
  HQ: { label: "总部", badge: "bg-blue-100 text-blue-700", text: "text-base font-semibold", size: "h-7 min-w-10" },
  BASE: { label: "基地", badge: "bg-violet-100 text-violet-700", text: "text-[15px] font-semibold", size: "h-6 min-w-10" },
  TEAM: { label: "团队", badge: "bg-emerald-100 text-emerald-700", text: "text-sm font-medium", size: "h-6 min-w-10" },
  HALL: { label: "厅", badge: "bg-amber-100 text-amber-700", text: "text-[13px] font-medium", size: "h-5 min-w-7" },
};

const requiredHallKeys = ["principalName", "contactPhone", "douyinNo", "douyinUid", "brokerName", "remark"] as const;
const emptyOrgForm = { name: "", orgCode: "", principalName: "", contactPhone: "", douyinNo: "", douyinUid: "", brokerName: "", remark: "" };
type OrgForm = typeof emptyOrgForm;

type BatchHallRow = Omit<OrgForm, "orgCode">;

function toOrgForm(org: OrgUnit): OrgForm {
  return {
    name: org.name ?? "",
    orgCode: org.orgCode ?? "",
    principalName: org.principalName ?? "",
    contactPhone: org.contactPhone ?? "",
    douyinNo: org.douyinNo ?? "",
    douyinUid: org.douyinUid ?? "",
    brokerName: org.brokerName ?? "",
    remark: org.remark ?? "",
  };
}

function isHallFormValid(form: OrgForm) {
  return Boolean(form.name.trim() && requiredHallKeys.every((key) => form[key].trim()));
}

function isOrgCodeGenerated(orgType?: OrgType) {
  return orgType === "TEAM" || orgType === "HALL";
}

function previewHallOrgCode(douyinUid: string) {
  const normalized = douyinUid.replace(/\s/g, "").trim();
  return normalized ? `HALL-${normalized}` : "填写厅抖音 UID 后自动生成";
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseBatchHallText(text: string): BatchHallRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((item) => item.replace(/\s/g, ""));
  const map: Record<string, keyof BatchHallRow> = {
    组织名称: "name",
    厅名称: "name",
    名称: "name",
    负责人: "principalName",
    联系电话: "contactPhone",
    厅抖音号: "douyinNo",
    抖音号: "douyinNo",
    厅抖音UID: "douyinUid",
    抖音UID: "douyinUid",
    运营经纪人: "brokerName",
    备注: "remark",
  };
  const keys = header.map((item) => map[item]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return keys.reduce<BatchHallRow>((row, key, index) => {
      if (key) row[key] = cells[index] ?? "";
      return row;
    }, { name: "", principalName: "", contactPhone: "", douyinNo: "", douyinUid: "", brokerName: "", remark: "" });
  });
}

export function OrganizationPage() {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [selected, setSelected] = useState<OrgUnit>();
  const [form, setForm] = useState(emptyOrgForm);
  const [editForm, setEditForm] = useState(emptyOrgForm);
  const [isEditing, setIsEditing] = useState(false);
  const [moveParentId, setMoveParentId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [batchRows, setBatchRows] = useState<BatchHallRow[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const childType = useMemo(() => selected ? nextTypeMap[selected.orgType] : undefined, [selected]);
  const moveCandidates = useMemo(() => selected ? orgs.filter((org) => org.orgType === parentTypeMap[selected.orgType] && org.id !== selected.id && !org.path.startsWith(`${selected.path}/`)) : [], [orgs, selected]);
  const hasChildren = useMemo(() => new Set(orgs.map((org) => org.parentId).filter(Boolean)), [orgs]);
  const hasSelectedChildren = Boolean(selected && hasChildren.has(selected.id));
  const canMoveSelected = Boolean(selected && selected.orgType !== "HQ" && moveCandidates.length > 0);
  const canDeleteSelected = Boolean(selected && selected.orgType !== "HQ" && !hasSelectedChildren);
  const showCreateChild = Boolean(childType);
  const showBatchHalls = selected?.orgType === "TEAM";
  const showMoveOrDelete = canMoveSelected || canDeleteSelected;
  const orgTree = useMemo(() => buildOrgTree(orgs), [orgs]);
  const collapsibleIds = useMemo(() => orgs.filter((org) => hasChildren.has(org.id)).map((org) => org.id), [orgs, hasChildren]);
  const allCollapsed = collapsibleIds.length > 0 && collapsibleIds.every((id) => collapsedIds.has(id));
  const handleToggleAll = () => {
    setCollapsedIds(allCollapsed ? new Set() : new Set(collapsibleIds));
  };

  function selectOrg(org?: OrgUnit) {
    setSelected(org);
    setMoveParentId("");
    setMessage("");
    setError("");
    setIsEditing(false);
    if (org) setEditForm(toOrgForm(org));
  }

  function load(nextSelectedId?: string) {
    api.get<OrgUnit[]>("/orgs/tree").then((list) => {
      setOrgs(list);
      const defaultOrgId = getDefaultSelectedOrgId(list, currentIdentity as Identity | undefined);
      const next = nextSelectedId ? list.find((item) => item.id === nextSelectedId) : selected ? list.find((item) => item.id === selected.id) : list.find((item) => item.id === defaultOrgId) ?? list[0];
      const expandedIds = getDefaultExpandedOrgIds(list, currentIdentity as Identity | undefined);
      const nextCollapsed = new Set<string>();
      list.filter((org) => list.some((item) => item.parentId === org.id)).forEach((org) => {
        if (!expandedIds.has(org.id)) nextCollapsed.add(org.id);
      });
      setCollapsedIds(nextCollapsed);
      selectOrg(next ?? list[0]);
    }).catch((err) => setError(err.message));
  }

  useEffect(() => { load(); }, []);

  async function run(action: () => Promise<void>, successText: string) {
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(successText);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditForm(toOrgForm(selected));
    setIsEditing(true);
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    if (selected) setEditForm(toOrgForm(selected));
    setIsEditing(false);
    setMessage("");
    setError("");
  }

  async function createChildOrg() {
    if (!selected || !childType) return;
    await run(async () => {
      const created = await api.post<OrgUnit>("/orgs", { ...form, parentId: selected.id, orgType: childType });
      setForm(emptyOrgForm);
      load(created.id);
    }, "组织已创建");
  }

  async function saveSelectedOrg() {
    if (!selected) return;
    await run(async () => {
      const updated = await api.patch<OrgUnit>(`/orgs/${selected.id}`, { ...editForm, douyinUid: selected.orgType === "HALL" ? editForm.douyinUid : undefined });
      setIsEditing(false);
      load(updated.id);
    }, "组织档案已保存");
  }

  async function pauseOrRestore() {
    if (!selected) return;
    const isPaused = selected.status === "paused";
    await run(async () => {
      const updated = await api.post<OrgUnit>(`/orgs/${selected.id}/${isPaused ? "restore" : "pause"}`);
      load(updated.id);
    }, isPaused ? "组织已恢复" : "组织已暂停");
  }

  async function moveSelectedOrg() {
    if (!selected || !moveParentId) return;
    await run(async () => {
      const moved = await api.post<OrgUnit>(`/orgs/${selected.id}/move`, { parentId: moveParentId });
      load(moved.id);
    }, "组织已迁移");
  }

  async function deleteSelectedOrg() {
    if (!selected || selected.orgType === "HQ") return;
    if (!window.confirm(`确定删除组织「${selected.name}」吗？该操作不可恢复。`)) return;
    await run(async () => {
      await api.delete<{ deleted: boolean }>(`/orgs/${selected.id}`);
      load();
    }, "组织已删除");
  }

  function toggleCollapsed(orgId: string) {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }

  async function handleBatchFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseBatchHallText(text);
    setBatchRows(rows);
    setMessage(`已解析 ${rows.length} 条厅组织数据`);
    setError("");
    event.target.value = "";
  }

  async function createBatchHalls() {
    if (!selected || selected.orgType !== "TEAM") return;
    await run(async () => {
      const result = await api.post<{ count: number; items: OrgUnit[] }>("/orgs/halls/batch", { parentId: selected.id, rows: batchRows });
      setBatchRows([]);
      load(result.items[0]?.id);
    }, `已批量创建 ${batchRows.length} 个厅组织`);
  }

  const canCreate = childType === "HALL" ? isHallFormValid(form) : Boolean(childType && form.name.trim() && (isOrgCodeGenerated(childType) || form.orgCode.trim()));

  return (
    <div className="grid gap-6 lg:grid-cols-[var(--org-tree-sidebar-width)_minmax(0,1fr)]" style={{ ["--org-tree-sidebar-width" as string]: ORG_TREE_SIDEBAR_WIDTH.organization }}>
      <section className="min-w-0 rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-950">组织设立变更</h1>
            <p className="mt-1 text-sm text-slate-500">统一组织树、编辑面板与批量导入的视觉风格。</p>
          </div>
          <div className="flex gap-2">
            <button className="feishu-button-secondary h-9 px-3 text-xs" onClick={handleToggleAll}>{allCollapsed ? "全部展开" : "全部折叠"}</button>
          </div>
        </div>
        <div className="space-y-2">
          <OrgTree
            nodes={orgTree}
            selectedOrgId={selected?.id ?? ""}
            onSelect={(orgId) => selectOrg(orgs.find((item) => item.id === orgId))}
            collapsedIds={collapsedIds}
            onToggleCollapse={toggleCollapsed}
          />
        </div>
      </section>

      <section className="space-y-6">
        {(message || error) && <div className={`rounded-[20px] border px-4 py-3 text-sm shadow-[0_8px_20px_rgba(15,23,42,0.04)] ${error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}

        <div className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          {selected && (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-feishu-blue">{orgTypeMeta[selected.orgType].label} · {selected.orgType}</p>
                  {isEditing ? (
                    <input className="mt-2 w-full min-w-[260px] rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-2xl font-semibold tracking-[-0.03em] outline-none transition focus:border-feishu-blue focus:bg-white focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)]" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
                  ) : (
                    <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-950">{selected.name}</h2>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusTag status={selected.status} />
                  {isEditing ? (
                    <>
                      <button className="feishu-button-secondary h-10 px-4" onClick={cancelEdit}>取消</button>
                      <button className="feishu-button-primary h-10 px-4" disabled={!editForm.name} onClick={saveSelectedOrg}>保存</button>
                    </>
                  ) : (
                    <>
                      <button className="feishu-button-secondary h-10 px-4" onClick={pauseOrRestore}>{selected.status === "paused" ? "恢复" : "暂停"}</button>
                      <button className="feishu-button-primary h-10 px-4" onClick={startEdit}>编辑</button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <EditableInfo label="组织编码" value={editForm.orgCode} readonly={isEditing} isEditing={isEditing} onChange={(orgCode) => setEditForm({ ...editForm, orgCode })} />
                <Info label="层级路径" value={selected.path} />
                <EditableInfo label="负责人" value={editForm.principalName} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(principalName) => setEditForm({ ...editForm, principalName })} />
                <EditableInfo label="联系电话" value={editForm.contactPhone} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(contactPhone) => setEditForm({ ...editForm, contactPhone })} />
                <EditableInfo label="厅抖音号" value={editForm.douyinNo} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(douyinNo) => setEditForm({ ...editForm, douyinNo })} />
                <EditableInfo label="厅抖音 UID" value={editForm.douyinUid} fallback="非厅级组织" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(douyinUid) => setEditForm({ ...editForm, douyinUid })} />
                <EditableInfo label="运营经纪人" value={editForm.brokerName} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(brokerName) => setEditForm({ ...editForm, brokerName })} />
                <EditableInfo label="备注" value={editForm.remark} fallback="无备注" isEditing={isEditing} required={selected.orgType === "HALL"} multiline onChange={(remark) => setEditForm({ ...editForm, remark })} />
              </div>
            </div>
          )}
        </div>

        {(showCreateChild || showBatchHalls) && (
          <div className={`grid gap-6 ${showCreateChild && showBatchHalls ? "xl:grid-cols-2" : "xl:grid-cols-1"}`}>
            {showCreateChild && (
              <div className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950">新建下级组织</h2>
                  <p className="mt-1 text-sm text-slate-500">当前选中：{selected?.name ?? "未选择"}；可创建类型：{childType ? orgTypeMeta[childType].label : "无下级"}</p>
                </div>
                {childType === "TEAM" && <p className="mt-3 rounded-[20px] border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700">团队组织编码由系统根据上级基地编码自动生成，例如：基地编码 + A1。</p>}
                {childType === "HALL" && <p className="mt-3 rounded-[20px] border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">新建厅组织时，负责人、联系电话、厅抖音号、厅抖音 UID、运营经纪人、备注均为必填；组织编码将按 HALL-厅抖音UID 自动生成。</p>}
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <Field label="组织名称" value={form.name} required onChange={(name) => setForm({ ...form, name })} />
                  {!isOrgCodeGenerated(childType) && <Field label="组织编码" value={form.orgCode} required onChange={(orgCode) => setForm({ ...form, orgCode })} />}
                  {childType === "TEAM" && <Info label="组织编码" value="系统根据上级基地自动生成" />}
                  {childType === "HALL" && <Info label="组织编码" value={previewHallOrgCode(form.douyinUid)} />}
                  <Field label="负责人" value={form.principalName} required={childType === "HALL"} onChange={(principalName) => setForm({ ...form, principalName })} />
                  <Field label="联系电话" value={form.contactPhone} required={childType === "HALL"} onChange={(contactPhone) => setForm({ ...form, contactPhone })} />
                  {childType === "HALL" && <><Field label="厅抖音号" value={form.douyinNo} required onChange={(douyinNo) => setForm({ ...form, douyinNo })} /><Field label="厅抖音 UID" value={form.douyinUid} required onChange={(douyinUid) => setForm({ ...form, douyinUid })} /><Field label="运营经纪人" value={form.brokerName} required onChange={(brokerName) => setForm({ ...form, brokerName })} /><Field label="备注" value={form.remark} required onChange={(remark) => setForm({ ...form, remark })} /></>}
                </div>
                <div className="mt-5 flex justify-end">
                  <button className="feishu-button-primary h-10 px-4" disabled={!canCreate} onClick={createChildOrg}>创建组织</button>
                </div>
              </div>
            )}

            {showBatchHalls && (
              <div className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950">批量新建厅</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">上传 CSV 表格。表头需包含：厅名称、厅抖音号、厅抖音UID、负责人、联系电话、运营经纪人、备注。组织编码将按 HALL-厅抖音UID 自动生成。</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-[16px] border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
                    <Upload size={16} /> 上传表格
                    <input className="hidden" type="file" accept=".csv,text/csv" onChange={handleBatchFile} />
                  </label>
                </div>
                {batchRows.length > 0 && <div className="mt-4 max-h-44 overflow-auto rounded-[20px] border border-slate-100 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">名称</th><th className="px-3 py-2">系统编码预览</th><th className="px-3 py-2">负责人</th><th className="px-3 py-2">抖音 UID</th></tr></thead><tbody>{batchRows.map((row, index) => <tr key={`${row.douyinUid}-${index}`} className="border-t border-slate-100"><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2">{previewHallOrgCode(row.douyinUid)}</td><td className="px-3 py-2">{row.principalName}</td><td className="px-3 py-2">{row.douyinUid}</td></tr>)}</tbody></table></div>}
                <button className="feishu-button-primary mt-4 h-11 w-full" disabled={!batchRows.length} onClick={createBatchHalls}>确认批量创建</button>
              </div>
            )}
          </div>
        )}

        {showMoveOrDelete && (
          <div>
            <button
              className="flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-600"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <ChevronDown size={15} className={`transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
              {showAdvanced ? "收起" : "展开"}不常用操作（迁移 / 删除）
            </button>
            {showAdvanced && (
              <div className={`mt-4 grid gap-6 ${canMoveSelected && canDeleteSelected ? "xl:grid-cols-2" : "xl:grid-cols-1"}`}>
                {canMoveSelected && (
                  <div className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                    <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950">迁移组织</h2>
                    <p className="mt-1 text-sm text-slate-500">迁移只能在同层规则下进行：基地归总部、团队归基地、厅归团队。</p>
                    <select className="mt-5 w-full rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-feishu-blue focus:bg-white focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)]" value={moveParentId} onChange={(event) => setMoveParentId(event.target.value)}>
                      <option value="">选择新的上级组织</option>
                      {moveCandidates.map((org) => <option key={org.id} value={org.id}>{org.name}（{org.orgCode}）</option>)}
                    </select>
                    <button className="feishu-button-primary mt-4 h-11 w-full" disabled={!moveParentId} onClick={moveSelectedOrg}>确认迁移</button>
                  </div>
                )}
                {canDeleteSelected && (
                  <div className="rounded-[28px] border border-red-100 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                    <h2 className="text-xl font-semibold tracking-[-0.02em] text-red-600">删除组织</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">只能删除没有账号身份、没有主播、没有任务目标的空组织。总部不可删除。</p>
                    <button className="mt-5 h-11 w-full rounded-[16px] bg-red-500 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(239,68,68,0.20)] transition hover:bg-red-600" onClick={deleteSelectedOrg}>删除当前组织</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, required, onChange }: { label: string; value: string; required?: boolean; onChange: (value: string) => void }) {
  return <label className="block"><span className="text-xs font-medium text-slate-500">{label}{required && <span className="ml-1 text-red-500">*</span>}</span><input className="feishu-input mt-2" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Info({ label, value, required }: { label: string; value: string; required?: boolean }) {
  return <div className="rounded-[20px] border border-slate-100 bg-slate-50 p-4"><p className="text-xs text-slate-400">{label}{required && <span className="ml-1 text-red-500">*</span>}</p><p className="mt-2 text-sm font-medium text-slate-700">{value}</p></div>;
}

function EditableInfo({ label, value, fallback, isEditing, readonly, multiline, required, onChange }: { label: string; value: string; fallback?: string; isEditing: boolean; readonly?: boolean; multiline?: boolean; required?: boolean; onChange: (value: string) => void }) {
  if (!isEditing || readonly) return <Info label={label} value={value || fallback || "未登记"} required={required} />;
  return (
    <label className="block rounded-[20px] border border-slate-100 bg-slate-50 p-4">
      <span className="text-xs font-medium text-slate-400">{label}{required && <span className="ml-1 text-red-500">*</span>}</span>
      {multiline ? (
        <textarea className="mt-2 w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-feishu-blue focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)]" rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className="mt-2 w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-feishu-blue focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)]" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}
