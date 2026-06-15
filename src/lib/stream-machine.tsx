import { Block, ToolArgs, ToolResult } from "@/types";

type Listener = (blocks: Block[]) => void;

type StreamState = {
  expectedSeq: number;
  // The buffer now holds generalized stream events, not just text strings
  buffer: Map<number, StreamEvent>;
  activeTextBlockId: string | null;
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
      state = {
        expectedSeq: initialSeq,
        buffer: new Map(),
        activeTextBlockId: null,
      };
      this.streamStates.set(streamId, state);
    }
    return state;
  }

  /**
   * Explicitly exposes cleaning up stream buffers to prevent memory leaks.
   * Triggered by STREAM_END events.
   */
  public closeStream(streamId: string) {
    this.streamStates.delete(streamId);
  }

  /**
   * Core routing router that handles sequencing for ALL event types
   */
  processStreamEvent(seq: number, streamId: string, event: StreamEvent) {
    const state = this.getOrInitState(streamId, seq);

    // Drop duplicates/already processed sequences
    if (seq < state.expectedSeq) return;

    // Buffer future events (accounts for out-of-order networks)
    if (seq > state.expectedSeq) {
      if (!state.buffer.has(seq)) {
        state.buffer.set(seq, event);
      }
      return;
    }

    // Process current expected event
    this.executeEvent(streamId, event, state);
    state.expectedSeq++;

    // Drain buffer if consecutive sequence items exist
    while (state.buffer.has(state.expectedSeq)) {
      const nextEvent = state.buffer.get(state.expectedSeq)!;
      state.buffer.delete(state.expectedSeq);
      this.executeEvent(streamId, nextEvent, state);
      state.expectedSeq++;
    }

    this.notify();
  }

  /**
   * Applies the synchronized payload to the state block array
   */
  private executeEvent(streamId: string, event: StreamEvent, state: StreamState) {
    switch (event.type) {
      case "text": {
        const existingBlock = state.activeTextBlockId
          ? this.blocks.find((b) => b.id === state.activeTextBlockId)
          : null;

        if (existingBlock && existingBlock.type === "text") {
          existingBlock.content += event.text;
        } else {
          const newId = crypto.randomUUID();
          this.blocks.push({
            id: newId,
            type: "text",
            streamId,
            content: event.text,
          });
          state.activeTextBlockId = newId;
        }
        break;
      }

      case "tool_call": {
        // Break text continuous segment continuity on tool calls
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
        const tool = this.blocks.find(
          (block) => block.type === "tool" && block.callId === event.callId
        );
        if (tool && tool.type === "tool") {
          tool.status = "completed";
          tool.result = event.result;
        }
        break;
      }
    }
  }

  // Wrapper adapters to preserve your component-level API signatures
  handleToken(seq: number, streamId: string, text: string) {
    this.processStreamEvent(seq, streamId, { type: "text", text });
  }

  handleToolCall(seq: number, callId: string, streamId: string, toolName: string, args: ToolArgs) {
    this.processStreamEvent(seq, streamId, { type: "tool_call", callId, toolName, args });
  }

  handleToolResult(seq: number, callId: string, streamId: string, result: ToolResult) {
    this.processStreamEvent(seq, streamId, { type: "tool_result", callId, result });
  }

  reset() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.blocks = [];
    this.streamStates.clear();
    this.isUpdateScheduled = false;
    this.animationFrameId = null;
    this.notify();
  }
}