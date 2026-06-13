import type { AnchorApplication } from "../../../types";

interface ApprovedAccountListProps {
  apps: AnchorApplication[];
  onResetPassword: (app: AnchorApplication) => void;
}

function buildOrgPathCN(path?: string, hallName?: string, orgMap?: Map<string, string>) {
  if (!path) return hallName || "未识别";
  const parts = path.split("/").filter(Boolean);
  return parts.map((part) => orgMap?.get(part) || part).join(" / ") || hallName || "未识别";
}

export function ApprovedAccountList({ apps, onResetPassword }: ApprovedAccountListProps) {
  return (
    <section className="rounded-3xl bg-white p-6 shadow-card">
      <h2 className="text-xl font-semibold text-slate-900">已审核通过账号</h2>
      <p className="mt-1 text-sm text-slate-500">已通过审核的账号在这里做密码重置等后续操作。</p>
      <div className="mt-5 grid gap-4">
        {apps.map((app) => {
          const orgPathCN = buildOrgPathCN(app.hall?.path, app.hall?.name);
          return (
            <div key={app.id} className="rounded-3xl border border-slate-100 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{app.anchorNickname}</p>
                  <p className="mt-1 text-sm text-slate-500">手机号：{app.user?.phone || "未加载"}</p>
                  <p className="mt-1 text-sm text-slate-500">归属路径：{orgPathCN}</p>
                  <p className="mt-1 text-sm text-slate-500">审核通过时间：{app.reviewedAt ? new Date(app.reviewedAt).toLocaleString() : "未记录"}</p>
                </div>
                <button className="rounded-xl bg-feishu-blue px-4 py-2 text-xs font-medium text-white" onClick={() => onResetPassword(app)}>重置密码为 123456</button>
              </div>
            </div>
          );
        })}
        {!apps.length && <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-400">暂无已审核通过账号</div>}
      </div>
    </section>
  );
}
