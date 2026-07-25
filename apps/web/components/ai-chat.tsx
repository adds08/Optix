"use client";
import { useState, useRef, useEffect } from "react";
import { getApiUrl } from "@/lib/trpc";
import { Bot, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type IntentInfo = {
  type: string;
  department: string;
  status: string;
  details?: Record<string, unknown>;
};

type Msg = {
  role: "user" | "assistant";
  text: string;
  ok?: boolean;
  intent?: IntentInfo;
};

const INTENT_LABELS: Record<string, string> = {
  assign: "Assign", return: "Return", transfer: "Transfer",
  lost: "Lost", repair: "Repair", report: "Report",
  task: "Task", request_purchase: "Purchase",
};

const DEPT_BG: Record<string, string> = {
  "Equipment Yard": "bg-blue-600", Warehouse: "bg-green-600",
  Maintenance: "bg-yellow-600", "Equipment Admin": "bg-red-600",
  Fleet: "bg-purple-600", Procurement: "bg-cyan-600",
};

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "Hi! I can help you track tools. Try:\n\u2022 \"give UIC-1001 to Miguel\" \u2014 assign\n\u2022 \"return UIC-1002\" \u2014 return to warehouse\n\u2022 \"UIC-1008 is broken\" \u2014 mark for repair\n\u2022 \"check the generator on Friday\" \u2014 creates a task" },
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
      const msgText = data.result ?? data.message ?? data.error ?? "Something went wrong";
      setMsgs((p) => [...p, {
        role: "assistant", text: msgText,
        ok: data.ok ?? !data.error,
        intent: data.intent ?? undefined,
      }]);
    } catch {
      setMsgs((p) => [...p, { role: "assistant", text: "Couldn't reach the server. Try again.", ok: false }]);
    }
    setBusy(false);
  };

  return (
    <div className={`fixed bottom-6 right-6 z-50 ${open ? "" : ""}`}>
      <Button
        onClick={() => setOpen(!open)}
        size="icon"
        className="h-12 w-12 rounded-full shadow-lg"
        title={open ? "Close assistant" : "Open assistant"}
      >
        {open ? <X size={20} /> : <Bot size={22} />}
      </Button>
      {open && (
        <Card className="absolute bottom-16 right-0 w-[380px] max-w-[calc(100vw-2rem)] shadow-2xl border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
            <Bot size={16} className="text-primary" />
            <span className="text-sm font-semibold">AI Assistant</span>
          </div>
          <div className="h-[380px] overflow-y-auto p-3 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.intent ? (
                  <Card className={`max-w-[90%] ${m.role === "user" ? "bg-muted" : "bg-green-50 border-green-200"}`}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary" className="text-[11px]">{INTENT_LABELS[m.intent.type] ?? m.intent.type}</Badge>
                        <Badge variant="outline" className="text-[11px]">{m.intent.status === "pending_verification" ? "Pending" : m.intent.status}</Badge>
                      </div>
                      <p className="text-sm">{m.text}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold text-white px-2 py-0.5 rounded-full ${DEPT_BG[m.intent.department] ?? "bg-gray-500"}`}>
                          {m.intent.department}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : m.ok === false
                        ? "bg-red-50 border border-red-200 text-red-800"
                        : "bg-muted"
                  }`}>
                    {m.text.split("\n").map((line, j) => <span key={j}>{line}<br /></span>)}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-3.5 py-2.5 text-sm flex items-center gap-2">
                  <Bot size={14} /> Working\u2026
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="flex items-center gap-2 p-3 border-t bg-background">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type a command\u2026"
              disabled={busy}
              className="flex-1"
            />
            <Button size="icon" onClick={send} disabled={busy || !input.trim()}>
              <Send size={16} />
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
