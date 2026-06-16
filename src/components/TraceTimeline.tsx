"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { TraceGroup } from "@/types";
import { TraceStore } from "@/lib/trace-store";

// ─── Event type visual config ────────────────────────────────────

const EVENT_CONFIG: Record<string, { color: string; label: string }> = {
  TOKEN:            { color: "#818cf8", label: "TOKEN" },
  TOOL_CALL:        { color: "#fbbf24", label: "TOOL_CALL" },
  TOOL_RESULT:      { color: "#34d399", label: "TOOL_RESULT" },
  TOOL_ACK:         { color: "#2dd4bf", label: "ACK" },
  PING:             { color: "#6b7280", label: "PING" },
  PONG:             { color: "#6b7280", label: "PONG" },
  STREAM_END:       { color: "#a78bfa", label: "END" },
  USER_MESSAGE:     { color: "#60a5fa", label: "USER" },
  RESUME:           { color: "#facc15", label: "RESUME" },
  CONTEXT_SNAPSHOT: { color: "#22d3ee", label: "CONTEXT" },
  ERROR:            { color: "#f87171", label: "ERROR" },
};

// Consistent color per callId so TOOL_CALL and TOOL_RESULT share a visual link
const LINK_PALETTE = [
  "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4",
  "#f97316", "#6366f1", "#14b8a6", "#ef4444", "#84cc16",
];

function hashCallId(callId: string): string {
  let hash = 0;
  for (let i = 0; i < callId.length; i++) {
    hash = ((hash << 5) - hash) + callId.charCodeAt(i);
    hash |= 0;
  }
  return LINK_PALETTE[Math.abs(hash) % LINK_PALETTE.length];
}

// ─── Formatting helpers ──────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── All event types we can filter on ────────────────────────────

const ALL_FILTER_TYPES = [
  "TOKEN", "TOOL_CALL", "TOOL_RESULT", "TOOL_ACK",
  "PING", "PONG", "STREAM_END", "USER_MESSAGE",
  "RESUME", "CONTEXT_SNAPSHOT", "ERROR",
];

// ─── Memoized Row Component ─────────────────────────────────────

interface TraceRowProps {
  group: TraceGroup;
  isExpanded: boolean;
  isHighlighted: boolean;
  onToggle: () => void;
  onClick: () => void;
}

const TraceRow = React.memo(function TraceRow({
  group,
  isExpanded,
  isHighlighted,
  onToggle,
  onClick,
}: TraceRowProps) {
  if (group.kind === "token_batch") {
    return (
      <TokenBatchRow
        group={group}
        isExpanded={isExpanded}
        isHighlighted={isHighlighted}
        onToggle={onToggle}
        onClick={onClick}
      />
    );
  }
  return (
    <EventRow
      group={group}
      isExpanded={isExpanded}
      isHighlighted={isHighlighted}
      onToggle={onToggle}
      onClick={onClick}
    />
  );
});

// ─── Token Batch Row ─────────────────────────────────────────────

function TokenBatchRow({
  group,
  isExpanded,
  isHighlighted,
  onToggle,
  onClick,
}: {
  group: TraceGroup & { kind: "token_batch" };
  isExpanded: boolean;
  isHighlighted: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const duration = group.endTime - group.startTime;
  const cfg = EVENT_CONFIG.TOKEN;

  return (
    <div
      data-trace-stream-id={group.streamId}
      data-trace-id={group.id}
      className={`
        border-l-[3px] rounded-r-md px-3 py-2 cursor-pointer
        transition-all duration-200
        ${isHighlighted ? "bg-indigo-500/15 ring-1 ring-indigo-400/40" : "hover:bg-white/[0.04]"}
      `}
      style={{
        borderLeftColor: cfg.color,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 52px",
      }}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="text-slate-500 hover:text-slate-300 text-xs shrink-0 w-4 text-center transition-transform"
          style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
        >
          ▶
        </button>

        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: cfg.color }}
        />

        <span className="text-[13px] text-slate-200 font-medium truncate">
          Streamed {group.tokenCount} token{group.tokenCount !== 1 ? "s" : ""}
          <span className="text-slate-500 font-normal ml-1">
            ({formatDuration(duration)})
          </span>
        </span>

        <span className="ml-auto text-[10px] text-slate-600 font-mono shrink-0">
          {formatTimestamp(group.startTime)}
        </span>
      </div>

      {/* Seq info */}
      <div className="text-[10px] text-slate-600 mt-0.5 ml-6 flex gap-2">
        <span>seq {group.startSeq}–{group.endSeq}</span>
        <span>·</span>
        <span className="truncate">{group.streamId.slice(0, 12)}</span>
      </div>

      {/* Expanded: full text */}
      {isExpanded && (
        <pre className="mt-2 ml-6 text-[11px] text-slate-400 bg-black/30 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono border border-slate-800">
          {group.fullText}
        </pre>
      )}
    </div>
  );
}

// ─── Single Event Row ────────────────────────────────────────────

function EventRow({
  group,
  isExpanded,
  isHighlighted,
  onToggle,
  onClick,
}: {
  group: TraceGroup & { kind: "event" };
  isExpanded: boolean;
  isHighlighted: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const cfg = EVENT_CONFIG[group.eventType] ?? { color: "#9ca3af", label: group.eventType };
  const hasDetail = !!(group.detail && Object.keys(group.detail as object).length > 0);
  const isToolLinked = group.callId != null;

  // Tool-linked events get a unique left border color based on callId
  const borderColor = isToolLinked ? hashCallId(group.callId!) : cfg.color;

  return (
    <div
      data-trace-call-id={group.callId}
      data-trace-stream-id={group.streamId}
      data-trace-id={group.id}
      className={`
        border-l-[3px] rounded-r-md px-3 py-2 cursor-pointer
        transition-all duration-200
        ${isHighlighted ? "bg-indigo-500/15 ring-1 ring-indigo-400/40" : "hover:bg-white/[0.04]"}
      `}
      style={{
        borderLeftColor: borderColor,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 44px",
      }}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2 min-w-0">
        {hasDetail ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="text-slate-500 hover:text-slate-300 text-xs shrink-0 w-4 text-center transition-transform"
            style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
          >
            ▶
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: cfg.color }}
        />

        {/* Direction arrow */}
        <span className="text-[10px] text-slate-600 shrink-0">
          {group.direction === "in" ? "←" : "→"}
        </span>

        <span className="text-[13px] text-slate-200 truncate">
          {group.summary}
        </span>

        {group.seq != null && (
          <span className="text-[10px] text-slate-600 font-mono shrink-0">
            seq {group.seq}
          </span>
        )}

        <span className="ml-auto text-[10px] text-slate-600 font-mono shrink-0">
          {formatTimestamp(group.timestamp)}
        </span>
      </div>

      {/* Call ID link badge for tool events */}
      {isToolLinked && (
        <div className="mt-0.5 ml-6 flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: borderColor }}
          />
          <span className="text-[10px] font-mono" style={{ color: borderColor }}>
            {group.callId!.slice(0, 16)}
          </span>
        </div>
      )}

      {/* Expanded: full detail */}
      {isExpanded && hasDetail && (
        <pre className="mt-2 ml-6 text-[11px] text-slate-400 bg-black/30 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono border border-slate-800">
          {JSON.stringify(group.detail as Record<string, unknown>, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Main TraceTimeline Panel ────────────────────────────────────

interface TraceTimelineProps {
  traceStore: TraceStore;
  isOpen: boolean;
  onClose: () => void;
  /** Scroll the chat panel to a block matching this identifier */
  onNavigateToBlock?: (opts: { callId?: string; streamId?: string }) => void;
  highlightedCallId?: string | null;
  highlightedStreamId?: string | null;
}

export default function TraceTimeline({
  traceStore,
  isOpen,
  onClose,
  onNavigateToBlock,
  highlightedCallId,
  highlightedStreamId,
}: TraceTimelineProps) {
  const [groups, setGroups] = useState<TraceGroup[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    () => new Set(ALL_FILTER_TYPES)
  );
  const [searchQuery, setSearchQuery] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Subscribe to trace store
  useEffect(() => {
    const unsubscribe = traceStore.subscribe(setGroups);
    return () => { unsubscribe(); };
  }, [traceStore]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [groups]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollHeight, scrollTop, clientHeight } = scrollRef.current;
      shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 60;
    }
  }, []);

  // ─── Filtering ─────────────────────────────────────────────────

  const filteredGroups = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return groups.filter((g) => {
      // Type filter
      if (g.kind === "token_batch") {
        if (!activeFilters.has("TOKEN")) return false;
      } else {
        if (!activeFilters.has(g.eventType)) return false;
      }
      // Search filter
      if (query) {
        if (g.kind === "token_batch") {
          return g.fullText.toLowerCase().includes(query);
        }
        return g.summary.toLowerCase().includes(query);
      }
      return true;
    });
  }, [groups, activeFilters, searchQuery]);

  // ─── Expand / Collapse ─────────────────────────────────────────

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Filter Toggle ─────────────────────────────────────────────

  const toggleFilter = useCallback((type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // ─── Click Handler → navigate to chat block ───────────────────

  const handleRowClick = useCallback(
    (group: TraceGroup) => {
      if (!onNavigateToBlock) return;

      if (group.kind === "token_batch") {
        onNavigateToBlock({ streamId: group.streamId });
      } else if (group.callId) {
        onNavigateToBlock({ callId: group.callId });
      } else if (group.streamId) {
        onNavigateToBlock({ streamId: group.streamId });
      }
    },
    [onNavigateToBlock]
  );

  // ─── Highlight check ──────────────────────────────────────────

  const isHighlighted = useCallback(
    (group: TraceGroup): boolean => {
      if (group.kind === "token_batch") {
        return highlightedStreamId === group.streamId;
      }
      if (group.kind === "event") {
        if (highlightedCallId && group.callId === highlightedCallId) return true;
        if (highlightedStreamId && group.streamId === highlightedStreamId) return true;
      }
      return false;
    },
    [highlightedCallId, highlightedStreamId]
  );

  const eventCount = groups.length;

  return (
    <div
      className={`
        flex flex-col h-full bg-[#0c1222] border-l border-slate-800
        transition-all duration-300 ease-in-out overflow-hidden shrink-0
        ${isOpen ? "w-[420px]" : "w-0 border-l-0"}
      `}
    >
      {/* ── Panel Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <h2 className="text-sm font-semibold text-slate-200">
            Agent Trace
          </h2>
          <span className="text-[10px] text-slate-600 font-mono">
            {eventCount} event{eventCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => traceStore.reset()}
            className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-white/5 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-white/5 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600"
            width="13" height="13" viewBox="0 0 16 16" fill="none"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events..."
            className="w-full bg-slate-900 border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-slate-600 transition-colors"
          />
        </div>
      </div>

      {/* ── Filter Pills ── */}
      <div className="px-3 pb-2 flex flex-wrap gap-1 shrink-0">
        {ALL_FILTER_TYPES.map((type) => {
          const cfg = EVENT_CONFIG[type] ?? { color: "#9ca3af", label: type };
          const isActive = activeFilters.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleFilter(type)}
              className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                transition-all duration-150 border
                ${isActive
                  ? "border-transparent text-white"
                  : "border-slate-800 text-slate-600 hover:text-slate-400"
                }
              `}
              style={isActive ? {
                backgroundColor: cfg.color + "22",
                color: cfg.color,
                borderColor: cfg.color + "44",
              } : undefined}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: isActive ? cfg.color : "#475569" }}
              />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* ── Scrollable Timeline ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden space-y-px min-h-0"
      >
        {filteredGroups.length === 0 && (
          <div className="text-center text-slate-600 text-xs py-12">
            {groups.length === 0
              ? "Waiting for events…"
              : "No events match filters"
            }
          </div>
        )}

        {filteredGroups.map((group) => (
          <TraceRow
            key={group.id}
            group={group}
            isExpanded={expandedIds.has(group.id)}
            isHighlighted={isHighlighted(group)}
            onToggle={() => toggleExpand(group.id)}
            onClick={() => handleRowClick(group)}
          />
        ))}
      </div>

      {/* ── Footer: event rate ── */}
      <div className="px-4 py-2 border-t border-slate-800 shrink-0">
        <div className="flex items-center justify-between text-[10px] text-slate-600">
          <span>{filteredGroups.length} / {groups.length} shown</span>
          <span className="font-mono">
            {groups.length > 0 && groups[groups.length - 1].kind === "token_batch"
              ? `${(groups[groups.length - 1] as TraceGroup & { kind: "token_batch" }).tokenCount} tokens in last batch`
              : "idle"
            }
          </span>
        </div>
      </div>
    </div>
  );
}
