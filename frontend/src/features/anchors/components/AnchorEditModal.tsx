import type { Anchor } from "../types";
import type { OrgUnit } from "../../../types";
import { TextField } from "../../../shared/components/form/TextField";
import { SelectField } from "../../../shared/components/form/SelectField";

interface AnchorEditModalProps {
  editing: Anchor;
  halls: OrgUnit[];
  onChange: (updated: Anchor) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function AnchorEditModal({ editing, halls, onChange, onCancel, onSave }: AnchorEditModalProps) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-6">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-card">
        <h2 className="text-xl font-semibold text-slate-900">编辑主播资料</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TextField label="主播昵称" value={editing.nickname} onChange={(nickname) => onChange({ ...editing, nickname })} />
          <TextField label="抖音号" value={editing.douyinNo ?? ""} onChange={(douyinNo) => onChange({ ...editing, douyinNo })} />
          <TextField label="抖音 UID" value={editing.douyinUid} onChange={(douyinUid) => onChange({ ...editing, douyinUid })} />
          <SelectField
            label="归属厅"
            value={editing.hallOrgId}
            options={halls.map((hall) => ({ value: hall.id, label: `${hall.name}（${hall.orgCode}）` }))}
            onChange={(hallOrgId) => onChange({ ...editing, hallOrgId })}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600" onClick={onCancel}>取消</button>
          <button className="rounded-2xl bg-feishu-blue px-4 py-2 text-sm font-medium text-white" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
