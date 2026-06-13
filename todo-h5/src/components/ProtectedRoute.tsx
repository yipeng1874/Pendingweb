import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const token = useAuthStore((state) => state.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}
