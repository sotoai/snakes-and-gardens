# Snakes & Gardens

Dispatches on the promises and perils of technological power.

## Dispatch 01 · Who is Jean Phil?

**https://sotoai.github.io/snakes-and-gardens/who-is-jean-phil/**

A blond pageboy, a curled mustache, 5.6 million views in three days and his own ticker symbol. It's an interactive story about a face that keeps replacing people. It also asks why the AI apocalypse might look less like the Terminator and more like him.

This is a preview draft, hosted here for now. Sources, methods and the line between what we established, what others allege and what we imagine are in the notes at the end of the page.

### Credits

- Jean Phil: [@jean_philanthrope](https://www.tiktok.com/@jean_philanthrope)
- Remix and tutorial: [Ty Farrago](https://www.tiktok.com/@ty.farrago)
- Commentary: [Jeremy Carrasco](https://www.tiktok.com/@jeremyfindsai)
- Earlier fishing upload: [@movie_scenes012](https://www.tiktok.com/@movie_scenes012) (original filmer unknown)
- Donkey footage: [Jeferson](https://www.tiktok.com/@jefin_nordestino)
- Research: Wenjie Qu, Xuandong Zhao, Jiaheng Zhang and Dawn Song, [*Self-Sovereign Agent*](https://self-sovereign-agent.github.io/)

Videos, screenshots and other third-party material belong to their creators and appear for reporting and commentary. Crediting them doesn't mean they took part in or endorse this story. If you're a creator featured here and want something changed or removed, please open an issue.

### Run it locally

It's a static page with no build step:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/who-is-jean-phil/. The live market panel calls the public DEX Screener and GeckoTerminal APIs while it's on screen; everything else is local. Fonts are Bodoni Moda and Source Serif 4 under the SIL Open Font License (see `who-is-jean-phil/assets/fonts`).
