import { StreamMachine } from "@/lib/stream-machine";
import { ServerMessage } from "@/types";
import { useEffect, useRef, useCallback, useState } from "react";

export function useWebSocket(wsUrl: string, machine: StreamMachine) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<
    "connected" | "reconnecting" | "offline"
  >("reconnecting");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const graceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const attemptsRef = useRef<number>(0);

  // Keep a mutable reference to the machine so it never triggers a socket reconnection loop
  const machineRef = useRef(machine);
  useEffect(() => { machineRef.current = machine; }, [machine]);

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

        ws.send(
          JSON.stringify({
            type: "RESUME",
            last_seq: lastSeq,
          })
        );
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

        switch (msg.type) {
          case "PING":
            ws.send(JSON.stringify({ type: "PONG", echo: msg.challenge }));
            break;
          case "TOKEN":
            currentMachine.handleToken(msg.seq, msg.stream_id, msg.text);
            break;
          case "TOOL_CALL":
            ws.send(JSON.stringify({ type: "TOOL_ACK", call_id: msg.call_id }));
            currentMachine.handleToolCall(msg.seq, msg.call_id, msg.stream_id, msg.tool_name, msg.args);
            break;
          case "TOOL_RESULT":
            currentMachine.handleToolResult(msg.seq, msg.call_id, msg.stream_id, msg.result);
            break;
          case "STREAM_END":
            if (currentMachine.closeStream) currentMachine.closeStream(msg.stream_id);
            break;
          default:
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
      ws.close(); // Cascades execution cleanly into the ws.onclose block above
    };
  }, [wsUrl]); // Removed 'machine' dependency to kill the infinite disconnect loops!

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
