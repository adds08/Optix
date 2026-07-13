"use client";
import { useState, useRef, useEffect } from "react";
import { getApiUrl } from "@/lib/trpc";

type Msg = { role: "user" | "assistant"; text: string; ok?: boolean };

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "Hi! I can help you track tools. Try:\n• \"give UIC-1001 to Miguel\"\n• \"return UIC-1002\"\n• \"UIC-1008 is broken\"" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((p) => [...p, { role: "user", text }]);
    setBusy(true);
    try {
      const token = localStorage.getItem("sti-session");
      const res = await fetch(`${getApiUrl()}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMsgs((p) => [...p, { role: "assistant", text: data.result ?? data.message ?? data.error ?? "Something went wrong", ok: data.ok ?? !data.error }]);
    } catch {
      setMsgs((p) => [...p, { role: "assistant", text: "Couldn't reach the server. Try again.", ok: false }]);
    }
    setBusy(false);
  };

  return (
    <div className={`ai-chat ${open ? "open" : ""}`}>
      <button className="ai-toggle" onClick={() => setOpen(!open)}>
        {open ? "✕" : "🤖"}
      </button>
      {open && (
        <div className="ai-panel">
          <div className="ai-header">AI Assistant</div>
          <div className="ai-msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}${m.ok === false ? " err" : ""}`}>
                {m.text}
              </div>
            ))}
            {busy && <div className="ai-msg assistant">thinking...</div>}
            <div ref={endRef} />
          </div>
          <div className="ai-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type a command..."
              disabled={busy}
            />
            <button onClick={send} disabled={busy || !input.trim()}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
