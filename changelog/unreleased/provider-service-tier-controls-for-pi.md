---
title: Provider service tier controls for pi
type: feature
authors:
  - mavam
  - codex
created: 2026-04-25T09:02:41.119184Z
---

The `pi-service-tier` extension can configure and apply provider service tiers for supported pi models.

Use `/fast` to toggle supported providers between fast mode and off, or `/service-tier` to edit all supported providers interactively. You can also configure tiers directly in `~/.pi/agent/service-tier.json`:

```json
{
  "openai": "priority",
  "openai-codex": "flex",
  "anthropic": "priority",
  "google": "priority",
  "google-vertex": "flex"
}
```

When `pi-fancy-footer` is installed, the active service tier appears in the footer.
