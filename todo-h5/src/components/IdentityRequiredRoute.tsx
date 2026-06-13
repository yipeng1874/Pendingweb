
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

export function IdentityRequiredRoute({ children }: { children: JSX.Element }) {
  const token = useAuthStore((state) => state.token);
  const currentIdentity = useAuthStore((state) => state.currentIdentity);
  if (!token) return <Navigate to="/login" replace />;
  if (!currentIdentity) return <Navigate to="/identity" replace />;
  return children;
}
