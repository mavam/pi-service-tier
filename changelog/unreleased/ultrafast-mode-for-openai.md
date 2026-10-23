---
title: Ultrafast mode for OpenAI
type: feature
authors:
  - iainlane
created: 2026-10-23T08:39:35.663903Z
---

Use `/ultrafast` to select OpenAI's ultrafast tier in the current session with
`openai` Responses or `openai-codex`. The command shares provider-specific
overrides with `/fast`, so selecting another speed replaces the active tier and
repeating the active command turns it off.

Global defaults also accept `ultrafast` for both providers. OpenAI determines
model and account eligibility. Pi reports provider errors without automatically
selecting another tier. The footer shows two bolts for a requested ultrafast tier.
Session restoration and child-agent inheritance preserve the selected tier.
