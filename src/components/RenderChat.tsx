"use client";

import { useEffect, useRef, useState } from "react";
import { StreamMachine } from "@/lib/stream-machine";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Block } from "@/types";

export default function RenderChat({
  wsUrl,
}: {
  wsUrl: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");

  const machineRef = useRef<StreamMachine>(
    new StreamMachine()
  );

  const ackedToolsRef = useRef(
    new Set<string>()
  );

  const { sendMessage, sendToolAck } =
    useWebSocket(
      wsUrl,
      machineRef.current
    );

  useEffect(() => {
    const unsubscribe =
      machineRef.current.subscribe(
        setBlocks
      );

    return unsubscribe;
  }, []);

  const handleSend = () => {
  const message = input.trim();

  if (!message) return;

  const sent = sendMessage(message);

  if (sent) {
    setInput("");
  }
};

const handleKeyDown = (
  e: React.KeyboardEvent<HTMLInputElement>
) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSend();
  }
};

  /**
   * TOOL_ACK AFTER RENDER
   */
  useEffect(() => {
    for (const block of blocks) {
      if (
        block.type === "tool" &&
        block.status ===
          "running" &&
        !ackedToolsRef.current.has(
          block.callId
        )
      ) {
        ackedToolsRef.current.add(
          block.callId
        );

        sendToolAck(
          block.callId
        );
      }
    }
  }, [blocks, sendToolAck]);

 return (
  <div className="flex flex-col h-screen max-w-2xl mx-auto">
    {/* Messages */}
    <div className="flex-1 overflow-y-auto p-4">
      {blocks.map((block) => {
        if (block.type === "text") {
          return (
            <div
              key={block.id}
              className="mb-2 whitespace-pre-wrap text-gray-800 dark:text-gray-100"
            >
              {block.content}
            </div>
          );
        }

        const isRunning =
          block.status === "running";

        return (
          <div
            key={block.id}
            className={`my-2 p-3 rounded-md border min-h-[48px] ${
              isRunning
                ? "border-l-4 border-l-blue-500 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                : "border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            }`}
            style={{
              contain:
                "layout style",
            }}
          >
            <div className="flex items-center gap-2 font-medium text-sm text-gray-700 dark:text-gray-300">
              {isRunning && (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
              )}

              <span>
                Agent Tool:{" "}
                {block.toolName}
              </span>

              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({block.status})
              </span>
            </div>

            <pre className="mt-2 font-mono text-xs bg-black/5 dark:bg-black/40 p-2 rounded overflow-x-auto dark:text-gray-300">
              {JSON.stringify(
                block.args,
                null,
                2
              )}
            </pre>

            {block.result && (
              <pre className="mt-2 font-mono text-xs bg-black/5 dark:bg-black/40 p-2 rounded overflow-x-auto dark:text-gray-300">
                {JSON.stringify(
                  block.result,
                  null,
                  2
                )}
              </pre>
            )}
          </div>
        );
      })}
    </div>

    {/* Input Area */}
    <div className="sticky bottom-0 border-t dark:border-gray-800 p-4 bg-white dark:bg-gray-900 z-10">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) =>
            setInput(e.target.value)
          }
          onKeyDown={
            handleKeyDown
          }
          placeholder="Type a message..."
          className="flex-1 rounded-md border dark:border-gray-700 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400"
        />

        <button
          onClick={handleSend}
          disabled={
            !input.trim()
          }
          className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 transition-colors text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  </div>
);
}