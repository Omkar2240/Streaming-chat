"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { StreamMachine } from "@/lib/stream-machine";
import { TraceStore } from "@/lib/trace-store";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Block } from "@/types";
import TraceTimeline from "@/components/TraceTimeline";

export default function RenderChat({
  wsUrl,
}: {
  wsUrl: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExperiencingLag, setIsExperiencingLag] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(true);

  // ─── Highlight state for bidirectional click navigation ────────
  const [highlightedCallId, setHighlightedCallId] = useState<string | null>(null);
  const [highlightedStreamId, setHighlightedStreamId] = useState<string | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearHighlight = useCallback(() => {
    setHighlightedCallId(null);
    setHighlightedStreamId(null);
  }, []);

  const setHighlightWithTimeout = useCallback(
    (opts: { callId?: string; streamId?: string }) => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedCallId(opts.callId ?? null);
      setHighlightedStreamId(opts.streamId ?? null);
      highlightTimerRef.current = setTimeout(clearHighlight, 3000);
    },
    [clearHighlight]
  );

  // ─── Core instances ────────────────────────────────────────────
  const machineRef = useRef<StreamMachine>(new StreamMachine());
  const traceStoreRef = useRef<TraceStore>(new TraceStore());

  const {
    sendMessage,
    isConnected,
    triggerConnect,
    connectionState,
  } = useWebSocket(
    wsUrl,
    machineRef.current,
    traceStoreRef.current
  );

  useEffect(() => {
    const unsubscribe = machineRef.current.subscribe(setBlocks);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const lastActivity = machineRef.current.getLastActivity();
      const isActive = machineRef.current.getIsStreamActive();

      if (!isActive || lastActivity === 0) {
        setIsProcessing(false);
        setIsExperiencingLag(false);
        return;
      }

      const timeSinceLastActivity = Date.now() - lastActivity;
      setIsProcessing(isActive);

      if (isActive && timeSinceLastActivity > 3500) {
        setIsExperiencingLag(true);
      } else {
        setIsExperiencingLag(false);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  // ─── Send handler ──────────────────────────────────────────────
  const handleSend = () => {
    const message = input.trim();
    if (!message) return;

    (machineRef.current as any).blocks.push({
      id: crypto.randomUUID(),
      type: "user",
      content: message,
    });

    machineRef.current.resetStreamStateForNewMessage();
    setIsProcessing(true);
    (machineRef.current as any).notify();

    const sent = sendMessage(message);
    if (sent) {
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── Bidirectional navigation: Trace → Chat ────────────────────
  const handleNavigateToBlock = useCallback(
    (opts: { callId?: string; streamId?: string }) => {
      setHighlightWithTimeout(opts);

      // Scroll the matching chat block into view
      requestAnimationFrame(() => {
        let el: Element | null = null;
        if (opts.callId) {
          el = document.querySelector(`[data-block-call-id="${opts.callId}"]`);
        } else if (opts.streamId) {
          el = document.querySelector(`[data-block-stream-id="${opts.streamId}"]`);
        }
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [setHighlightWithTimeout]
  );

  // ─── Bidirectional navigation: Chat → Trace ────────────────────
  const handleBlockClick = useCallback(
    (block: Block) => {
      if (block.type === "tool") {
        setHighlightWithTimeout({ callId: block.callId });
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-trace-call-id="${block.callId}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      } else if (block.type === "text") {
        setHighlightWithTimeout({ streamId: block.streamId });
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-trace-stream-id="${block.streamId}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    },
    [setHighlightWithTimeout]
  );

  // ─── Highlight check for blocks ────────────────────────────────
  const isBlockHighlighted = (block: Block): boolean => {
    if (block.type === "tool" && highlightedCallId === block.callId) return true;
    if (block.type === "text" && highlightedStreamId === block.streamId) return true;
    return false;
  };

  return (
    <div className="flex h-full w-full">
      {/* ═══════════ Chat Area ═══════════ */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-900">
        {/* ── Header Bar ── */}
        <div className="h-14 border-b dark:border-gray-800 flex items-center px-5 justify-between shrink-0 bg-white dark:bg-gray-900">
          <h1 className="font-bold text-lg text-gray-900 dark:text-white">
            Stream Engine
          </h1>
          <div className="flex items-center gap-3">
            {/* Connection indicator */}
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  connectionState === "connected"
                    ? "bg-emerald-400"
                    : connectionState === "reconnecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-red-400 animate-ping"
                }`}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                {connectionState}
              </span>
            </div>

            {/* Trace toggle */}
            <button
              onClick={() => setIsTraceOpen(!isTraceOpen)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                transition-all duration-200 border
                ${isTraceOpen
                  ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700"
                }
              `}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Trace
            </button>
          </div>
        </div>

        {/* ── Messages Scroll Area ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {blocks.map((block: Block) => {
            if (block.type === "user") {
              return (
                <div key={block.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-blue-500 text-white text-sm whitespace-pre-wrap shadow-sm">
                    {block.content}
                  </div>
                </div>
              );
            }

            if (block.type === "text") {
              const highlighted = isBlockHighlighted(block);
              return (
                <div
                  key={block.id}
                  data-block-stream-id={block.streamId}
                  className={`flex justify-start cursor-pointer transition-all duration-300 rounded-lg ${
                    highlighted ? "ring-2 ring-indigo-400/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-2 -m-2" : ""
                  }`}
                  onClick={() => handleBlockClick(block)}
                >
                  <div className="max-w-[90%] mb-2 whitespace-pre-wrap text-gray-800 dark:text-gray-100 text-sm leading-relaxed">
                    {block.content}
                  </div>
                </div>
              );
            }

            // Tool block
            const isRunning = block.status === "running";
            const highlighted = isBlockHighlighted(block);
            return (
              <div
                key={block.id}
                data-block-call-id={block.callId}
                data-block-stream-id={block.streamId}
                className={`my-2 p-3 rounded-xl border min-h-[48px] text-sm transition-all cursor-pointer ${
                  isRunning
                    ? "border-l-4 border-l-amber-500 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                    : "border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/50"
                } ${highlighted ? "ring-2 ring-indigo-400/50 shadow-lg shadow-indigo-500/10" : ""}`}
                style={{ contain: "layout style" }}
                onClick={() => handleBlockClick(block)}
              >
                <div className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
                  {isRunning && (
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-amber-500 border-t-transparent" />
                  )}
                  <span>Agent Tool: {block.toolName}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
                    ({block.status})
                  </span>
                </div>

                <pre className="mt-2 font-mono text-xs bg-black/[0.03] dark:bg-black/30 p-2 rounded-lg overflow-x-auto text-gray-600 dark:text-gray-400 max-h-40">
                  {JSON.stringify(block.args, null, 2)}
                </pre>

                {block.result && (
                  <pre className="mt-2 font-mono text-xs bg-black/[0.03] dark:bg-black/40 p-2 rounded-lg overflow-x-auto text-emerald-700 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-950/50 max-h-60">
                    {JSON.stringify(block.result, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}

          {/* Processing indicator */}
          {isConnected && connectionState === "connected" && isProcessing && (
            <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 transition-all">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                <div className={`h-2 w-2 rounded-full ${isExperiencingLag ? 'bg-amber-500 animate-ping' : 'bg-blue-500 animate-pulse'}`} />
                <span>
                  {isExperiencingLag
                    ? "Experiencing server latency, waiting for stream packets..."
                    : "AI is thinking..."}
                </span>
              </div>
              <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-pulse w-1/3" />
              </div>
            </div>
          )}

          {/* Reconnecting banner */}
          {connectionState === "reconnecting" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:bg-amber-950/20 dark:border-amber-900/50">
              <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-400">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
                Connecting to the server...
              </div>
            </div>
          )}

          {/* Offline banner */}
          {connectionState === "offline" && (
            <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 dark:bg-red-950/20 dark:border-red-900/50">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-600 animate-ping" />
                Your internet is disconnected.
              </div>
              <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-1">
                Streaming will automatically pick up from where it ended once your connection returns.
              </p>
              <button
                onClick={triggerConnect}
                className="mt-3 rounded-lg bg-red-600 hover:bg-red-700 transition-colors px-3 py-1.5 text-white text-xs font-medium shadow-sm"
              >
                Retry Now
              </button>
            </div>
          )}
        </div>

        {/* ── Input Form Area ── */}
        <div className="border-t dark:border-gray-800 p-4 bg-white dark:bg-gray-900 shrink-0">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 rounded-lg border dark:border-gray-700 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400 transition-shadow"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ Trace Timeline Panel ═══════════ */}
      <TraceTimeline
        traceStore={traceStoreRef.current}
        isOpen={isTraceOpen}
        onClose={() => setIsTraceOpen(false)}
        onNavigateToBlock={handleNavigateToBlock}
        highlightedCallId={highlightedCallId}
        highlightedStreamId={highlightedStreamId}
      />
    </div>
  );
}