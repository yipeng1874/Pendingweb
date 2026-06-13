import { ChangeEvent } from "react";
import { Upload } from "lucide-react";
import type { OrgUnit } from "../../../types";
import type { BatchHallRow } from "../types";
import { previewHallOrgCode } from "../utils";

export function BatchHallForm({
  selected,
  batchRows,
  onBatchFileChange,
  onCreateBatchHalls,
}: {
  selected?: OrgUnit;
  batchRows: BatchHallRow[];
  onBatchFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateBatchHalls: () => void;
}) {
  if (!selected || selected.orgType !== "TEAM") return null;

  return (
    <div className="rounded-3xl bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">批量新建厅</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">上传 CSV 表格。表头需包含：厅名称、厅抖音号、厅抖音UID、负责人、联系电话、运营经纪人、备注。组织编码将按 HALL-厅抖音UID 自动生成。</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <Upload size={16} /> 上传表格
          <input className="hidden" type="file" accept=".csv,text/csv" onChange={onBatchFileChange} />
        </label>
      </div>
      {batchRows.length > 0 && (
        <div className="mt-4 max-h-44 overflow-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">名称</th>
                <th className="px-3 py-2">系统编码预览</th>
                <th className="px-3 py-2">负责人</th>
                <th className="px-3 py-2">抖音 UID</th>
              </tr>
            </thead>
            <tbody>
              {batchRows.map((row, index) => (
                <tr key={`${row.douyinUid}-${index}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{previewHallOrgCode(row.douyinUid)}</td>
                  <td className="px-3 py-2">{row.principalName}</td>
                  <td className="px-3 py-2">{row.douyinUid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button className="mt-4 w-full rounded-2xl bg-feishu-blue py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!batchRows.length} onClick={onCreateBatchHalls}>确认批量创建</button>
    </div>
  );
}
