---
title: Per-process service tier defaults
type: feature
authors:
  - colinperel
prs:
  - 7
created: 2026-11-22T00:00:00Z
---

The `--service-tier` flag replaces global `service-tier.json` defaults for one Pi process: pass `off` to disable all providers, or `provider:tier` pairs such as `openai-codex:priority,anthropic:standard` (leaving unlisted providers off). Session `/fast` and `/ultrafast` overrides still take precedence without persisting the flag's values.
