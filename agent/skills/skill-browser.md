---
name: browser
description: Drive a real browser through the agent-browser CLI — navigate, fill forms, click, screenshot, and scrape rendered pages
triggers:
  - "open a website"
  - "open a url"
  - "open <url>"
  - "navigate to"
  - "go to"
  - "visit"
  - "fill out a form"
  - "fill in"
  - "click a button"
  - "click on"
  - "take a screenshot"
  - "screenshot"
  - "scrape"
  - "scrape data"
  - "extract data from"
  - "test this web app"
  - "login to"
  - "sign in to"
  - "browse"
  - "browser automation"
  - "automate browser"
  - "web automation"
  - "agent-browser"
---

# Skill: Browser (agent-browser)

## When to load
- I ask to open, navigate to, or visit a website or URL
- I ask to fill out a form, click a button, search, log in, or otherwise act on a page
- I ask to take a screenshot, scrape or extract data, or test a web app
- Any task that needs a real rendered browser (JS-heavy pages, auth flows, visual checks)

## What this skill does
Drives a real Chrome browser through `agent-browser`, a fast native Rust CLI built for AI agents. It runs through the normal `bash` tool — no special tool registration. The core primitive is the accessibility-tree **snapshot** with compact `@eN` element refs, which is the reliable way to target elements.

## Prerequisites
- One-time install: `npm i -g agent-browser && agent-browser install` (downloads Chrome-for-Testing).
- Verify: `agent-browser --version`. On Windows, if the binary doesn't launch, the install/platform is the blocker — stop and report rather than fight it.
- **Windows:** `open` launches a background Chrome daemon that keeps stdout open, so capturing its output through a pipe can hang the shell. Run the first launch with output redirected to a file (`agent-browser open <url> > /tmp/ab-open.log 2>&1`); once the daemon is up, `snapshot` / `click` / `read` return normally even when piped.

## Hard rules
1. **Load the reference first.** Run `agent-browser skills get core` before any browser work. The CLI serves command docs that always match the installed version — treat that as authoritative over anything written here.
2. **Snapshot before acting, and re-snapshot after every action.** Refs go stale the moment the DOM changes.
3. **Use `@eN` refs from the snapshot, not CSS selectors**, unless a selector is clearly more stable.
4. **Close the browser when done.** Always `agent-browser close` — a leaked Chrome daemon survives the turn and eats memory.
5. **Clicks fail when covered.** If a click errors on a covering element (consent banner, modal), dismiss or interact with the covering element first, re-snapshot, then retry the original ref.

## Workflow
The core loop for any web task:

```bash
agent-browser skills get core    # 1. version-matched reference (once per session)
agent-browser open <url>         # 2. launch + navigate
agent-browser snapshot           # 3. accessibility tree with @eN refs
agent-browser click @e2          # 4. act by ref
agent-browser fill @e3 "..."     #    (or type, select, check, press, hover…)
agent-browser snapshot           # 5. re-snapshot after the page changes
agent-browser read               # 6. read rendered page as agent text (or get text @eN)
agent-browser screenshot out.png # 7. only if the user wants an image
agent-browser close              # 8. always
```

Common commands (full details in `skills get core`): `open`, `snapshot`, `click`, `fill`, `type`, `press`, `keyboard type`, `select`, `check`, `uncheck`, `hover`, `scroll`, `scrollintoview`, `upload`, `read`, `get text`, `screenshot` (`--full`, `--annotate`), `pdf`, `eval`, `mouse`, `set viewport/device/geo/offline/headers/credentials/media`, and cookie/storage commands.

## Anti-patterns
- Don't act without a fresh snapshot — `@eN` refs from an old snapshot point at nothing.
- Don't leave the browser open — `close` at the end, even on partial success.
- Don't re-document the full command set here — `agent-browser skills get core` is the single source of truth.
- Don't reach for agent-browser when a plain `curl`/`fetch` would do — a real browser is for JS-rendered pages, forms, auth, and visuals, not simple API calls.
