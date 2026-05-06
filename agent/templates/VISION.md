# Vision — <App Name>

> Loaded at session start. The agent uses this to ground every decision in *what the app is supposed to be*.
> Update when the answer to "what is this app" actually changes — not for every new feature.

## What this app is
<one-sentence description in plain language>

## Who it's for
<target user — be specific. "Solo entrepreneurs in Texas who own one rental property" beats "homeowners">

## What problem it solves
<the pain point being addressed, in the user's voice>

## How a user gets value
<the core flow from "user has problem" to "user has solution">

## What it's not
<scope boundaries — things this app deliberately doesn't do, with brief reasoning>

## Success looks like
<concrete, measurable outcomes — "5 paying users by Q2" beats "product-market fit">

## Current phase
<v0/v1/v2 or whatever stage you're in, plus a sentence on what defines this phase>

## Architecture
> High-level component map. Update when components are added, removed, or their relationships change.

**Components:**
- `<Component>` — `<one-line responsibility>`

**Data flow:** `<e.g., CLI → transcript fetcher → 3 LLM passes → PDF renderer → output file>`

**Key tech choices:** `<e.g., Python 3.11+, DeepSeek via OpenAI SDK, Playwright for PDF>`

## Constraints worth knowing
<external constraints that shape decisions: regulatory, budget, time, deploy target, etc.>

## Domain glossary
> Use these terms exactly. Avoid synonyms or paraphrasing in code, comments, UI, docs, or chat.
> Add new terms as they emerge — keep this section small, only terms that cause confusion if misnamed.

| Term | Definition |
|---|---|
| <Term> | <one-sentence definition> |

**Avoided terms:** <e.g., don't say "client" — say "property owner">
