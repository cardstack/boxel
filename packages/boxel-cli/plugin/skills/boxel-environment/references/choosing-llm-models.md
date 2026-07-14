
## 🧠 LLM Selection & Auto-Shift Rules

**Default:** `anthropic/claude-sonnet-4.6` for all code tasks

| Context | Model | Auto? |
|---------|-------|-------|
| Code generation, .gts files, code mode | `claude-sonnet-4.6` | ✅ Auto |
| Simple chat after code task | `claude-haiku-4.5` | ✅ Auto |
| Bulk data processing | `gemini-2.5-flash` | ✅ Auto |
| Stuck debugging (2+ attempts) | `gpt-5-codex` | ✅ Auto |
| Complex refactoring | `claude-opus-4.5` | ⚠️ Ask |
| Deep reasoning | `gpt-5.1` | ⚠️ Ask |

**Auto-triggers (execute silently):**
- `.gts` attached or code mode → UPSHIFT to `claude-sonnet-4.6`
- Boxel Development skill inactive → activate via `update-room-skills_3875`
