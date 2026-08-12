# GOTCHAS

- Use this if you encounter an Uncaught TypeError with body-parser or something under the hood (iconv-lite)?
    - https://github.com/cloudflare/workers-sdk/issues/10022 
    - https://github.com/cloudflare/workers-sdk/issues/9309

- If you see something like this: `ERROR while loading game 401778302: Error: internal error; reference = bbi935i5lunl05hlfkdo67m5 (Error: internal error; reference = bbi935i5lunl05hlfkdo67m5)`
    - this means we've probably hit a weird condition where the games API is down but the game itself can be processed.