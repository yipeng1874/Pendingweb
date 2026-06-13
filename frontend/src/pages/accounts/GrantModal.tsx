import { useEffect, useMemo, useState } from "react";
import { Shield, X } from "lucide-react";
import { accountApi } from "../../features/accounts/api";
import type { OrgUnit, RoleCode } from "../../types";
import { orgTypeLabelMap, roleOptions, roleLabelMap } from "./accountsTypes";
import type { SearchAccount } from "./accountsTypes";


export interface GrantModalProps {
  targetOrg: OrgUnit | undefined;
  orgs: OrgUnit[];
  onClose: () => void;
  onGrant: (userId: string, payload: { roleCode: RoleCode; orgId: string }, name: string) => Promise<void>;
}

export function GrantModal({ targetOrg, orgs, onClose, onGrant }: GrantModalProps) {
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResult, setSearchResult] = useState<SearchAccount[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [grantOrgId, setGrantOrgId] = useState(targetOrg?.id ?? "");
  const [roleCode, setRoleCode] = useState<RoleCode>("TEAM_ADMIN");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [grantError, setGrantError] = useState("");
  const [grantSuccess, setGrantSuccess] = useState("");

  const availableRoles = useMemo(() => {
    const org = orgs.find((o) => o.id === grantOrgId);
    return org ? roleOptions.filter((r) => r.orgTypes.includes(org.orgType)) : [];
  }, [grantOrgId, orgs]);

  const grantOrg = useMemo(() => orgs.find((o) => o.id === grantOrgId), [grantOrgId, orgs]);
  const selectedAccount = useMemo(() => searchResult.find((a) => a.id === selectedUserId), [searchResult, selectedUserId]);

  useEffect(() => {
    setGrantOrgId(targetOrg?.id ?? "");
  }, [targetOrg]);

  useEffect(() => {
    if (availableRoles.length && !availableRoles.some((r) => r.value === roleCode)) {
      setRoleCode(availableRoles[0].value);
    }
  }, [availableRoles, roleCode]);

  async function doSearch() {
    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSearchResult([]);
      setSelectedUserId("");
      return;
    }
    setSearching(true);
    try {
      const result = await accountApi.searchAccounts(keyword);
      setSearchResult(result);
      setSelectedUserId((current) => (result.some((account) => account.id === current) ? current : ""));
    } catch {
      setSearchResult([]);
      setSelectedUserId("");
    } finally {
      setSearching(false);
    }
  }


  async function doGrant() {
    if (!selectedUserId || !grantOrgId || !roleCode) return;
    setSubmitting(true);
    setGrantError("");
    setGrantSuccess("");
    try {
      await onGrant(selectedUserId, { roleCode, orgId: grantOrgId }, selectedAccount?.nickname || selectedUserId);
      setGrantSuccess("权限已成功开通！");
      setSelectedUserId("");
      setSearchResult([]);
      setSearchKeyword("");
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : "授权失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 backdrop-blur-[4px] p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.16)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">新增管理员</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">搜索已注册账号，为其在指定组织开通管理权限</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">授权组织</span>
            <select className="mt-2 w-full rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-feishu-blue focus:bg-white focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)]" value={grantOrgId} onChange={(e) => setGrantOrgId(e.target.value)}>
              <option value="">请选择组织</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}（{org.orgCode} · {orgTypeLabelMap[org.orgType]}）</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">授权角色</span>
            <select className="mt-2 w-full rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-feishu-blue focus:bg-white focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)] disabled:bg-slate-50 disabled:text-slate-400" value={roleCode} disabled={!grantOrgId || !availableRoles.length} onChange={(e) => setRoleCode(e.target.value as RoleCode)}>
              <option value="">请选择角色</option>
              {availableRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>

          <div>
            <span className="text-xs font-medium text-slate-500">搜索账号</span>
            <div className="mt-2 flex gap-2">
              <input className="feishu-input flex-1" placeholder="输入手机号或昵称" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
              <button className="feishu-button-primary px-4" disabled={searching} onClick={doSearch}>{searching ? "搜索中" : "搜索"}</button>
            </div>
            {searchResult.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-[20px] border border-slate-200 bg-white text-sm shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                {searchResult.map((a) => (
                  <button key={a.id} className={`flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left last:border-0 transition hover:bg-slate-50 ${selectedUserId === a.id ? "bg-feishu-pale/70" : ""}`} onClick={() => setSelectedUserId(a.id)}>
                    <div>
                      <span className="font-medium text-slate-800">{a.nickname}</span>
                      <span className="ml-2 text-xs text-slate-400">{a.phone}</span>
                    </div>
                    {selectedUserId === a.id && <span className="text-xs font-medium text-feishu-blue">已选</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedUserId && grantOrgId && roleCode && (
            <div className="rounded-[20px] border border-feishu-blue/10 bg-feishu-pale/60 px-4 py-3 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-feishu-blue" />
                <span>将授权 <b>{selectedAccount?.nickname}</b> 为 <b>{roleLabelMap[roleCode]}</b></span>
              </div>
              <div className="mt-1 text-xs text-slate-400">组织：{grantOrg?.name}（{grantOrg ? orgTypeLabelMap[grantOrg.orgType] : ""}）</div>
            </div>
          )}

          {grantError && <div className="rounded-[20px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 whitespace-pre-line shadow-[0_8px_20px_rgba(15,23,42,0.04)]">{grantError}</div>}
          {grantSuccess && <div className="rounded-[20px] border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">{grantSuccess}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button className="feishu-button-secondary h-10 px-4" onClick={onClose}>关闭</button>
          <button className="feishu-button-primary h-10 px-5" disabled={!selectedUserId || !grantOrgId || !roleCode || submitting} onClick={doGrant}>{submitting ? "授权中..." : "确认开通权限"}</button>
        </div>
      </div>
    </div>
  );
}
