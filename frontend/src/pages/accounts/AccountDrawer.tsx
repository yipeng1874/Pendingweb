import { X } from "lucide-react";
import type { Identity, OrgUnit } from "../../types";
import { orgTypeLabelMap, roleLabelMap } from "./accountsTypes";
import type { Account } from "./accountsTypes";

export interface AccountDrawerProps {
  account: Account | undefined;
  orgs: OrgUnit[];
  loading?: boolean;
  onClose: () => void;
  onToggleIdentity: (identity: Identity) => void;
  onToggleAccount: (account: Account) => void;
  onForceDelete: (accountId: string) => void;
}

function formatOrgPath(path: string, orgs: OrgUnit[]) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => orgs.find((org) => org.orgCode === segment)?.name ?? segment)
    .join(" / ");
}

export function AccountDrawer({ account, orgs, loading = false, onClose, onToggleIdentity, onToggleAccount, onForceDelete }: AccountDrawerProps) {
  if (!account) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[4px]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-[520px] max-w-full flex-col overflow-hidden border-l border-white/70 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">{account.nickname}</h3>
            <p className="mt-1 text-xs text-slate-500">{account.phone}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${account.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {account.status === "active" ? "启用中" : "已禁用"}
            </span>
            <button type="button" onClick={onClose} className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto bg-slate-50/40 p-6">
          {loading && (
            <div className="rounded-[20px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              正在加载账号详情...
            </div>
          )}
          <section className="rounded-[24px] border border-white/70 bg-white p-5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">账号基础信息</p>
            <div className="mt-4 grid gap-4 text-sm text-slate-600">
              <InfoRow label="账号昵称" value={account.nickname} />
              <InfoRow label="手机号" value={account.phone} />
              <InfoRow label="账号状态" value={account.status === "active" ? "启用中" : "已禁用"} />
            </div>
          </section>

          {account.anchorProfile && (
            <section className="rounded-[24px] border border-white/70 bg-white p-5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">主播资料</p>
              <div className="mt-4 grid gap-4 text-sm text-slate-600">
                <InfoRow label="主播昵称" value={account.anchorProfile.nickname} />
                <InfoRow label="抖音号" value={account.anchorProfile.douyinNo || "—"} />
                <InfoRow label="抖音 UID" value={account.anchorProfile.douyinUid || "—"} />
                <InfoRow label="主播状态" value={account.anchorProfile.status} />
              </div>
            </section>
          )}

          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">身份列表</p>
            {account.identities.length > 0 ? (
              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500">
                      <th className="px-4 py-3 text-left font-medium">角色</th>
                      <th className="px-4 py-3 text-left font-medium">组织/档案</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.identities.map((identity) => {
                      const detail = identity.org
                        ? `${identity.org.name} · ${orgTypeLabelMap[identity.org.orgType]}${identity.scopePath ? ` · ${identity.scopePath}` : ""}`
                        : identity.anchorProfile?.nickname || "未关联";

                      return (
                        <tr key={identity.id} className="border-t border-slate-100">
                          <td className="px-4 py-3 font-medium text-slate-800">{roleLabelMap[identity.roleCode]}</td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="max-w-[190px] truncate" title={detail}>{identity.org?.name || identity.anchorProfile?.nickname || "未关联"}</div>
                            <div className="mt-1 max-w-[190px] truncate text-xs text-slate-400" title={identity.scopePath ? formatOrgPath(identity.scopePath, orgs) : "—"}>
                              {identity.scopePath ? formatOrgPath(identity.scopePath, orgs) : "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${identity.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                              {identity.status === "active" ? "生效中" : "已停用"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-feishu-blue hover:text-feishu-blue" onClick={() => onToggleIdentity(identity)}>
                              {identity.status === "active" ? "停用" : "启用"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">暂无身份</div>
            )}
          </section>

          <section className="rounded-[24px] border border-red-100 bg-white p-5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">账号控制</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className={`rounded-2xl px-4 py-2 text-sm transition ${account.status === "active" ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                onClick={() => onToggleAccount(account)}
              >
                {account.status === "active" ? "禁用" : "启用"}
              </button>
              <button className="rounded-2xl border border-red-200 px-4 py-2 text-sm text-red-600 transition hover:bg-red-50" onClick={() => onForceDelete(account.id)}>
                删除
              </button>
            </div>
            <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
              为避免误操作，禁用和删除都会先弹出二次确认提示。
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              “停用”只影响单条身份；“禁用”冻结整个账号并同步停用其全部生效身份；“删除”用于强制移除账号。
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 font-medium text-slate-800">{value}</div>
    </div>
  );
}
