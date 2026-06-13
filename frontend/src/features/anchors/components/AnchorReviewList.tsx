import type { AnchorApplication, OrgUnit } from "../../../types";

interface AnchorReviewListProps {
  apps: AnchorApplication[];
  orgMap: Map<string, OrgUnit>;
  activeAppId: string;
  setActiveAppId: (val: string) => void;
  emptyText?: string;
}

function describeOrg(org?: OrgUnit) {
  return org ? `${org.name}（${org.orgCode}）` : "未识别";
}

export function AnchorReviewList({ apps, orgMap, activeAppId, setActiveAppId, emptyText = "当前筛选条件下暂无审核记录" }: AnchorReviewListProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
              <th className="whitespace-nowrap px-4 py-3 text-left">申请人</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">手机号</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">基地</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">团队</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">厅</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">申请时间</th>
              <th className="whitespace-nowrap px-4 py-3 text-left">状态</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => {
              const hall = orgMap.get(app.targetHallOrgId) ?? app.hall;
              const team = (hall?.parentId ? orgMap.get(hall.parentId) : undefined) ?? app.teamOrg ?? undefined;
              const base = (team?.parentId ? orgMap.get(team.parentId) : undefined) ?? app.baseOrg ?? undefined;
              const isActive = activeAppId === app.id;
              return (
                <tr
                  key={app.id}
                  onClick={() => setActiveAppId(app.id)}
                  className={`cursor-pointer border-t border-slate-100 transition ${isActive ? "bg-feishu-pale/60" : "bg-white hover:bg-slate-50"}`}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{app.anchorNickname}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{app.user?.phone || "未加载"}</td>
                  <td className="px-4 py-3 text-slate-600">{describeOrg(base)}</td>
                  <td className="px-4 py-3 text-slate-600">{describeOrg(team)}</td>
                  <td className="px-4 py-3 text-slate-600">{describeOrg(hall)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(app.submittedAt).toLocaleDateString()}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${app.status === "pending" ? "bg-amber-50 text-amber-700" : app.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                      {app.status === "pending" ? "待审核" : app.status === "approved" ? "已通过" : "已驳回"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!apps.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
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
