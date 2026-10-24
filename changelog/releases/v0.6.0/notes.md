Select OpenAI’s ultrafast tier with /ultrafast or configure it as a global default. Session restoration and child agents preserve your selected tier, and the footer distinguishes ultrafast with two bolts.

## 🚀 Features

### Ultrafast mode for OpenAI

Use `/ultrafast` to select OpenAI's ultrafast tier in the current session with `openai` Responses or `openai-codex`. The command shares provider-specific overrides with `/fast`, so selecting another speed replaces the active tier and repeating the active command turns it off.

Global defaults also accept `ultrafast` for both providers. OpenAI determines model and account eligibility. Pi reports provider errors without automatically selecting another tier. The footer shows two bolts for a requested ultrafast tier. Session restoration and child-agent inheritance preserve the selected tier.

*By @iainlane.*
