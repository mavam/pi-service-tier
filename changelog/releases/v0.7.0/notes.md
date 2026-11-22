Configure per-process service tier defaults with the --service-tier flag without modifying your global configuration file. Additional provider accounts on official endpoints now share their provider's service tier settings across session toggles, child agents, and the footer widget.

## 🚀 Features

### Per-process service tier defaults

The `--service-tier` flag replaces global `service-tier.json` defaults for one Pi process: pass `off` to disable all providers, or `provider:tier` pairs such as `openai-codex:priority,anthropic:standard` (leaving unlisted providers off). Session `/fast` and `/ultrafast` overrides still take precedence without persisting the flag's values.

*By @colinperel in #7.*

## 🔧 Changes

### Service tiers for additional provider accounts

Additional accounts registered under another provider name, such as `pi-multi-pass`'s `anthropic-2` and `openai-codex-2`, now inherit the service tier of the built-in provider whose API and official endpoint they use. `/fast`, `/ultrafast`, `/service-tier`, child agents, and the footer widget all share one setting with that provider.

Matching requires the exact built-in API and base URL, so third-party proxies speaking a supported API continue to receive no service tier.

*By @colinperel in #6.*
