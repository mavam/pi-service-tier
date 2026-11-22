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
- Adds `/fast` and `/ultrafast` to toggle the current model provider between
  the selected speed and off for this session only
- Adds `/service-tier` to configure global defaults for all supported providers
  from an interactive modal
- Adds an optional service tier widget when `pi-fancy-footer` is installed

## 🚀 Commands

- `/fast`: toggles the current model's provider between its fast tier and off
  **in this session**, without changing other sessions or your global defaults.
  The supported providers all use `priority` as the fast tier.

- `/ultrafast`: toggles between `ultrafast` and off **in this session** for
  `openai` and `openai-codex` (including additional accounts on their official
  endpoints). It uses the same provider override as `/fast`, so selecting a
  different speed replaces the active tier.

- `/service-tier`: opens an interactive editor for **global defaults**. The
  current model's provider appears first, followed by the remaining supported
  providers. Press Enter or Space to cycle through `off` and the provider-specific
  tiers. Session overrides take precedence over these defaults.

### Session scope

To speed up a session, run `/fast` or `/ultrafast`. Run the same command again to
turn that mode off. Each supported provider has one override (shared with any
additional accounts for that provider), so switching models preserves your
choices. Turning either mode off disables this extension's tier injection, even
if a global tier is configured. The command leaves other request parameters
unchanged.

| Current tier  | `/fast`    | `/ultrafast` |
| ------------- | ---------- | ------------ |
| Off or `flex` | `priority` | `ultrafast`  |
| `priority`    | Off        | `ultrafast`  |
| `ultrafast`   | `priority` | Off          |

Both commands remain listed on all providers. Running them on an unsupported
model produces a warning without changing settings.

Overrides are saved with the session and restored on resume or extension reload.
They follow the active conversation branch: `/tree` restores the choices at the
selected point, and `/fork` or `/clone` inherits the choices on the copied branch.
Later toggles in a fork do not affect its parent. `/new` starts without overrides
and uses your global defaults, under any `--service-tier` flag the process was
started with.

### Ultrafast availability

The extension sends `service_tier: "ultrafast"` for models using the `openai`
Responses API or `openai-codex`. OpenAI determines model and account eligibility.
Pi reports provider errors without automatically selecting another tier.

[OpenAI's API documentation] describes current model availability, rate limits,
and pricing. [Codex subscription eligibility] differs from API-key access and
may require workspace permissions.

[OpenAI's API documentation]: https://developers.openai.com/api/docs/guides/ultrafast-mode
[Codex subscription eligibility]: https://learn.chatgpt.com/docs/agent-configuration/speed

### Child agents

With [pi-agents](https://github.com/mavam/pi-agents) 0.36.0 or later, which
provides [agent extension hooks](https://github.com/mavam/pi-agents/blob/main/docs/hooks.md),
new agents capture your effective service-tier settings, including session
`/fast` and `/ultrafast` overrides. Each child applies the settings for its own
provider, even when it uses a different model or additional account from the
parent.

For example, enable `/fast`, then ask Pi to spawn an agent. That agent keeps
its captured settings if you toggle `/fast` again. Graph nodes capture when
the graph is created; helpers inherit their creating agent's settings.
Follow-ups, child compaction, and resumed work retain the snapshot.

This integration is optional and adds no package dependency. A snapshot from a
newer version of pi-service-tier applies the providers and tiers this version
supports. If pi-service-tier is removed, stored snapshots remain but stop
affecting requests; loading it again applies them. Parent compaction and usage-cost limitations are unchanged.

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

### Per-process defaults

`--service-tier` sets defaults for one Pi process on top of the global file,
for example for a scripted run or a subagent launcher:

```sh
pi --service-tier=off
pi --service-tier=openai-codex:priority,anthropic:off
```

`off` disables every provider; otherwise list `provider:tier` pairs, where
`off` disables one provider. Session `/fast` and `/ultrafast` overrides still
take precedence and are saved without the flag's values, so reopening the
session without the flag uses the global file again. Agents created with
pi-agents capture these defaults too. An invalid value is reported and ignored.

### Supported providers

| Provider        | Tiers                           | Fast tier  |
| --------------- | ------------------------------- | ---------- |
| `openai`        | `flex`, `priority`, `ultrafast` | `priority` |
| `openai-codex`  | `flex`, `priority`, `ultrafast` | `priority` |
| `anthropic`     | `priority`, `standard`          | `priority` |
| `google`        | `flex`, `priority`              | `priority` |
| `google-vertex` | `flex`, `priority`              | `priority` |

To turn a provider off by default, omit its key. Only the values listed above are
accepted. Providers without a session override continue to pick up global changes, unless
the process's `--service-tier` flag sets them.
Batch APIs are separate asynchronous APIs and are not configured by this
extension.

### Additional accounts

Accounts registered under another provider name, such as
[pi-multi-pass](https://github.com/hjanuschka/pi-multi-pass)'s `anthropic-2` or
`openai-codex-2`, share the service-tier settings of the built-in provider whose
API and official endpoint they use. `/fast`, `/ultrafast`, `/service-tier`,
child agents, and the footer widget all share that provider's setting rather
than storing a separate entry per account.

Account matching requires the exact API and `baseUrl` of Pi's built-in provider
(for example `https://api.anthropic.com` with no trailing slash or port, or
`https://{location}-aiplatform.googleapis.com` for `google-vertex`). Other
spellings and third-party proxies speaking a supported API are not matched and
receive no service tier.

## 🧩 Footer widget

When [pi-fancy-footer](https://github.com/mavam/pi-fancy-footer) is installed,
the widget appears only when the active model resolves to a supported provider
and that provider has an effective tier after applying session overrides. It shows
`⚡⚡` for ultrafast or a single `⚡` for another active tier, without the tier
name. The bolts indicate the requested tier; they do not confirm which tier the
provider used.

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
  flex or priority multipliers. Ultrafast pricing is also not represented by
  Pi's current pricing logic. Do not use displayed costs to estimate ultrafast
  charges.

## 📄 License

[MIT](LICENSE)
