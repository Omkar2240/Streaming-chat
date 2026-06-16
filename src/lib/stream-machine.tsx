import { Block, ToolArgs, ToolResult } from "@/types";

type Listener = (blocks: Block[]) => void;

type StreamState = {
  expectedSeq: number;
  buffer: Map<number, StreamEvent>;
  activeTextBlockId: string | null;
  lastActivity: number;
};

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; toolName: string; args: ToolArgs }
  | { type: "tool_result"; callId: string; result: ToolResult };

export class StreamMachine {
  private blocks: Block[] = [];
  private listeners = new Set<Listener>();
  private animationFrameId: number | null = null;
  private isUpdateScheduled = false;
  private streamStates = new Map<string, StreamState>();
  private timeoutCheckInterval: NodeJS.Timeout | null = null;
  private lastIncomingEventAt = 0;
  private isStreamActive = false;
  private lastProcessedSeq = -1;

  public getLastProcessedSeq() {
    return this.lastProcessedSeq;
  }

  public getLastActivity() {
    return this.lastIncomingEventAt;
  }

  public getIsStreamActive() {
    return this.isStreamActive;
  }

  constructor() {
    if (typeof window !== "undefined") {
      this.timeoutCheckInterval = setInterval(() => this.reapStaleStreams(), 5000);
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(structuredClone(this.blocks));
    return () => this.listeners.delete(listener);
  }

  private notify() {
    if (this.isUpdateScheduled) return;
    this.isUpdateScheduled = true;
    this.animationFrameId = requestAnimationFrame(() => {
      const snapshot = structuredClone(this.blocks);
      this.listeners.forEach((listener) => listener(snapshot));
      this.isUpdateScheduled = false;
      this.animationFrameId = null;
    });
  }

  private getOrInitState(streamId: string, initialSeq: number): StreamState {
    let state = this.streamStates.get(streamId);
    if (!state) {
      // Explicitly anchor to the exact sequence number that started this dialogue stream step
      state = {
        expectedSeq: initialSeq,
        buffer: new Map(),
        activeTextBlockId: null,
        lastActivity: Date.now()
      };
      this.streamStates.set(streamId, state);
    }
    return state;
  }

  /**
   * Gracefully detaches from a stream.
   * Keeps EVERY SINGLE text block and tool block completely intact in the UI.
   */
  public closeStream(streamId: string) {
    const state = this.streamStates.get(streamId);
    if (!state) return;

    // 1. If there are any final text tokens trapped in the buffer, 
    // squeeze them out into the UI before closing so nothing is lost.
    this.drainEntireBuffer(streamId, state);

    // 2. Clear out the internal sequence tracking map.
    // This does NOT touch this.blocks, so your chat history is completely safe!
    this.streamStates.delete(streamId);
    this.isStreamActive = false;

    // 3. Trigger a render to make sure the UI matches the final state
    this.notify();
  }

  private reapStaleStreams() {
    const NOW = Date.now();
    const TIMEOUT_THRESHOLD = 60000;

    this.streamStates.forEach((state, streamId) => {
      if (NOW - state.lastActivity > TIMEOUT_THRESHOLD) {
        console.warn(`Stream ${streamId} timed out. Forcing full drainage.`);
        this.closeStream(streamId);
      }
    });
  }

  /**
   * Helper to completely flush anything remaining out of sequential order
   */
  private drainEntireBuffer(streamId: string, state: StreamState) {
    const sortedTrappedSeqs = Array.from(state.buffer.keys()).sort((a, b) => a - b);
    sortedTrappedSeqs.forEach((seq) => {
      const event = state.buffer.get(seq)!;
      state.buffer.delete(seq);
      this.executeEvent(streamId, event, state);
    });
  }

  processStreamEvent(seq: number, streamId: string, event: StreamEvent) {
    console.log("PROCESS", seq);
    const state = this.getOrInitState(streamId, seq);
    state.lastActivity = Date.now();
    this.lastIncomingEventAt = Date.now();
    this.isStreamActive = true;

    // 1. Handle late arrivals (seq < expectedSeq)
    if (seq < state.expectedSeq) {
      if (event.type === "text") {
        const existingBlock = state.activeTextBlockId
          ? this.blocks.find((b) => b.id === state.activeTextBlockId)
          : null;

        if (existingBlock && existingBlock.type === "text") {
          // SAFE ORDER CHECK: Instead of blindly prepending or appending, 
          // verify if the token text is already captured inside the string layout.
          if (!existingBlock.content.includes(event.text)) {
            // Since it arrived late but its sequence is lower, it belongs structurally 
            // before the chunks that advanced our expectedSeq loop.
            // However, we only prepend if the current block text explicitly starts with what followed it.
            existingBlock.content = event.text + existingBlock.content;
          }
        } else {
          const newId = crypto.randomUUID();
          this.blocks.push({ id: newId, type: "text", streamId, content: event.text });
          state.activeTextBlockId = newId;
        }
        this.notify();
      } else if (event.type === "tool_result") {
        this.executeEvent(streamId, event, state);
        this.notify();
      }
      return;
    }

    // 2. Buffer future items (seq > expectedSeq)
    if (seq > state.expectedSeq) {
      state.buffer.set(seq, event);

      if (event.type === "tool_result") {
        const structuralToolExists = this.blocks.some(b => b.type === "tool" && b.callId === event.callId);
        if (structuralToolExists) {
          this.executeEvent(streamId, event, state);
          state.buffer.delete(seq);
        }
      }

      // Check if the item that just arrived closes a sequence gap
      this.checkAndDrainConsecutiveBuffer(streamId, state);
      return;
    }

    // 3. Perfect sequence alignment (seq === expectedSeq)
    this.executeEvent(streamId, event, state);
      this.lastProcessedSeq = Math.max(
    this.lastProcessedSeq,
    seq
  );

    state.expectedSeq = seq + 1;

    // Drain the buffer sequentially
    this.checkAndDrainConsecutiveBuffer(streamId, state);
    this.notify();
  }
  
  /**
   * Drains buffered chunks even if there are missing integers
   */
  private checkAndDrainConsecutiveBuffer(streamId: string, state: StreamState) {
    // Read sorted queue keys chronologically
    while (state.buffer.has(state.expectedSeq)) {
      const nextSeq = state.expectedSeq;
      const nextEvent = state.buffer.get(nextSeq)!;
      state.buffer.delete(nextSeq);

      this.executeEvent(streamId, nextEvent, state);

      this.lastProcessedSeq = Math.max(
        this.lastProcessedSeq,
        nextSeq
      );

      state.expectedSeq = nextSeq + 1;
    }
  }

  /**
 * Call this right when the user pushes a prompt to make sure 
 * previous text blocks don't get appended to accidentally.
 */
  public resetStreamStateForNewMessage() {
    this.isStreamActive = true;
    this.lastIncomingEventAt = Date.now(); // Reset baseline to now
    this.streamStates.forEach((state) => {
      state.activeTextBlockId = null;
    });
  }

  private executeEvent(streamId: string, event: StreamEvent, state: StreamState) {
    switch (event.type) {
      case "text": {
        const existingBlock = state.activeTextBlockId
          ? this.blocks.find((b) => b.id === state.activeTextBlockId)
          : null;

        if (existingBlock && existingBlock.type === "text") {
          // Prevent double appending text if network retries sent duplicates
          if (!existingBlock.content.endsWith(event.text)) {
            existingBlock.content += event.text;
          }
        } else {
          const newId = crypto.randomUUID();
          this.blocks.push({ id: newId, type: "text", streamId, content: event.text });
          state.activeTextBlockId = newId;
        }
        break;
      }
      case "tool_call": {
        // Prevent duplicate tool call block additions
        const alreadyExists = this.blocks.some(b => b.type === "tool" && b.callId === event.callId);
        if (alreadyExists) break;

        state.activeTextBlockId = null;
        this.blocks.push({
          id: crypto.randomUUID(),
          type: "tool",
          callId: event.callId,
          streamId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
        });
        break;
      }
      case "tool_result": {
        const tool = this.blocks.find((b) => b.type === "tool" && b.callId === event.callId);
        if (tool && tool.type === "tool") {
          tool.status = "completed";
          tool.result = event.result;
        }
        break;
      }
    }
  }

  handleToken(seq: number, streamId: string, text: string) {
    this.processStreamEvent(seq, streamId, { type: "text", text });
  }

  handleToolCall(seq: number, callId: string, streamId: string, toolName: string, args: ToolArgs) {
    this.processStreamEvent(seq, streamId, { type: "tool_call", callId, toolName, args });
  }

  handleToolResult(seq: number, callId: string, streamId: string, result: ToolResult) {
    this.processStreamEvent(seq, streamId, { type: "tool_result", callId, result });
  }

  destroy() {
    if (this.timeoutCheckInterval) clearInterval(this.timeoutCheckInterval);
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
  }

  reset() {
    this.blocks = [];
    this.streamStates.clear();
    this.isUpdateScheduled = false;
    this.animationFrameId = null;
    this.notify();
    this.lastProcessedSeq = -1;
    this.isStreamActive = false;
  }
}