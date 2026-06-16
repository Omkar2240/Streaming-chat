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
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExperiencingLag, setIsExperiencingLag] = useState(false);

  const machineRef = useRef<StreamMachine>(
    new StreamMachine()
  );

  const {
    sendMessage,
    isConnected,
    triggerConnect,
    connectionState,
  } = useWebSocket(
    wsUrl,
    machineRef.current
  );

  useEffect(() => {
    const unsubscribe =
      machineRef.current.subscribe(
        setBlocks
      );

    return () => {
      unsubscribe();
    };
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

      // 1. Show processing if an active response sequence is expected
      setIsProcessing(isActive);

      // 2. If it's active but taking longer than 3.5 seconds, flag network lag/glitch warnings
      if (isActive && timeSinceLastActivity > 3500) {
        setIsExperiencingLag(true);
      } else {
        setIsExperiencingLag(false);
      }
    }, 5000); // Evaluates frequency metrics smoothly

    return () => clearInterval(timer);
  }, []);

  const handleSend = () => {
    const message = input.trim();
    if (!message) return;

    // 1. Optimistically append the user's message
    (machineRef.current as any).blocks.push({
      id: crypto.randomUUID(),
      type: "user",
      content: message,
    });

    // 2. FIX: Call the method directly without the redundant 'if' check!
    machineRef.current.resetStreamStateForNewMessage();

    setIsProcessing(true);

    // 3. Trigger a fresh state notification
    (machineRef.current as any).notify();

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

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto border-x dark:border-gray-800 bg-white dark:bg-gray-900">
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        
        {/* Render user chat */}
        {blocks.map((block: Block) => {
          console.log(blocks);
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
            return (
              <div key={block.id} className="flex justify-start">
                <div className="max-w-[90%] mb-2 whitespace-pre-wrap text-gray-800 dark:text-gray-100 text-sm leading-relaxed">
                  {block.content}
                </div>
              </div>
            );
          }

          const isRunning = block.status === "running";
          return (
            <div
              key={block.id}
              className={`my-2 p-3 rounded-xl border min-h-[48px] text-sm transition-all ${
                isRunning
                  ? "border-l-4 border-l-amber-500 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                  : "border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/50"
              }`}
              style={{ contain: "layout style" }}
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

        {connectionState === "reconnecting" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:bg-amber-950/20 dark:border-amber-900/50">
            <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-400">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
              Connecting to the server...
            </div>
          </div>
        )}

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

      {/* Input Form Area */}
      <div className="sticky bottom-0 border-t dark:border-gray-800 p-4 bg-white dark:bg-gray-900 z-10">
        <div className="flex gap-2">
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
  );
}