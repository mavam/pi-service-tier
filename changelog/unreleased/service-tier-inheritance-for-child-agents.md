---
title: Service-tier inheritance for child agents
type: feature
authors:
  - mavam
prs:
  - 4
created: 2026-10-20T16:11:07.433752Z
---

New child agents can inherit your service-tier settings when a compatible pi-agents version is installed. Enable `/fast`, then ask Pi to spawn an agent: it captures your current provider-specific defaults and session overrides, even if it uses a different provider from the parent.

Later toggles affect future agents only. Graph nodes capture when the graph is created, helpers inherit their creator's settings, and existing agents retain their snapshots across follow-ups, compaction, and resumed sessions. Neither extension requires the other.
