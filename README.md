[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/youngkhalee/makefun-frontend/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/youngkhalee/makefun-frontend/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

# make.fun frontend — tiny, fast, no build step

A static frontend for [make.fun](https://make.fun), built for the
[makefun-frontend-01](https://make.fun/bounty/makefun-frontend-01) bounty.
Three files do everything: `app/index.html`, `app/style.css`, and a single
ES module `app/main.js`. No framework, no bundler, no build step — the first
load is a few kilobytes, API answers are cached and revalidated with ETags
(`If-None-Match` / `304`), and long leaderboards are paginated 50 rows at a
time instead of rendering thousands of DOM nodes.

All data comes live from the make.fun public API (`GET https://make.fun/api…`).

## Run it

```sh
node serve.ts            # serves app/ on http://localhost:8080
node serve.ts --port 8901
```

Then open the local URL in a browser. To produce the submission output:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Routes (hash-based, each reachable by link and by direct URL)

| Route | View |
| --- | --- |
| `#/` | Live bounty board — every open bounty with its live pot (prize + entry fees paid), entry fee, countdown to deadline, and entry count, plus a client-side filter |
| `#/bounty/<slug>` | Bounty page — summary, full description, live rewards table, open/deadline dates in UTC, status |
| `#/bounty/<slug>/leaderboard` | Leaderboard — the API's own columns, paginated 50 per page, entrants link to profiles |
| `#/u/<handle>` | Public profile — record (entered / placed / won / best placement / prizes) and all of the account's entries |

## Accessibility & performance notes

- Skip-to-content link, landmarks, focus moved to each page's heading on
  route change, visible focus rings, an `aria-live` status region, and a
  phone layout that stacks table rows under 640px with 40px+ touch targets.
- One fetch per view; repeat views revalidate with `If-None-Match` and reuse
  the cached body on `304`. A single 30-second timer updates only the
  countdown text nodes — it never refetches or re-renders.
- A bounty past its deadline is shown as **Closed** even if the API status
  has not caught up yet.

## License

MIT — see [LICENSE](LICENSE).
