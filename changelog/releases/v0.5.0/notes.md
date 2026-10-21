Service-tier settings now follow the latest pi-agents child-agent hooks protocol, so spawned agents inherit provider defaults and active-session overrides. This release requires Pi 1.3.0 and pi-agents 0.36.0 or later.

## 🚀 Features

### Service-tier inheritance for child agents

New child agents can inherit your service-tier settings when pi-agents 0.36.0 or later is installed. Enable `/fast`, then ask Pi to spawn an agent: it captures your current provider-specific defaults and session overrides, even if it uses a different provider from the parent.

Later toggles affect future agents only. Graph nodes capture when the graph is created, helpers inherit their creator's settings, and existing agents retain their snapshots across follow-ups, compaction, and resumed sessions. Neither extension requires the other.

*By @mavam in #4.*
