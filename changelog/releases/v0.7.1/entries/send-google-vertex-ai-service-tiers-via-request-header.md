---
title: Send Google Vertex AI service tiers via request header
type: bugfix
authors:
  - mavam
created: 2026-11-27T06:25:46.401289Z
---

Requests for `google-vertex` models now select `priority` and `flex` tiers via the `X-Vertex-AI-LLM-Shared-Request-Type` HTTP header instead of setting `serviceTier` in the request body. Vertex AI rejected lowercase `serviceTier` body values with HTTP 400 and silently ignored body tier fields.

Requests for `google` (Gemini Developer API) models continue to send `serviceTier` in the request body.
