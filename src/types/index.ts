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
        result: ToolResult;
    }



export type ToolArgs = {
    query: string;
    top_k: number;
}

export type ToolResult = {
    found: boolean;
    content_preview: string;
    relevance_score: number;
    section: string;
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
    };