# ⚡ pi-service-tier

A [Pi](https://pi.dev) extension that toggles fast mode and applies provider
service tiers.

## 🚀 Installation

```sh
pi install npm:pi-service-tier
```

## ✨ What it does

- Adds service tier parameters to supported provider requests when a tier is
  configured
- Adds `/fast` to toggle the current model provider between fast mode and off
  for this session only
- Adds `/service-tier` to configure global defaults for all supported providers
  from an interactive modal
- Adds an optional service tier widget when `pi-fancy-footer` is installed

## 🚀 Commands

- `/fast`: toggles the current model provider between its fast tier and off
  **in this session**, without changing other sessions or your global defaults.
  The supported providers all use `priority` as the fast tier.

- `/service-tier`: opens an interactive editor for **global defaults**. The
  current model provider appears first, followed by the remaining supported
  providers. Press Enter or Space to cycle through `off` and the provider-specific
  tiers. Session overrides take precedence over these defaults.

### Session scope

Run `/fast` in the session you want to speed up, then run it again to turn fast
mode off. Each provider has its own override, so switching models preserves your
choices. Turning fast mode off also overrides a globally configured tier; it
leaves that provider's request parameters unchanged rather than restoring `flex`
or `standard`.

Overrides are saved with the session and restored on resume or extension reload.
They follow the active conversation branch: `/tree` restores the choices at the
selected point, and `/fork` or `/clone` inherits the choices on the copied branch.
Later toggles in a fork do not affect its parent. `/new` starts without overrides
and uses your global defaults.

## ⚙️ Configuration

Run `/service-tier` or create `~/.pi/agent/service-tier.json` to set global defaults:

```json
{
  "openai": "priority",
  "openai-codex": "flex",
  "anthropic": "priority",
  "google": "priority",
  "google-vertex": "flex"
}
```

### Supported providers

| Provider        | Tiers                  | Fast tier  |
| --------------- | ---------------------- | ---------- |
| `openai`        | `flex`, `priority`     | `priority` |
| `openai-codex`  | `flex`, `priority`     | `priority` |
| `anthropic`     | `priority`, `standard` | `priority` |
| `google`        | `flex`, `priority`     | `priority` |
| `google-vertex` | `flex`, `priority`     | `priority` |

To turn a provider off by default, omit its key. Only the values listed above are
accepted. Providers without a session override continue to pick up global changes.
Existing global settings, including those saved by earlier versions of `/fast`,
remain in effect. Use `/service-tier` to change them.
Batch APIs are separate asynchronous APIs and are not configured by this
extension.

## 🧩 Footer widget

When [pi-fancy-footer](https://github.com/mavam/pi-fancy-footer) is installed,
the widget appears only when the active model uses a supported provider/API pair
and that provider has an effective tier after applying session overrides. It shows
a single `⚡` without the tier name to keep the footer compact.

The widget id is `pi-service-tier.service-tier`. It uses the current
`pi-fancy-footer` event protocol, with row `1`, position `8`, right alignment,
and no fill behavior by default. The extension has no package dependency on the
footer: it publishes a complete snapshot when its state changes and republishes
when the footer announces that it is ready.

## 📝 TODO

- Account for service-tier pricing in pi usage metrics. The extension currently
  injects the tier into the provider request payload, but pi's OpenAI Codex cost
  calculation reads the requested tier from provider options. Until pi exposes a
  first-class extension path for that option, displayed usage costs can omit
  flex or priority multipliers.

## 📄 License

[MIT](LICENSE)
