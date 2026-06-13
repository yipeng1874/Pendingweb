import { StatusTag } from "../../../components/StatusTag";
import type { OrgUnit } from "../../../types";
import type { OrgForm } from "../types";
import { orgTypeMeta } from "../constants";
import { EditableInfo, Info } from "./Fields";

export function OrgDetail({
  selected,
  isEditing,
  editForm,
  onEditFormChange,
  onStartEdit,
  onCancelEdit,
  onSave,
  onPauseOrRestore,
}: {
  selected: OrgUnit;
  isEditing: boolean;
  editForm: OrgForm;
  onEditFormChange: (form: OrgForm) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onPauseOrRestore: () => void;
}) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-feishu-blue">{orgTypeMeta[selected.orgType].label} · {selected.orgType}</p>
          {isEditing ? (
            <input className="mt-2 w-full min-w-[260px] rounded-2xl border border-slate-200 px-4 py-3 text-2xl font-semibold outline-none focus:border-feishu-blue" value={editForm.name} onChange={(event) => onEditFormChange({ ...editForm, name: event.target.value })} />
          ) : (
            <h2 className="mt-2 text-2xl font-semibold">{selected.name}</h2>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusTag status={selected.status} />
          {isEditing ? (
            <>
              <button className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50" onClick={onCancelEdit}>取消</button>
              <button className="rounded-2xl bg-feishu-blue px-4 py-2 text-sm font-medium text-white hover:bg-feishu-deep disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!editForm.name} onClick={onSave}>保存</button>
            </>
          ) : (
            <>
              <button className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50" onClick={onPauseOrRestore}>{selected.status === "paused" ? "恢复" : "暂停"}</button>
              <button className="rounded-2xl bg-feishu-blue px-4 py-2 text-sm font-medium text-white hover:bg-feishu-deep" onClick={onStartEdit}>编辑</button>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <EditableInfo label="组织编码" value={editForm.orgCode} readonly={isEditing} isEditing={isEditing} onChange={(orgCode) => onEditFormChange({ ...editForm, orgCode })} />
        <Info label="层级路径" value={selected.path} />
        <EditableInfo label="负责人" value={editForm.principalName} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(principalName) => onEditFormChange({ ...editForm, principalName })} />
        <EditableInfo label="联系电话" value={editForm.contactPhone} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(contactPhone) => onEditFormChange({ ...editForm, contactPhone })} />
        <EditableInfo label="厅抖音号" value={editForm.douyinNo} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(douyinNo) => onEditFormChange({ ...editForm, douyinNo })} />
        <EditableInfo label="厅抖音 UID" value={editForm.douyinUid} fallback="非厅级组织" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(douyinUid) => onEditFormChange({ ...editForm, douyinUid })} />
        <EditableInfo label="运营经纪人" value={editForm.brokerName} fallback="未登记" isEditing={isEditing} required={selected.orgType === "HALL"} onChange={(brokerName) => onEditFormChange({ ...editForm, brokerName })} />
        <EditableInfo label="备注" value={editForm.remark} fallback="无备注" isEditing={isEditing} required={selected.orgType === "HALL"} multiline onChange={(remark) => onEditFormChange({ ...editForm, remark })} />
      </div>
    </div>
  );
}
