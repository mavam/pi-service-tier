Send Vertex AI service tiers through the request header that the service supports. Keep Gemini Developer API tiers in the request body.

## 🐞 Bug fixes

### Send Google Vertex AI service tiers via request header

Requests for `google-vertex` models now select `priority` and `flex` tiers via the `X-Vertex-AI-LLM-Shared-Request-Type` HTTP header instead of setting `serviceTier` in the request body. Vertex AI rejected lowercase `serviceTier` body values with HTTP 400 and silently ignored body tier fields.

Requests for `google` (Gemini Developer API) models continue to send `serviceTier` in the request body.

*By @mavam.*
