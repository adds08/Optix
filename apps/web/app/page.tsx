"use client";
import { useState } from "react";
import { login, setSession } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@stinventory.local");
  const [password, setPassword] = useState("stinventory-demo");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const res = await login(email, password);
      setSession(res.sessionId);
      router.push("/dashboard");
    } catch {
      setErr("Login failed. Check credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-box">
        <h1>ST<span style={{ color: "var(--accent)" }}>Inventory</span></h1>
        <form onSubmit={submit}>
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {err && <div className="err">{err}</div>}
          <button type="submit" disabled={loading}>{loading ? "…" : "Sign in"}</button>
        </form>
        <div className="hint">
          Demo logins (password: <b>stinventory-demo</b>):<br />
          admin@stinventory.local · owner@stinventory.local<br />
          foreman.miguel@stinventory.local · warehouse@stinventory.local
        </div>
      </div>
    </div>
  );
}
