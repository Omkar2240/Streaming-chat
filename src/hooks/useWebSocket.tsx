import { StreamMachine } from "@/lib/stream-machine";
import { ServerMessage } from "@/types";
import { useEffect, useRef, useCallback } from "react";

export function useWebSocket(
  wsUrl: string,
  machine: StreamMachine
) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);

    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);

      switch (msg.type) {
        case "PING":
          ws.send(
            JSON.stringify({
              type: "PONG",
              echo: msg.challenge,
            })
          );
          break;

        case "TOKEN":
          machine.handleToken(
            msg.stream_id,
            msg.text
          );
          break;

        case "TOOL_CALL":
          machine.handleToolCall(
            msg.call_id,
            msg.stream_id,
            msg.tool_name,
            msg.args
          );
          break;

        case "TOOL_RESULT":
          machine.handleToolResult(
            msg.call_id,
            msg.result
          );
          break;

        case "CONTEXT_SNAPSHOT":
          console.log(
            "Context Snapshot",
            msg
          );
          break;

        case "STREAM_END":
          break;

        default:
          console.warn(
            "Unknown message",
            msg
          );
      }
    };

    return () => {
      ws.close();
    };
  }, [wsUrl, machine]);

  const sendMessage =
    useCallback(
      (content: string) => {
        const ws = wsRef.current;

        if (
          !ws ||
          ws.readyState !==
            WebSocket.OPEN
        ) {
          return false;
        }

        ws.send(
          JSON.stringify({
            type: "USER_MESSAGE",
            content,
          })
        );

        return true;
      },
      []
    );

  const sendToolAck =
    useCallback(
      (callId: string) => {
        const ws = wsRef.current;

        if (
          !ws ||
          ws.readyState !==
            WebSocket.OPEN
        ) {
          return false;
        }

        ws.send(
          JSON.stringify({
            type: "TOOL_ACK",
            call_id: callId,
          })
        );

        return true;
      },
      []
    );

  return {
    wsRef,
    sendMessage,
    sendToolAck,
  };
}