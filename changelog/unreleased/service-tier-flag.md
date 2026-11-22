---
title: Per-process service tier defaults
type: feature
authors:
  - colinperel
created: 2026-11-22T00:00:00Z
---

The `--service-tier` flag sets service tier defaults for one Pi process over the global config: `off`, or `provider:tier` pairs such as `openai-codex:priority,anthropic:off`. Session `/fast` and `/ultrafast` overrides still take precedence and never save the flag's values.
