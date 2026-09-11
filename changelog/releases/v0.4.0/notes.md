Fast mode is now scoped to the current pi session, so you can speed up one session without changing other sessions. Global service-tier defaults remain available through /service-tier.

## 🔧 Changes

### Session-local fast mode

`/fast` now toggles fast mode only for the current model provider in the current session, without changing other sessions or global defaults:

```text
/fast
```

Run it again to turn fast mode off, even when a global default enables a tier. Your choices are saved with the session, restored on resume or reload, and follow the active branch when navigating with `/tree` or creating a fork.

Use `/service-tier` to edit global defaults. Existing global settings, including those saved by earlier versions of `/fast`, remain in effect until you change them. New sessions inherit these defaults without carrying over another session's overrides.

*By @mavam in #3.*
