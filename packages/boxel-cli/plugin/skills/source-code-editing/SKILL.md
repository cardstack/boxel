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

Use the `run-realm-code` tool for every source-file creation or edit. Do not emit file edits as prose. The tool executes JavaScript in the isolated realm runner. Each `realm.fs` call goes to the host, which reads files in the given realm and saves each write before the call returns.

Before editing, read the current contents of every target file, with another tool or with `await realm.fs.readText(path)` in the script. Pass the workspace realm URL and room ID supplied by the host. Use `await realm.fs.replace(path, exactCurrentText, replacement)` for an existing file. Use `await realm.fs.writeText(path, content)` for a new file; it refuses a file that already exists. `path` is relative to the realm root, such as `person.gts`; a full file URL inside the realm also works. File content often contains backticks and `${`, for example a BXL `fx` expression or a template string in a computed field. If you put such content inside a JavaScript template literal, escape each backslash in it as `\\` first, then each backtick as `` \` `` and each `${` as `\${`. Without this, the script does not parse, or it saves different text without an error: `/\d+/` becomes `/d+/`, and `${name}` is replaced with a value. Escape the `exactCurrentText` argument of `realm.fs.replace` the same way, or it does not match the file. Use `await realm.fs.exists(path)` to check whether a file exists. Await every call. Write all files of a build in one call, within the limits of one call: at most 20 files (each path given to any `realm.fs` method counts), a script of at most 100,000 characters, and 55 seconds. Split a larger build across calls. A `.gts` or `.ts` write with lint errors that autofix cannot repair is refused, and the script stops there. Each write is saved when its call returns, so if the script fails partway, the files written before the failure stay saved; the error names them.

Keep the script deterministic and narrowly scoped. Do not access browser globals, network services, credentials, or files outside the given realm. After the tool returns, inspect its result and address any correctness errors with another tool call.
