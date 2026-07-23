Pi Service Tier now publishes its footer indicator directly over Pi's event bus without depending on the footer package. The indicator remains reliable regardless of extension load order.

## 🔧 Changes

### Dependency-free fancy footer integration

The optional service-tier footer indicator now talks to `pi-fancy-footer` through its event protocol and no longer relies on its package API.

Install both extensions as before to see `⚡` whenever the active model has a configured service tier. The indicator republishes when the footer becomes ready, so extension load order does not matter.

*By @mavam and @codex in #2.*
