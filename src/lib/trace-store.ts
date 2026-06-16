import { TraceGroup } from "@/types";

type TraceListener = (groups: TraceGroup[]) => void;

/**
 * Collects every protocol event (incoming + outgoing) and groups
 * consecutive TOKEN events into batches for the trace timeline.
 *
 * Uses requestAnimationFrame batching so that even at 30+ tokens/sec,
 * React subscribers are notified at most once per paint frame.
 */
export class TraceStore {
  private groups: TraceGroup[] = [];
  private listeners = new Set<TraceListener>();
  private isUpdateScheduled = false;
  private animationFrameId: number | null = null;

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Record a protocol event.
   * TOKEN events (direction "in") are automatically batched into
   * consecutive groups; everything else becomes a standalone row.
   */
  push(
    eventType: string,
    direction: "in" | "out",
    payload: Record<string, unknown>
  ) {
    const now = Date.now();

    if (eventType === "TOKEN" && direction === "in") {
      this.appendToken(payload, now);
    } else {
      this.appendEvent(eventType, direction, payload, now);
    }

    this.scheduleNotify();
  }

  subscribe(listener: TraceListener) {
    this.listeners.add(listener);
    listener([...this.groups]);
    return () => this.listeners.delete(listener);
  }

  reset() {
    this.groups = [];
    this.scheduleNotify();
  }

  destroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
  }

  getGroups(): TraceGroup[] {
    return this.groups;
  }

  // ─── Token Batching ────────────────────────────────────────────

  private appendToken(payload: Record<string, unknown>, now: number) {
    const streamId = payload.stream_id as string;
    const text = payload.text as string;
    const seq = payload.seq as number;

    const last = this.groups[this.groups.length - 1];

    if (last && last.kind === "token_batch" && last.streamId === streamId) {
      // Extend current batch — create a NEW reference so React.memo
      // picks up the change for just this one row.
      this.groups[this.groups.length - 1] = {
        ...last,
        tokenCount: last.tokenCount + 1,
        fullText: last.fullText + text,
        endSeq: seq,
        endTime: now,
      };
    } else {
      // Start a fresh batch
      this.groups.push({
        id: crypto.randomUUID(),
        kind: "token_batch",
        streamId,
        tokenCount: 1,
        fullText: text,
        startSeq: seq,
        endSeq: seq,
        startTime: now,
        endTime: now,
      });
    }
  }

  // ─── Single Event Handling ─────────────────────────────────────

  private appendEvent(
    eventType: string,
    direction: "in" | "out",
    payload: Record<string, unknown>,
    now: number
  ) {
    let summary = eventType;
    let callId: string | undefined;
    let streamId: string | undefined;

    switch (eventType) {
      case "TOOL_CALL":
        summary = `TOOL_CALL: ${payload.tool_name}`;
        callId = payload.call_id as string;
        streamId = payload.stream_id as string;
        break;
      case "TOOL_RESULT":
        summary = `TOOL_RESULT`;
        callId = payload.call_id as string;
        streamId = payload.stream_id as string;
        break;
      case "TOOL_ACK":
        summary = `ACK → ${(payload.call_id as string).slice(0, 12)}`;
        callId = payload.call_id as string;
        break;
      case "PING":
        summary = `PING`;
        break;
      case "PONG":
        summary = `PONG`;
        break;
      case "STREAM_END":
        summary = `Stream ended`;
        streamId = payload.stream_id as string;
        break;
      case "RESUME":
        summary = `RESUME from seq ${payload.last_seq}`;
        break;
      case "USER_MESSAGE": {
        const content = payload.content as string;
        summary = `"${content.length > 60 ? content.slice(0, 60) + "…" : content}"`;
        break;
      }
      case "CONTEXT_SNAPSHOT":
        summary = `Context snapshot`;
        streamId = payload.stream_id as string;
        break;
      case "ERROR":
        summary = `Error: ${payload.message || "unknown"}`;
        break;
    }

    this.groups.push({
      id: crypto.randomUUID(),
      kind: "event",
      eventType,
      direction,
      seq: payload.seq as number | undefined,
      streamId,
      callId,
      timestamp: now,
      summary,
      detail: payload,
    });
  }

  // ─── Batched Notification ──────────────────────────────────────

  private scheduleNotify() {
    if (this.isUpdateScheduled) return;
    this.isUpdateScheduled = true;
    this.animationFrameId = requestAnimationFrame(() => {
      // Shallow copy — individual group objects keep their references
      // unless they were replaced (active token batch).
      const snapshot = [...this.groups];
      this.listeners.forEach((l) => l(snapshot));
      this.isUpdateScheduled = false;
      this.animationFrameId = null;
    });
  }
}
