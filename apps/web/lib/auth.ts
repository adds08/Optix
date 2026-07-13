export function login(email: string, password: string) {
  return fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100"}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error("Login failed"))));
}

export function logout() {
  const token = localStorage.getItem("sti-session");
  return fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100"}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getSession() {
  return localStorage.getItem("sti-session");
}
export function setSession(token: string) {
  localStorage.setItem("sti-session", token);
}
export function clearSession() {
  localStorage.removeItem("sti-session");
}
