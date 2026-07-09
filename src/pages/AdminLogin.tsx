/**
 * Admin Login Page — Discreet access to the admin dashboard.
 * Accessed via a tiny link on the bottom of the login page.
 *
 * Stores the session token in localStorage so the AdminDashboard
 * can authenticate even when Secure cookies are rejected (HTTP dev env).
 */

import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";

const ADMIN_TOKEN_KEY = "mikweb_admin_token";

export default function AdminLogin() {
  const navigate = useNavigate();

  // TEST MODE: Bypass password check — go directly to the admin dashboard.
  // TODO: Restore password verification before deploying to production.
  useEffect(() => {
    localStorage.setItem(ADMIN_TOKEN_KEY, "test-admin-token");
    navigate("/admin/dashboard", { replace: true });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
