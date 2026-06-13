import type { OrgUnit } from "../../../types";

export function OrgMoveDelete({
  selected,
  canMoveSelected,
  canDeleteSelected,
  moveCandidates,
  moveParentId,
  onMoveParentIdChange,
  onMoveSelectedOrg,
  onDeleteSelectedOrg,
}: {
  selected?: OrgUnit;
  canMoveSelected: boolean;
  canDeleteSelected: boolean;
  moveCandidates: OrgUnit[];
  moveParentId: string;
  onMoveParentIdChange: (id: string) => void;
  onMoveSelectedOrg: () => void;
  onDeleteSelectedOrg: () => void;
}) {
  if (!selected) return null;
  const showMoveOrDelete = canMoveSelected || canDeleteSelected;
  if (!showMoveOrDelete) return null;

  return (
    <div className={`grid gap-6 ${canMoveSelected && canDeleteSelected ? "xl:grid-cols-2" : "xl:grid-cols-1"}`}>
      {canMoveSelected && (
        <div className="rounded-3xl bg-white p-6 shadow-card">
          <h2 className="text-xl font-semibold">迁移组织</h2>
          <p className="mt-1 text-sm text-slate-500">迁移只能在同层规则下进行：基地归总部、团队归基地、厅归团队。</p>
          <select className="mt-5 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-feishu-blue" value={moveParentId} onChange={(event) => onMoveParentIdChange(event.target.value)}>
            <option value="">选择新的上级组织</option>
            {moveCandidates.map((org) => <option key={org.id} value={org.id}>{org.name}（{org.orgCode}）</option>)}
          </select>
          <button className="mt-4 w-full rounded-2xl bg-feishu-blue py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!moveParentId} onClick={onMoveSelectedOrg}>确认迁移</button>
        </div>
      )}
      {canDeleteSelected && (
        <div className="rounded-3xl border border-red-100 bg-white p-6 shadow-card">
          <h2 className="text-xl font-semibold text-red-600">删除组织</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">只能删除没有账号身份、没有主播、没有任务目标的空组织。总部不可删除。</p>
          <button className="mt-5 w-full rounded-2xl bg-red-500 py-3 text-sm font-semibold text-white hover:bg-red-600" onClick={onDeleteSelectedOrg}>删除当前组织</button>
        </div>
      )}
    </div>
  );
}
