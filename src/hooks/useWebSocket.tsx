import { StreamMachine } from "@/lib/stream-machine";
import { TraceStore } from "@/lib/trace-store";
import { ServerMessage } from "@/types";
import { useEffect, useRef, useCallback, useState } from "react";

export function useWebSocket(
  wsUrl: string,
  machine: StreamMachine,
  traceStore?: TraceStore
) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<
    "connected" | "reconnecting" | "offline"
  >("reconnecting");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const graceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const attemptsRef = useRef<number>(0);

  // Keep mutable references so they never trigger a socket reconnection loop
  const machineRef = useRef(machine);
  useEffect(() => { machineRef.current = machine; }, [machine]);

  const traceRef = useRef(traceStore ?? null);
  useEffect(() => { traceRef.current = traceStore ?? null; }, [traceStore]);

  const connect = useCallback(() => {
    // 1. Guard against overlapping connections
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log("Connecting to WebSocket...");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected successfully!");

      setIsConnected(true);
      setConnectionState("connected");

      // send resume after reconnection
      if (attemptsRef.current > 0) {
        const lastSeq =
          machineRef.current.getLastProcessedSeq();

        const resumePayload = { type: "RESUME", last_seq: lastSeq };
        ws.send(JSON.stringify(resumePayload));
        traceRef.current?.push("RESUME", "out", { last_seq: lastSeq });
      }

      attemptsRef.current = 0;

      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        const currentMachine = machineRef.current;
        const trace = traceRef.current;

        switch (msg.type) {
          case "PING":
            trace?.push("PING", "in", {
              seq: msg.seq,
              challenge: msg.challenge
            });
            ws.send(JSON.stringify({
              type: "PONG",
              echo: msg.challenge
            }));
            trace?.push("PONG", "out", { echo: msg.challenge });
            break;

          case "TOKEN":
            trace?.push("TOKEN", "in", {
              seq: msg.seq,
              stream_id: msg.stream_id, 
              text: msg.text 
            });
            currentMachine.handleToken(msg.seq, msg.stream_id, msg.text);
            break;

          case "TOOL_CALL":
            trace?.push("TOOL_CALL", "in", {
              seq: msg.seq, 
              call_id: msg.call_id,
              stream_id: msg.stream_id, 
              tool_name: msg.tool_name, 
              args: msg.args,
            });

            ws.send(JSON.stringify({
               type: "TOOL_ACK",
               call_id: msg.call_id 
            }));

            trace?.push("TOOL_ACK", "out", { call_id: msg.call_id });
            currentMachine.handleToolCall(msg.seq, msg.call_id, msg.stream_id, msg.tool_name, msg.args);
            break;

          case "TOOL_RESULT":
            trace?.push("TOOL_RESULT", "in", {
              seq: msg.seq, 
              call_id: msg.call_id,
              stream_id: msg.stream_id, 
              result: msg.result,
            });
            currentMachine.handleToolResult(msg.seq, msg.call_id, msg.stream_id, msg.result);
            break;

          case "STREAM_END":
            trace?.push("STREAM_END", "in", { seq: msg.seq, stream_id: msg.stream_id });
            if (currentMachine.closeStream) currentMachine.closeStream(msg.stream_id);
            break;

          case "CONTEXT_SNAPSHOT":
            trace?.push("CONTEXT_SNAPSHOT", "in", {
              seq: msg.seq, context_id: msg.context_id, data: msg.data,
            });
            break;

          default:
            trace?.push("UNKNOWN", "in", msg as unknown as Record<string, unknown>);
            console.warn("Unknown message", msg);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      wsRef.current = null;

      if (event.wasClean) return;

      if (!navigator.onLine) {
        setConnectionState("offline");  // client internet disconnected
      } else {
        setConnectionState("reconnecting"); //server disconnected
      }

      console.warn("WebSocket disconnected unexpectedly.");

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      const baseDelay = 1000;

      const calculatedDelay = Math.min(
        baseDelay * Math.pow(2, attemptsRef.current),
        15000
      );

      const jitter =
        calculatedDelay * 0.3 * Math.random();

      const finalDelay = Math.floor(
        calculatedDelay + jitter
      );

      attemptsRef.current += 1;

      reconnectTimerRef.current =
        setTimeout(connect, finalDelay);
    };

    ws.onerror = () => {
      ws.close(); 
    };
  }, [wsUrl]);

  // Hook entry & exit lifecycle
  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close(1000, "Component unmounted");
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    };
  }, [connect]);

  useEffect(() => {
    const handleOnline = () => {
      setConnectionState("reconnecting");
      connect();
    };

    const handleOffline = () => {
      setConnectionState("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener(
        "online",
        handleOnline
      );

      window.removeEventListener(
        "offline",
        handleOffline
      );
    };
  }, [connect]);

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "USER_MESSAGE", content }));
    traceRef.current?.push("USER_MESSAGE", "out", { content });
    return true;
  }, []);

  return {
    wsRef,
    sendMessage,
    isConnected,
    triggerConnect: connect,
    connectionState,
  };
}
