# Deck Kit — a reusable pitch deck for any repo

A self-contained, dependency-free pitch deck you **drop into any repository** and
customize by editing one file. The renderer is generic; the content lives in
[`deck.config.js`](deck.config.js). Real screenshots are optional and captured
automatically — the deck shows clean placeholders until they exist, so it always
looks complete.

> This copy ships configured for **openOPS** as a worked example. Edit
> `deck.config.js` (and `capture/capture.config.json`) to make it yours.

## View it

Open [`index.html`](index.html) in any browser — no build, no install.

- **← / → / Space** navigate · **Home / End** jump · **F** fullscreen
- **P** → print → **export to PDF** (one slide per page)

## Customize (the only file you usually touch)

Edit [`deck.config.js`](deck.config.js):

```js
window.DECK = {
  brand: { name: "YourProduct", mark: "YP", accent: "#7c3aed" },
  slides: [
    { type: "title",   eyebrow: "…", title: "Hook with an <em>emphasis</em>", lead: "…", kpis: [{ n: "10x", l: "faster" }], pill: "…" },
    { type: "bullets", eyebrow: "…", title: "…", bullets: [{ t: "point", tone: "bad" }], aside: { lead: "…", text: "…" } },
    { type: "flow",    title: "…", nodes: [{ t: "①", d: "…", kind: "key" }], note: "…" },
    { type: "screen",  title: "…", shot: "dashboard", caption: "app.example.com", lead: "…", points: ["…"] },
    { type: "split",   title: "…", left: { heading: "Owns", bullets: ["…"] }, right: { heading: "You own", bullets: ["…"] } },
    { type: "roadmap", title: "…", columns: [{ when: "Shipped", color: "#5eead4", items: ["…"] }] },
    { type: "cta",     title: "…", cmd: ["<b>$</b> npm create yourproduct"], points: ["…"], lead: "…" }
  ]
};
```

Slide `type`s: **title, statement, bullets, split, flow, screen, roadmap, cta**.
Use `<em>…</em>` in any title to gradient-highlight words. `tone: "bad" | "warn"`
recolors a bullet. `accent` rethemes the whole deck.

## Real screenshots (optional, automatic)

1. Edit [`capture/capture.config.json`](capture/capture.config.json): your app's
   `startCommand`, `baseURL`, optional `seed` API calls, and the `screens` to
   shoot (names must match the `shot:` values in `deck.config.js`).
2. Copy [`workflow.yml`](workflow.yml) to `.github/workflows/deck-screenshots.yml`
   and adapt the **Prepare app** step to your stack.
3. Run it from the **Actions** tab → it captures `shots/*.png` and opens a PR.

Locally: `cd deck-kit/capture && npm install && npx playwright install chromium && npm run shots`.

`seed` supports id reuse: a step with `"saveIdAs": "x"` stores the returned `id`,
usable as `{{ids.x}}` in later seed paths and in screen paths (for detail pages).

## Drop it into another repo

```bash
cp -r deck-kit /path/to/other-repo/deck-kit
# then edit deck-kit/deck.config.js (+ capture/capture.config.json), and copy
# deck-kit/workflow.yml to that repo's .github/workflows/ if you want auto-shots.
```

That's it — open `deck-kit/index.html` and you have a branded deck.

## Distribute to all your repos (one command)

[`distribute.py`](distribute.py) opens a PR adding a branded starter `deck-kit/`
to every repo you own. Standard-library Python only — no install. Needs a GitHub
token with `repo` scope (so it reaches private repos too):

```bash
export GITHUB_TOKEN=ghp_xxxxx
python deck-kit/distribute.py                 # DRY RUN — prints what it would do
python deck-kit/distribute.py --execute       # actually open the PRs
```

Safe by default: dry-run unless `--execute`; skips archived repos, forks, and any
repo that already has a `deck-kit/`; per-repo failures are reported and skipped.
Each PR adds files only under `deck-kit/` (never touches your code) and pre-fills
that repo's `deck.config.js` with its name + description as a starting point.

Useful flags: `--only NAME` / `--exclude NAME` (repeatable), `--limit N`,
`--include-archived`, `--include-forks`. Re-runnable — it resumes where it left
off because repos that already have the kit are skipped.
