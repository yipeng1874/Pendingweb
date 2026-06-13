import { useAuthStore } from "../stores/authStore";
import { useIdentityStore } from "../stores/identityStore";

const roleNames: Record<string, string> = {
  DEV_ADMIN: "开发管理员",
  HQ_ADMIN: "公司总部",
  BASE_ADMIN: "基地运营",
  TEAM_ADMIN: "团队运营",
  HALL_MANAGER: "厅管理",
  ANCHOR: "主播",
};

export function IdentitySwitcher() {
  const identities = useAuthStore((state) => state.identities);
  const current = useIdentityStore((state) => state.currentIdentity);
  const setIdentity = useIdentityStore((state) => state.setIdentity);

  return (
    <select
      className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-feishu-blue"
      value={current?.id ?? ""}
      onChange={(event) => {
        const next = identities.find((item) => item.id === event.target.value);
        if (next) setIdentity(next);
      }}
    >
      {identities.map((identity) => (
        <option key={identity.id} value={identity.id}>
          {roleNames[identity.roleCode]} · {identity.org?.name ?? identity.scopePath ?? "个人身份"}
        </option>
      ))}
    </select>
  );
}
