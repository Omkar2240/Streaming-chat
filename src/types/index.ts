export type ServerMessage =
    | {
        type: "PING";
        seq: number;
        challenge: string;
    }
    | {
        type: "CONTEXT_SNAPSHOT";
        seq: number;
        context_id: string;
        data: unknown;
    }
    | {
        type: "TOKEN";
        seq: number;
        text: string;
        stream_id: string;
    }
    | {
        type: "STREAM_END";
        seq: number;
        stream_id: string;
    } 
    | {
        type: "TOOL_CALL";
        seq: number;
        call_id: string;
        stream_id: string;
        tool_name: string;
        args: ToolArgs;
    }
    | {
        type: "TOOL_RESULT";
        seq: number;
        call_id: string;
        stream_id: string;
        result: ToolResult;
    } 



export type ToolArgs = {
    query: string;
    top_k: number;
}

export type ToolResult = {
    call_id: string;
    result: any;
    seq: number;
    stream_id: string;
}

export type Block =
    | {
        id: string;
        type: "text";
        streamId: string;
        content: string;
    }
    | {
        id: string;
        type: "tool";
        callId: string;
        streamId: string;
        toolName: string;
        args: ToolArgs;
        status: "running" | "completed";
        result?: ToolResult
    }
    | {
        id: string;
        type: "user";
        content: string;
    }

// ─── Trace Timeline Types ──────────────────────────────────────────

export type TraceGroup =
    | {
        id: string;
        kind: "token_batch";
        streamId: string;
        tokenCount: number;
        fullText: string;
        startSeq: number;
        endSeq: number;
        startTime: number;
        endTime: number;
    }
    | {
        id: string;
        kind: "event";
        eventType: string;
        direction: "in" | "out";
        seq?: number;
        streamId?: string;
        callId?: string;
        timestamp: number;
        summary: string;
        detail?: unknown;
    };
