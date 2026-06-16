# DECISIONS.md

This document explains the technical choices made while building the Stream Engine frontend — a real-time WebSocket-based AI chat client designed to survive network chaos, render tokens smoothly, and recover gracefully from disconnections.

---

## 1. Seq-Based Ordering and Deduplication

**Question:** *Your approach to seq-based ordering and deduplication. What data structure did you use and why?*

### The Problem

When you stream AI responses over a WebSocket, packets don't always arrive in order. The internet is unpredictable — packets get delayed, duplicated by network retries, or arrive completely out of sequence. If you just render tokens as they come in, the user sees garbled text that jumps around. That's unacceptable.

### The Data Structure: JavaScript `Map<number, StreamEvent>`

I chose a **JavaScript `Map`** as the reorder buffer, keyed by sequence number. Here's why:

- **O(1) lookups** — When a packet arrives, I need to instantly check "do I already have seq 14?" or "is seq 7 sitting in my buffer?" A `Map` gives me constant-time `has()`, `get()`, and `delete()` operations. An array would require scanning or wasting memory on sparse indices.
- **No wasted memory** — Unlike an array where gap indices would sit as `undefined` holes, a `Map` only stores entries for sequences that have actually arrived. If seq 5, 8, and 12 arrive out of order, the Map holds exactly 3 entries, not 13.
- **Natural key ordering for drainage** — When it's time to drain consecutive buffered items, I just check `buffer.has(expectedSeq)` in a `while` loop. No sorting needed for the hot path.

### The Approach

I maintain a single counter called `expectedSeq` — the exact sequence number I need to process next. Every incoming packet falls into one of three categories:

1. **`seq === expectedSeq` (perfect order):** Process it immediately, increment `expectedSeq`, then check the buffer — maybe the *next* number was already waiting. Keep draining as long as consecutive sequences are available.

2. **`seq > expectedSeq` (arrived early):** The packet got here before its predecessors. Stash it in the `Map` buffer. When the missing pieces eventually arrive and fill the gap, the drain loop picks everything up in the correct order.

3. **`seq < expectedSeq` (arrived late / duplicate):** This packet is for a sequence I've already processed. For text events, I check if the content already exists in the current text block using `String.includes()`. If it's already there, I silently drop it. If it's genuinely new content that arrived late (e.g., after a reconnection replay), I prepend it to the text block since it structurally belongs before the tokens that already advanced our counter.

### Why Not a Priority Queue or Sorted Array?

A min-heap (priority queue) would give O(log n) insertion and O(log n) extraction of the minimum. But the buffer is almost always small — a few packets at most during brief network hiccups. The `Map` approach gives O(1) for everything and the drain loop only runs when items are consecutive. For this problem size, a priority queue adds complexity without measurable benefit.

---

## 2. Preventing Layout Shift During Tool Call Interruptions

**Question:** *How you prevent layout shift during tool call interruptions. What CSS or rendering strategy?*

### The Problem

When the AI is mid-sentence and a tool call fires, the streaming text stops, a tool call UI block appears, and after the tool completes, text resumes. Without careful handling, this causes jarring layout shifts — the chat content jumps, the scroll position changes, and the user loses their reading position.

### The Strategy

I used a combination of four techniques:

#### 1. Space Reservation with `min-height`

When a tool call starts, I immediately render a placeholder container with a guaranteed minimum size:

```css
min-height: 48px;
```

This reserves vertical space in the layout *before* the tool result arrives. When the result eventually fills the container, the surrounding content doesn't shift because the space was already claimed.

#### 2. DOM Node Reuse

Instead of unmounting the tool block and remounting it with results, I keep the **same DOM element** alive throughout the tool's entire lifecycle. I use React's `key={block.id}` where the ID is assigned once when the tool call first appears. The block transitions from `status: "running"` to `status: "completed"` — same element, just updated content. This avoids the expensive insert/remove cycle that triggers browser reflows.

#### 3. CSS Containment

```css
contain: layout style;
```

This tells the browser: "Layout calculations inside this tool block are independent from the rest of the page." So when a tool result fills in, the browser only recalculates the layout *within* that block, not the entire chat container. It's a small CSS declaration with a big performance win.

#### 4. Render Batching with `requestAnimationFrame`

AI tokens can arrive at extremely high frequency — sometimes dozens per second. If every single token triggered a React re-render, the browser would spend more time painting than the user spends reading.

```ts
requestAnimationFrame(() => {
  const snapshot = structuredClone(this.blocks);
  this.listeners.forEach((listener) => listener(snapshot));
});
```

I batch all state updates within a single animation frame. If 10 tokens arrive in 8ms, the user sees one smooth paint with all 10 tokens applied, instead of 10 individual renders with layout recalculations between each one.

### Summary

| Technique | What it prevents |
|---|---|
| `min-height: 48px` | Content jumping when tool results load |
| DOM node reuse | Expensive insert/remove reflows |
| `contain: layout style` | Full-page layout recalculations |
| `requestAnimationFrame` batching | Render thrashing from rapid token arrival |

---

## 3. Reconnection State Recovery

**Question:** *Your reconnection state recovery approach. How do you track what the DOM has "consumed" vs. what the socket has "received"?*

### The Problem

When a WebSocket drops and reconnects, the server replays events from a certain point. The client needs to know: "Which events have I already rendered, and which are new?" Get this wrong and you either lose messages (bad) or render duplicates (also bad).

### How It Works

The key insight is that I track **two separate pointers** — one for what the socket has received, and one for what the DOM has actually processed and rendered:

#### `lastProcessedSeq` — The DOM's Bookmark

Every time the `StreamMachine` successfully processes an event (i.e., `seq === expectedSeq` and the event is applied to the blocks array), I update `lastProcessedSeq`:

```ts
this.lastProcessedSeq = Math.max(this.lastProcessedSeq, seq);
```

This number represents: *"Everything up to and including this sequence number is already visible in the UI."*

#### `expectedSeq` (per-stream) — The Stream's Cursor

Each stream maintains its own `expectedSeq` counter that tracks the next sequence number that stream needs. This handles the case where multiple streams might interleave.

#### The Reconnection Flow

When the WebSocket drops and reconnects, here's the exact sequence:

1. **Disconnect detected** — The `onclose` handler fires. The `StreamMachine` and its blocks array are completely untouched. All rendered text and tool results stay visible in the UI.

2. **Reconnect with backoff** — Exponential backoff with jitter kicks in: `Math.min(1000 * 2^attempts, 15000) + random jitter`. This prevents thundering herd if many clients drop simultaneously.

3. **RESUME message** — On successful reconnect, before doing anything else, the client sends:
   ```json
   { "type": "RESUME", "last_seq": <lastProcessedSeq> }
   ```
   This tells the server: *"I've successfully consumed everything up to seq N. Start replaying from N+1."*

4. **Replay handling** — When the server replays events, the `processStreamEvent` method handles them automatically:
   - Events with `seq < expectedSeq` are checked for duplicates and dropped if already present
   - Events with `seq === expectedSeq` are processed normally
   - Events with `seq > expectedSeq` are buffered for later

The beauty of this design is that reconnection is **invisible to the rendering layer**. The `RenderChat` component never knows a disconnect happened. It just keeps subscribing to block updates from the `StreamMachine`, and the machine handles all the deduplication internally.

#### Why This Works

The separation between `lastProcessedSeq` (global, survives reconnection) and `expectedSeq` (per-stream, tracks ordering) means:

- The server gets a reliable "resume from here" checkpoint
- The client has per-stream ordering guarantees
- Late arrivals from the replay are deduplicated against what's already rendered
- The UI stays perfectly stable throughout the entire reconnect cycle

---

## 4. Scaling to 50 Concurrent Agent Streams

**Question:** *What you would change if this needed to handle 50 concurrent agent streams on one screen (an "operations dashboard" scenario).*

If I had 50 AI agents streaming responses simultaneously on one dashboard, the current architecture would hit three bottlenecks pretty quickly. Here's what I'd change:

### Problem 1: React Can't Keep Up With 50 Streams Triggering Re-renders

Right now, every `StreamMachine.notify()` call triggers a `setState` in `RenderChat`, which re-renders the entire block list. With 50 streams firing tokens constantly, React would be doing hundreds of reconciliation passes per second.

**What I'd do:** Replace the single `StreamMachine` with a per-stream architecture, and use a virtualized list renderer (like `react-window` or `@tanstack/virtual`). Each stream panel would only re-render when *its own* stream emits tokens. I'd also move the `StreamMachine` instances into a `SharedWorker` so the event processing and reordering happens off the main thread entirely.

### Problem 2: 50 WebSocket Connections = 50x Overhead

Each WebSocket connection has TCP overhead, heartbeat traffic, and reconnection logic. 50 connections means 50 independent reconnection state machines.

**What I'd do:** Multiplex all 50 streams over a **single WebSocket connection**. The server would tag each message with a `stream_id` (which it already does), and the client would route messages to the correct stream's `StreamMachine` instance. One socket, one reconnection state machine, 50 logical streams.

### Problem 3: 50 DOM Trees Updating Simultaneously = Layout Thrashing

Even with virtualization, 50 visible text panels being appended to simultaneously would cause browser layout thrashing.

**What I'd do:**
- Use `content-visibility: auto` on off-screen panels so the browser skips their layout entirely
- Increase the `requestAnimationFrame` batching to be per-panel instead of per-token
- Implement a "focus mode" where only the selected panel gets real-time token rendering; background panels buffer and flush at lower frequency (e.g., every 500ms)

### Summary

| Current | Dashboard (50 streams) |
|---|---|
| Single `StreamMachine` | One `StreamMachine` per stream, running in a `SharedWorker` |
| One WebSocket | One multiplexed WebSocket |
| Full DOM render on every update | Virtualized list + `content-visibility: auto` |
| Every token triggers render | Tiered rendering: active panel = real-time, background = batched |

---

## 5. Scaling to 100x Longer Responses

**Question:** *What you would change if the agent's responses were 100x longer (think: full document generation, not chat).*

Right now, a typical response is maybe a few hundred tokens — a paragraph or two. If responses were 100x longer (think: generating entire documents, code files, or research reports), the current approach would break in several ways.

### Problem 1: `structuredClone` Becomes a Performance Killer

Every time the `StreamMachine` notifies listeners, it does `structuredClone(this.blocks)`. This creates a deep copy of the entire blocks array. At 100x response length, a single text block could contain 50,000+ characters. Cloning that on every token arrival (even batched via `requestAnimationFrame`) would cause GC pressure and frame drops.

**What I'd do:** Switch from full cloning to an **immutable data structure** approach (like Immer's structural sharing). Only the modified block gets a new reference; everything else shares memory. The `subscribe` callback would receive a reference-equal array where only the changed block is new, letting React's reconciliation skip unchanged blocks instantly.

### Problem 2: Rendering a 50,000-Character String Is Slow

React's virtual DOM diffing on a single text node with 50,000 characters is surprisingly expensive. The browser's text layout engine also struggles with extremely long text nodes.

**What I'd do:**
- **Chunk the text block** into paragraphs or fixed-size segments (e.g., 2,000 characters each). Each chunk becomes its own React element with a stable key. When a new token arrives, only the last chunk re-renders.
- **Virtualize vertically** — only the chunks visible in the viewport are in the DOM. Scrolled-away chunks are unmounted and replaced with spacer elements of equivalent height.

### Problem 3: The Reorder Buffer Could Grow Large

With 100x more tokens, a brief network hiccup could result in hundreds of buffered events. The `while (buffer.has(expectedSeq))` drain loop would process all of them synchronously, potentially blocking the main thread.

**What I'd do:** Drain the buffer in **time-sliced batches** using `requestIdleCallback` or a manual `setTimeout(0)` yield. Process N events, yield to the browser for a paint, then continue. This keeps the UI responsive even during large buffer drains.

### Problem 4: Memory

A 100x longer response means 100x more memory for the blocks array. If the user has multiple conversations, memory could become an issue.

**What I'd do:** Implement a **sliding window** — only keep the last N blocks in memory. Older blocks would be serialized to `IndexedDB` and lazily loaded when the user scrolls up. This keeps the in-memory footprint bounded regardless of response length.

### Summary

| Current | 100x Longer Responses |
|---|---|
| `structuredClone` on every notify | Structural sharing (Immer-style) |
| One text block = one string | Chunked into ~2K segments, virtualized |
| Synchronous buffer drain | Time-sliced with `requestIdleCallback` |
| All blocks in memory | Sliding window + IndexedDB for history |

---

## Chaos Mode: Problems Found and Fixed

During chaos mode testing (server drops connections, delays packets, injects reordering), I encountered and addressed several issues:

### 1. Duplicate Text After Reconnection

**Problem:** After a reconnect, the server replayed events that the client had already rendered. Without dedup, sentences appeared twice.

**Fix:** The `seq < expectedSeq` branch in `processStreamEvent` checks `String.includes()` on the existing text block before inserting. If the text is already present, the event is silently dropped.

### 2. Tool Results Arriving Before Tool Calls

**Problem:** In chaos mode, a `TOOL_RESULT` event sometimes arrived before the corresponding `TOOL_CALL` event (due to reordering). The result would be silently lost because no tool block existed yet to attach it to.

**Fix:** When a buffered `TOOL_RESULT` is encountered and the structural tool block already exists (it was just processed), I immediately execute the result event even if the sequence hasn't been formally reached yet. See the `seq > expectedSeq` branch where I check `structuralToolExists`.

### 3. Stale Streams Hanging Forever

**Problem:** If a `STREAM_END` event was lost entirely, the stream state would sit in the `streamStates` Map forever, and the "AI is thinking..." indicator would never dismiss.

**Fix:** A `reapStaleStreams()` function runs every 5 seconds. Any stream that hasn't received activity in 60 seconds is force-drained and closed.

---

## Known Protocol Issue: The TOOL_ACK Timeout Race Condition

There's an inherent race condition in the protocol around `TOOL_ACK` messages:

When the client receives a `TOOL_CALL`, it immediately sends a `TOOL_ACK`. But consider this sequence:

1. Server sends `TOOL_CALL` (seq 10)
2. Client receives it and sends `TOOL_ACK`
3. Network drops *between* the client sending `TOOL_ACK` and the server receiving it
4. Server's ACK timeout fires — it assumes the client never acknowledged
5. Client reconnects and sends `RESUME { last_seq: 10 }`
6. Server replays `TOOL_CALL` (seq 10) again
7. Client deduplicates it (good), but may send another `TOOL_ACK`
8. Meanwhile, the server might have already started the tool execution *or* it might be waiting for the ACK it never got

The problem: the server has no way to distinguish between "the client got the TOOL_CALL but the ACK was lost" and "the client never got the TOOL_CALL at all." The client's `RESUME` message tells the server what seq was last processed, but it doesn't tell the server whether a `TOOL_ACK` was sent for a specific call_id.

**Impact:** This could lead to a tool being executed twice, or never, depending on how the server handles the timeout. A more robust protocol would include the `call_id` of acknowledged tool calls in the `RESUME` message, like:

```json
{
  "type": "RESUME",
  "last_seq": 10,
  "acked_tool_calls": ["call_abc123"]
}
```

This way, the server knows exactly which tool calls were acknowledged, regardless of whether the ACK message itself was delivered.