import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { useIdentityStore } from "../../stores/identityStore";

export function IdentityPage() {
  const identities = useAuthStore((state) => state.identities);
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F5F7FA] p-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold text-slate-950">选择当前身份</h1>
        <p className="mt-2 text-slate-500">菜单和数据范围会根据身份实时切换。</p>
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {identities.map((identity) => (
            <button key={identity.id} className="cursor-pointer rounded-[28px] border border-white bg-white p-6 text-left shadow-card transition hover:-translate-y-1 hover:border-feishu-blue" onClick={() => { setIdentity(identity); navigate("/tasks/dashboard"); }}>
              <p className="text-sm font-medium text-feishu-blue">{identity.roleCode}</p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">{identity.org?.name ?? identity.scopePath}</h2>
              <p className="mt-4 text-sm leading-6 text-slate-500">数据范围：{identity.scopePath ?? "仅个人"}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
