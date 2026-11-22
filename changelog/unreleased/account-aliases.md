---
title: Service tiers for additional provider accounts
type: change
authors:
  - colinperel
prs:
  - 6
created: 2026-11-22T00:00:00Z
---

Additional accounts registered under another provider name, such as
`pi-multi-pass`'s `anthropic-2` and `openai-codex-2`, now inherit the service
tier of the built-in provider whose API and official endpoint they use.
`/fast`, `/ultrafast`, `/service-tier`, child agents, and the footer widget
all share one setting with that provider.

Matching requires the exact built-in API and base URL, so third-party proxies
speaking a supported API continue to receive no service tier.
