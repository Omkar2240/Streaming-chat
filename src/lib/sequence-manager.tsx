import { ServerMessage } from "@/types";


type PendingToken = {
  seq: number;
  text: string;
  streamId: string;
};

type StreamState = {
  expectedSeq: number;
  buffer: Map<number, PendingToken>;
  processed: Set<number>;
};


export class TokenSequencer {
  private streams = new Map<
    string,
    StreamState
  >();

  constructor(
    private onOrderedToken: (
      streamId: string,
      text: string
    ) => void
  ) {}

  handleToken(
    seq: number,
    text: string,
    streamId: string
  ) {
    let state =
      this.streams.get(streamId);

    if (!state) {
      state = {
        expectedSeq: seq,
        buffer: new Map(),
        processed: new Set(),
      };

      this.streams.set(
        streamId,
        state
      );
    }

    /**
     * Duplicate?
     */
    if (
      state.processed.has(seq)
    ) {
      return;
    }

    /**
     * Already buffered?
     */
    if (
      state.buffer.has(seq)
    ) {
      return;
    }

    /**
     * Future token?
     */
    if (
      seq >
      state.expectedSeq
    ) {
      state.buffer.set(seq, {
        seq,
        text,
        streamId,
      });

      return;
    }

    /**
     * Old token?
     */
    if (
      seq <
      state.expectedSeq
    ) {
      return;
    }

    /**
     * Exact expected token
     */
    this.processToken(
      state,
      seq,
      text,
      streamId
    );

    this.flush(state);
  }

  private processToken(
    state: StreamState,
    seq: number,
    text: string,
    streamId: string
  ) {
    this.onOrderedToken(
      streamId,
      text
    );

    state.processed.add(seq);

    state.expectedSeq++;
  }

  private flush(
    state: StreamState
  ) {
    while (
      state.buffer.has(
        state.expectedSeq
      )
    ) {
      const token =
        state.buffer.get(
          state.expectedSeq
        )!;

      state.buffer.delete(
        state.expectedSeq
      );

      this.processToken(
        state,
        token.seq,
        token.text,
        token.streamId
      );
    }
  }
}