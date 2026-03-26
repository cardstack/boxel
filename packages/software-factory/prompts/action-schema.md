```json
[
  {
    "type": "create_file | update_file | create_test | update_test | update_ticket | create_knowledge | invoke_tool | request_clarification | done",
    "path": "(string, required for file actions) relative path within the realm",
    "content": "(string, required for file actions) full file content",
    "realm": "(\"target\" | \"test\") which realm this action targets",
    "tool": "(string, required for invoke_tool) name of the tool to invoke",
    "toolArgs": "(object, optional for invoke_tool) arguments to pass to the tool"
  }
]
```

## Action Types

- **create_file** — Create a new card definition (.gts) or card instance (.json) in a realm. Requires `path`, `content`, and `realm`.
- **update_file** — Replace the content of an existing file. Requires `path`, `content`, and `realm`.
- **create_test** — Create a new test spec in the test realm. Requires `path`, `content`, and `realm` (must be `"test"`).
- **update_test** — Update an existing test spec. Requires `path`, `content`, and `realm` (must be `"test"`).
- **update_ticket** — Update the current ticket with notes or status changes. Optional `content` for notes.
- **create_knowledge** — Create a knowledge article for the project. Requires `path` and `content`.
- **invoke_tool** — Run a registered tool. Requires `tool` (tool name). Optional `toolArgs` (object of key-value arguments).
- **request_clarification** — Signal that you cannot proceed. Requires `content` explaining what is blocked.
- **done** — Signal that all work for this ticket is complete and tests are passing. No other fields needed.
