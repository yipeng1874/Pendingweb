import type { OrgUnit } from "../../../types";
import type { OrgForm, OrgType } from "../types";
import { orgTypeMeta } from "../constants";
import { isHallFormValid, isOrgCodeGenerated, previewHallOrgCode } from "../utils";
import { Field, Info } from "./Fields";

export function OrgCreateForm({
  selected,
  childType,
  form,
  onFormChange,
  onCreate,
}: {
  selected?: OrgUnit;
  childType?: OrgType;
  form: OrgForm;
  onFormChange: (form: OrgForm) => void;
  onCreate: () => void;
}) {
  if (!selected || !childType) return null;

  const canCreate = childType === "HALL" ? isHallFormValid(form) : Boolean(childType && form.name.trim() && (isOrgCodeGenerated(childType) || form.orgCode.trim()));

  return (
    <div className="rounded-3xl bg-white p-6 shadow-card">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">新建下级组织</h2>
          <p className="mt-1 text-sm text-slate-500">当前选中：{selected.name}；可创建类型：{orgTypeMeta[childType].label}</p>
        </div>
        <button className="rounded-2xl bg-feishu-blue px-4 py-2 text-sm font-medium text-white hover:bg-feishu-deep disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!canCreate} onClick={onCreate}>创建组织</button>
      </div>
      {childType === "TEAM" && <p className="mt-3 rounded-2xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700">团队组织编码由系统根据上级基地编码自动生成，例如：基地编码 + A1。</p>}
      {childType === "HALL" && <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">新建厅组织时，负责人、联系电话、厅抖音号、厅抖音 UID、运营经纪人、备注均为必填；组织编码将按 HALL-厅抖音UID 自动生成。</p>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="组织名称" value={form.name} required onChange={(name) => onFormChange({ ...form, name })} />
        {!isOrgCodeGenerated(childType) && <Field label="组织编码" value={form.orgCode} required onChange={(orgCode) => onFormChange({ ...form, orgCode })} />}
        {childType === "TEAM" && <Info label="组织编码" value="系统根据上级基地自动生成" />}
        {childType === "HALL" && <Info label="组织编码" value={previewHallOrgCode(form.douyinUid)} />}
        <Field label="负责人" value={form.principalName} required={childType === "HALL"} onChange={(principalName) => onFormChange({ ...form, principalName })} />
        <Field label="联系电话" value={form.contactPhone} required={childType === "HALL"} onChange={(contactPhone) => onFormChange({ ...form, contactPhone })} />
        {childType === "HALL" && (
          <>
            <Field label="厅抖音号" value={form.douyinNo} required onChange={(douyinNo) => onFormChange({ ...form, douyinNo })} />
            <Field label="厅抖音 UID" value={form.douyinUid} required onChange={(douyinUid) => onFormChange({ ...form, douyinUid })} />
            <Field label="运营经纪人" value={form.brokerName} required onChange={(brokerName) => onFormChange({ ...form, brokerName })} />
            <Field label="备注" value={form.remark} required onChange={(remark) => onFormChange({ ...form, remark })} />
          </>
        )}
      </div>
    </div>
  );
}
