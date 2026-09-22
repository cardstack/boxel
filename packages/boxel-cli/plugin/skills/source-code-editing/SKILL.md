---
name: source-code-editing
description: Use the run-realm-code tool to create and edit source files in a Boxel realm.
boxel:
  kind: skill
  tools:
    - codeRef:
        module: '@cardstack/boxel-host/tools/run-realm-code'
        name: default
---

# Source Code Editing

Use the `run-realm-code` tool for every source-file creation or edit. Do not emit file edits as prose. The tool executes JavaScript in the isolated realm runner and applies the resulting operations only to the files supplied in the tool call.

Before editing, read the current contents of every target file. Include their URLs in `fileUrls`, and pass the workspace realm URL and room ID supplied by the host. Use `await Realm.replaceCode(fileUrl, exactCurrentText, replacement)` for an existing file. Use `await Realm.createFile(fileUrl, content)` for a new file.

Keep the script deterministic and narrowly scoped. Do not access browser globals, network services, credentials, or files outside the supplied file list. After the tool returns, inspect its result and address any correctness errors with another tool call.
