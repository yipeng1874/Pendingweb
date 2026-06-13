import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, LogOut, UserRound } from "lucide-react";
import { useAuthStore } from "../stores/auth";

export function IdentityPage() {
  const navigate = useNavigate();
  const identities = useAuthStore((state) => state.identities);
  const user = useAuthStore((state) => state.user);
  const setCurrentIdentity = useAuthStore((state) => state.setCurrentIdentity);
  const logout = useAuthStore((state) => state.logout);

  const sorted = useMemo(() => [...identities], [identities]);

  function chooseIdentity(identityId: string) {
    const target = identities.find((item) => item.id === identityId);
    if (!target) return;
    setCurrentIdentity(target);
    navigate("/todos", { replace: true });
  }

  return (
    <div className="page-shell">
      <div className="mobile-page bottom-safe">
        <div className="hero-panel">
          <div className="hero-kicker"><UserRound size={14} /> 身份切换</div>
          <h1 className="hero-title">请选择这次进入待办的身份。</h1>
          <p className="hero-subtitle">同一账号可能拥有多个组织或角色身份，进入后你看到的待办、权限与协同内容会随身份变化。</p>
        </div>

        <div className="section" style={{ paddingTop: 0 }}>
          <div className="topbar" style={{ alignItems: "center" }}>
            <div>
              <p className="card-title" style={{ marginBottom: 4 }}>{user?.nickname ?? user?.phone ?? "当前账号"}</p>
              <p className="card-subtitle">请选择身份后进入专属待办</p>
            </div>
            <button className="btn btn-ghost icon-btn" onClick={() => { logout(); navigate("/login", { replace: true }); }}>
              <LogOut size={18} />
            </button>
          </div>

          <div className="list">
            {sorted.map((identity) => (
              <button key={identity.id} className="todo-card-button" onClick={() => chooseIdentity(identity.id)}>
                <div className="card identity-card card-strong">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>{identity.anchorProfile?.nickname || identity.org?.name || identity.roleCode}</div>
                      <div className="identity-role">{identity.roleCode}</div>
                      {identity.org?.name ? <div className="identity-org">{identity.org.name} · {identity.org.orgType}</div> : null}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="tag tag-blue">进入</span>
                      <ChevronRight size={18} color="#64748b" />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
