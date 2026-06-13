import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../../../services/http";
import type { AnchorApplication, OrgUnit } from "../../../types";
import { statusClass, statusLabel } from "../constants";
import { TextField } from "../../../shared/components/form/TextField";
import type { Anchor as AnchorProfile } from "../types";

interface AnchorAccountDrawerProps {
  anchor: AnchorProfile | undefined;
  editing: AnchorProfile | undefined;
  orgs: OrgUnit[];                          // 全量组织列表，用于反查上级
  matchedApp: AnchorApplication | undefined;
  readOnly?: boolean;
  onClose: () => void;
  onChange: (updated: AnchorProfile) => void;
  onSave: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onDelete: () => void;
  onResetPassword: (() => void) | undefined;
}

// ─── 级联选择子组件 ──────────────────────────────────────────────────────────
interface CascadeHallPickerProps {
  orgs: OrgUnit[];
  hallOrgId: string;
  onChange: (hallOrgId: string) => void;
}

function CascadeHallPicker({ orgs, hallOrgId, onChange, disabled = false }: CascadeHallPickerProps & { disabled?: boolean }) {
  const bases = orgs.filter((o) => o.orgType === "BASE" && o.status === "active");

  // 根据当前 hallOrgId 反查初始 baseId / teamId
  function resolveInitial() {
    const hall = orgs.find((o) => o.id === hallOrgId);
    if (!hall) return { baseId: "", teamId: "" };
    const team = hall.parentId ? orgs.find((o) => o.id === hall.parentId) : undefined;
    const base = team?.parentId ? orgs.find((o) => o.id === team.parentId) : undefined;
    return { baseId: base?.id ?? "", teamId: team?.id ?? "" };
  }

  const initial = resolveInitial();
  const [baseId, setBaseId] = useState(initial.baseId);
  const [teamId, setTeamId] = useState(initial.teamId);

  // 当 hallOrgId 切换（打开不同抽屉）时重新初始化
  useEffect(() => {
    const { baseId: b, teamId: t } = resolveInitial();
    setBaseId(b);
    setTeamId(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hallOrgId]);

  const teams = orgs.filter((o) => o.orgType === "TEAM" && o.parentId === baseId && o.status === "active");
  const [dynamicHalls, setDynamicHalls] = useState<OrgUnit[]>([]);

  // 当 teamId 变化时加载厅（包含虚拟厅）
  useEffect(() => {
    setDynamicHalls([]);
    if (!teamId) return;
    api
      .get<OrgUnit[]>(`/anchors/register/orgs?orgType=HALL&parentId=${teamId}&includeVirtual=true`)
      .then(setDynamicHalls)
      .catch(console.error);
  }, [teamId]);

  function handleBaseChange(val: string) {
    setBaseId(val);
    setTeamId("");
    setDynamicHalls([]);
    onChange("");
  }

  function handleTeamChange(val: string) {
    setTeamId(val);
    setDynamicHalls([]);
    onChange("");
  }

  return (
    <div className="grid gap-3 md:grid-cols-3 col-span-2">
      {/* 基地 */}
      <label className="block">
        <span className="text-xs text-slate-500">所属基地</span>
        <select
          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue"
          value={baseId}
          disabled={disabled}
          onChange={(e) => handleBaseChange(e.target.value)}
        >
          <option value="">请选择基地</option>
          {bases.map((b) => (
            <option key={b.id} value={b.id}>{b.name}（{b.orgCode}）</option>
          ))}
        </select>
      </label>

      {/* 团队 */}
      <label className="block">
        <span className="text-xs text-slate-500">所属团队</span>
        <select
          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue disabled:bg-slate-50 disabled:text-slate-400"
          value={teamId}
          disabled={disabled || !baseId}
          onChange={(e) => handleTeamChange(e.target.value)}
        >
          <option value="">{baseId ? "请选择团队" : "请先选择基地"}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}（{t.orgCode}）</option>
          ))}
        </select>
      </label>

      {/* 归属厅 */}
      <label className="block">
        <span className="text-xs text-slate-500">归属厅</span>
        <select
          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue disabled:bg-slate-50 disabled:text-slate-400"
          value={hallOrgId}
          disabled={disabled || !teamId}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{teamId ? "请选择归属厅" : "请先选择团队"}</option>
          {dynamicHalls.map((h) => (
            <option key={h.id} value={h.id}>{h.name}（{h.orgCode}）</option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ─── 主抽屉组件 ──────────────────────────────────────────────────────────────
export function AnchorAccountDrawer({
  anchor,
  editing,
  orgs,
  readOnly = false,
  onClose,
  onChange,
  onSave,
  onDisable,
  onEnable,
  onDelete,
  onResetPassword,
}: AnchorAccountDrawerProps) {
  if (!anchor || !editing) return null;

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* 抽屉 */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-[500px] max-w-full flex-col bg-white shadow-2xl">
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{anchor.nickname}</h3>
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${statusClass[anchor.status]}`}>
              {statusLabel[anchor.status]}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 只读信息 */}
          <div className="rounded-2xl bg-slate-50 p-4 space-y-2 text-sm text-slate-600">
            <p><span className="text-slate-400 mr-2">手机号</span>{anchor.boundUser?.phone || "未绑定账号"}</p>
            <p><span className="text-slate-400 mr-2">绑定账号</span>{anchor.boundUserId ? "已绑定" : "未绑定"}</p>
          </div>

          {/* 编辑表单 */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">编辑资料</p>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="主播昵称"
                value={editing.nickname}
                readOnly={readOnly}
                onChange={(nickname) => onChange({ ...editing, nickname })}
              />
              <TextField
                label="抖音号"
                value={editing.douyinNo ?? ""}
                readOnly={readOnly}
                onChange={(douyinNo) => onChange({ ...editing, douyinNo })}
              />
              <TextField
                label="抖音 UID"
                value={editing.douyinUid}
                readOnly={readOnly}
                onChange={(douyinUid) => onChange({ ...editing, douyinUid })}
              />

              {/* 三级联动归属厅选择 */}
              <CascadeHallPicker
                orgs={orgs}
                hallOrgId={editing.hallOrgId}
                disabled={readOnly}
                onChange={(hallOrgId) => onChange({ ...editing, hallOrgId })}
              />
            </div>

            {readOnly ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                当前身份仅可查看主播账号信息，不能修改资料或执行账号操作。
              </div>
            ) : (
              <div className="mt-4 flex justify-end">
                <button
                  className="rounded-2xl bg-feishu-blue px-5 py-2 text-sm font-medium text-white hover:opacity-90 transition"
                  onClick={onSave}
                >
                  保存资料
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 底部操作按钮 */}
        {!readOnly && (
          <div className="border-t border-slate-100 px-6 py-4 flex flex-wrap gap-2">
            {anchor.status === "inactive" ? (
              <button
                className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-100 transition"
                onClick={onEnable}
              >
                启用账号
              </button>
            ) : (
              <button
                className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-600 hover:bg-red-100 transition"
                onClick={onDisable}
              >
                停用账号
              </button>
            )}
            {onResetPassword && (
              <button
                className="rounded-2xl bg-feishu-blue px-4 py-2 text-sm text-white hover:opacity-90 transition"
                title="将登录密码重置为 123456"
                onClick={onResetPassword}
              >
                重置密码
              </button>
            )}
            <button
              className="ml-auto rounded-2xl bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600 transition"
              onClick={onDelete}
            >
              删除档案
            </button>
          </div>
        )}
      </div>
    </>
  );
}
