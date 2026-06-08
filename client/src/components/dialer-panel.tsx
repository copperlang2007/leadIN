// Wave 6b (K3) — Slide-out dialer panel anchored to the lead-details dialog.
//
// Renders: a "Call now" button (POST /api/dialer/call), live transcript
// view (POST /api/dialer/transcript for stub testing in dev), and the
// streaming AI suggestion list driven by the `assist_suggestion`
// WebSocket event.

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Sparkles, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";

interface DialerPanelProps {
  leadId: number;
  open: boolean;
  onClose: () => void;
}

interface AssistSuggestion {
  id: string;
  suggestion: string;
  triggerPhrase: string;
  at: Date;
}

interface CallStartResult {
  callLogId: number;
  twilioSid: string | null;
  status: string;
  stub: boolean;
}

export function DialerPanel({ leadId, open, onClose }: DialerPanelProps) {
  const [callLogId, setCallLogId] = useState<number | null>(null);
  const [callStatus, setCallStatus] = useState<string>("idle");
  const [isCalling, setIsCalling] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [suggestions, setSuggestions] = useState<AssistSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dncBlocked, setDncBlocked] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const callLogIdRef = useRef<number | null>(null);
  // Avoid bare-DOM globals in eslint config — let TS infer from the JSX ref.
  const transcriptInputRef = useRef<any>(null);

  // Keep ref in sync so the ws onmessage handler reads the latest value.
  useEffect(() => {
    callLogIdRef.current = callLogId;
  }, [callLogId]);

  // Open a dedicated WS while the panel is open. We intentionally don't
  // reuse the shared lead-feed socket because suggestion volume can be
  // higher and we want to scope listeners to this panel's lifetime.
  useEffect(() => {
    if (!open) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "assist_suggestion") return;
        if (callLogIdRef.current && data.callLogId !== callLogIdRef.current) return;
        setSuggestions((prev) => [
          {
            id: `${data.callLogId}-${Date.now()}-${Math.random()}`,
            suggestion: data.suggestion,
            triggerPhrase: data.triggerPhrase,
            at: new Date(),
          },
          ...prev,
        ]);
      } catch {
        /* ignore parse errors */
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [open]);

  // Reset state when the panel closes so reopening for another lead is clean.
  useEffect(() => {
    if (!open) {
      setCallLogId(null);
      setCallStatus("idle");
      setTranscript("");
      setSuggestions([]);
      setError(null);
      setDncBlocked(null);
    }
  }, [open]);

  async function handleStartCall() {
    setIsCalling(true);
    setError(null);
    setDncBlocked(null);
    try {
      const res = await apiRequest("POST", "/api/dialer/call", { leadId });
      const data: CallStartResult = await res.json();
      setCallLogId(data.callLogId);
      setCallStatus(data.status || "queued");
    } catch (err: any) {
      // `apiRequest` throws `Error("<status>: <body-text>")` on non-2xx. The
      // body is JSON for our routes, so we parse it back out to detect the
      // DNC block reliably and surface the server's reason.
      const message: string = err?.message || "";
      const match = message.match(/^(\d{3}):\s*([\s\S]*)$/);
      const status = match ? Number(match[1]) : undefined;
      let body: { message?: string; dncBlocked?: boolean } | undefined;
      if (match) {
        try {
          body = JSON.parse(match[2]);
        } catch {
          body = undefined;
        }
      }
      if (status === 403 && (body?.dncBlocked || /dnc/i.test(body?.message || message))) {
        setDncBlocked(body?.message || "Phone is on DNC list — call blocked");
      } else {
        setError(message || "Failed to start call");
      }
    } finally {
      setIsCalling(false);
    }
  }

  async function handlePushTranscript() {
    if (!callLogId) return;
    const text = transcriptInputRef.current?.value?.trim();
    if (!text) return;
    try {
      await apiRequest("POST", "/api/dialer/transcript", {
        callLogId,
        text,
        partial: false,
      });
      setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
      if (transcriptInputRef.current) transcriptInputRef.current.value = "";
    } catch (err: any) {
      setError(err?.message || "Failed to push transcript chunk");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background border-l shadow-2xl flex flex-col"
      data-testid="dialer-panel"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Dialer · Lead #{leadId}</h3>
          {callLogId && (
            <Badge variant="outline" className="text-xs">
              {callStatus}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="dialer-close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 border-b">
        {!callLogId ? (
          <Button
            className="w-full gap-2"
            onClick={handleStartCall}
            disabled={isCalling}
            data-testid="dialer-call-now"
          >
            {isCalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            Call now
          </Button>
        ) : (
          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={onClose}
            data-testid="dialer-end-call"
          >
            <PhoneOff className="h-4 w-4" /> End call
          </Button>
        )}
        {error && (
          <p className="text-xs text-destructive mt-2" data-testid="dialer-error">
            {error}
          </p>
        )}
        {dncBlocked && (
          <div
            className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="dialer-dnc-blocked"
            role="alert"
          >
            <strong className="font-semibold">Call blocked: </strong>
            {dncBlocked}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> AI suggestions
        </div>
        <ScrollArea className="px-4 pb-3 max-h-48">
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Suggestions will appear here when the consumer mentions cost, network,
              doctor, side effects, deductibles, or copays.
            </p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="text-sm bg-primary/5 border border-primary/20 rounded p-2"
                  data-testid="dialer-suggestion"
                >
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[10px]">
                      {s.triggerPhrase}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {s.at.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="leading-snug">{s.suggestion}</p>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-t">
          Live transcript
        </div>
        <ScrollArea className="flex-1 px-4 pb-3">
          {transcript ? (
            <pre className="text-xs whitespace-pre-wrap leading-relaxed" data-testid="dialer-transcript">
              {transcript}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Transcript will stream here once the call connects.
            </p>
          )}
        </ScrollArea>

        {callLogId && (
          <div className="border-t p-3 flex gap-2" data-testid="dialer-transcript-injector">
            <input
              ref={transcriptInputRef}
              className="flex-1 text-xs bg-muted/40 rounded px-2 py-1 outline-none"
              placeholder="dev: push transcript line"
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePushTranscript();
              }}
            />
            <Button size="sm" variant="outline" onClick={handlePushTranscript}>
              Push
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
