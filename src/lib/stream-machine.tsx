import { Block, ToolArgs, ToolResult } from "@/types";


type Listener = (blocks: Block[]) => void;

export class StreamMachine {
  private blocks: Block[] = [];
  private listeners = new Set<Listener>();

  private animationFrameId: number | null = null;
  private isUpdateScheduled = false;

  subscribe(listener: Listener) {
    this.listeners.add(listener);

    listener(structuredClone(this.blocks));

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    if (this.isUpdateScheduled) return;

    this.isUpdateScheduled = true;

    this.animationFrameId = requestAnimationFrame(() => {
      const snapshot = structuredClone(this.blocks);

      this.listeners.forEach((listener) => {
        listener(snapshot);
      });

      this.animationFrameId = null;
      this.isUpdateScheduled = false;
    });
  }

  handleToken(streamId: string, text: string) {
    const lastBlock =
      this.blocks[this.blocks.length - 1];

    if (
      lastBlock &&
      lastBlock.type === "text" &&
      lastBlock.streamId === streamId
    ) {
      lastBlock.content += text;
    } else {
      this.blocks.push({
        id: crypto.randomUUID(),
        type: "text",
        streamId,
        content: text,
      });
    }

    this.notify();
  }

  handleToolCall(
    callId: string,
    streamId: string,
    toolName: string,
    args: ToolArgs
  ) {
    this.blocks.push({
      id: crypto.randomUUID(),
      type: "tool",
      callId,
      streamId,
      toolName,
      args,
      status: "running",
    });

    this.notify();
  }

  handleToolResult(
    callId: string,
    result: ToolResult
  ) {
    const tool = this.blocks.find(
      (block) =>
        block.type === "tool" &&
        block.callId === callId
    );

    if (!tool || tool.type !== "tool") {
      return;
    }

    tool.status = "completed";
    tool.result = result;

    this.notify();
  }

  reset() {
    if (this.animationFrameId) {
      cancelAnimationFrame(
        this.animationFrameId
      );
    }

    this.blocks = [];
    this.isUpdateScheduled = false;
    this.animationFrameId = null;

    this.notify();
  }
}