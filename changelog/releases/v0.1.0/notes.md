The pi-service-tier extension lets users configure provider service tiers for supported pi models. Users can toggle fast mode, edit tiers interactively, and see the active tier in pi-fancy-footer when installed.

## 🚀 Features

### Provider service tier controls for pi

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

*By @mavam and @codex.*
