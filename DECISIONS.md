1) Your approach to seq-based ordering and deduplication. What data structure did you use and why?

2) How you prevent layout shift during tool call interruptions. What CSS or rendering strategy?

3) Your reconnection state recovery approach. How do you track what the DOM has "consumed" vs. what the socket has "received"?

4) What you would change if this needed to handle 50 concurrent agent streams on one screen (an "operations dashboard" scenario).

5) What you would change if the agent's responses were 100x longer (think: full document generation, not chat).