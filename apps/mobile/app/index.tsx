import { Redirect } from "expo-router";
import { useAuth } from "@stinventory/frontend-shared/auth";

export default function Index() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  return <Redirect href={isAuthenticated ? "/dashboard" : "/login"} />;
}
