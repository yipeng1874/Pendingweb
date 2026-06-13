import type { Anchor } from "../types";
import { statusClass, statusLabel } from "../constants";

interface AnchorAccountTableProps {
  anchors: Anchor[];
  activeAnchorId: string;
  setActiveAnchorId: (id: string) => void;
  emptyText?: string;
}

export function AnchorAccountTable({ anchors, activeAnchorId, setActiveAnchorId, emptyText = "当前筛选条件下暂无主播账号" }: AnchorAccountTableProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
              <th className="whitespace-nowrap px-4 py-3 text-left">主播昵称</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">手机号</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">抖音号</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">抖音 UID</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">归属厅</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">状态</th>
            </tr>
          </thead>
          <tbody>
            {anchors.map((anchor) => {
              const isActive = activeAnchorId === anchor.id;
              return (
                <tr
                  key={anchor.id}
                  onClick={() => setActiveAnchorId(anchor.id)}
                  className={`cursor-pointer border-t border-slate-100 transition ${
                    isActive ? "bg-feishu-pale/60" : "bg-white hover:bg-slate-50"
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{anchor.nickname}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{anchor.boundUser?.phone || "未绑定账号"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{anchor.douyinNo || "未登记"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{anchor.douyinUid}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{anchor.hallOrg?.name || "未关联"}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${statusClass[anchor.status]}`}>
                      {statusLabel[anchor.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!anchors.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
