---
name: source-code-editing
description: Use when editing existing .gts or .json files via SEARCH/REPLACE blocks. Defines exact block format, matching rules, and recovery from failed matches. Required before issuing any code edit.
boxel:
  kind: skill
---

# Source Code Editing

## Pair with

- **`boxel`** — to know _what_ to change. This skill only describes the edit transport.
- **`boxel-environment`** — when the edit happens inside the live Boxel app (mode switching, file URL discovery).
- **`boxel-ui-guidelines`** — when the edit is a template change.

## Don't use for

- Writing brand-new files where the schema is still undecided. Decide the schema with `boxel` first.
- JSON instance data — `write-text-file` and `patch-fields` are often better for `.json` (this skill is mandatory for `.gts`).

When you infer that the user wants to make changes to the attached files, which is usually a card definition, or create new files, you must use a SEARCH/REPLACE block. For .gts files, ALWAYS use SEARCH/REPLACE — never use write-text-file for .gts. SEARCH/REPLACE blocks stream as visible text (the user sees progress), while tool calls like write-text-file do NOT stream (the UI appears frozen with "Thinking" / "Preparing tool call" while generating the full file content).

A SEARCH/REPLACE block has 2 sections: a section of code to search for, and the code to replace it with. All code within the SEARCH will be replaced. A SEARCH/REPLACE block can be used to either edit an existing file, or create a new file.

This is ABSOLUTELY CRUCIAL, WITHOUT THIS THE CODE PATCH WON'T WORK: in the beginning of the code block, before ╔═══ SEARCH ════╗ marker, add a line with the file url. If you are editing, this should be the attached file's url. If you are creating a new file, come up with a file name, and add it at the end of the provided realm url so that you form a file url, and use that.

Example adding an import:

```gts
https://example.com/attached-file-example.gts
╔═══ SEARCH ════╗
import { Component } from 'https://cardstack.com/base/card-api';
import { or } from '@cardstack/boxel-ui/helpers';
╠═══════════════╣
import { Component } from 'https://cardstack.com/base/card-api';
import { MarkdownField } from 'https://cardstack.com/base/markdown';
import { or } from '@cardstack/boxel-ui/helpers';
╚═══ REPLACE ═══╝
```

Example deleting a field by not including it in the replace block:

```gts
https://example.com/attached-file-example.gts
╔═══ SEARCH ════╗
  @field description = contains(StringField);
  @field categories = containsMany(Category);
  @field attemptsRemaining = contains(NumberField, {
    computeVia: function() {
      return 4; // Start with 4 attempts
    }
  });
╠═══════════════╣
  @field description = contains(StringField);
  @field categories = containsMany(Category);
╚═══ REPLACE ═══╝
```

Example changing text within a template:

```gts
https://example.com/attached-file-example.gts
╔═══ SEARCH ════╗
      <template>
      <div class="connections-game">
        <header class="game-header">
          <h1 class="game-title">Connections</h1>
          <div class="game-description">{{@model.description}}</div>
        </header>
╠═══════════════╣
      <template>
      <div class="connections-game">
        <header class="game-header">
          <h1 class="game-title">Connections Game</h1>
          <div class="game-description">{{@model.description}}</div>
        </header>
╚═══ REPLACE ═══╝
```

Example creating a new file (in this case it is _CRUCIAL_ to include "(new)" in the file URL line, after the URL, otherwise the SEARCH/REPLACE block WILL NOT be interpreted correctly:

```gts
http://users-realm/new-file-example.gts (new)
╔═══ SEARCH ════╗
╠═══════════════╣
import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class NewFileExample extends CardDef {
  static displayName = "New file example";
}
╚═══ REPLACE ═══╝
```

Every _SEARCH/REPLACE block_ must use this format:

1. The opening fence and code language, eg: ```gts
2. File url. If you are creating a new file, add '(new)', for example: https://example.com/file.gts (new). If you are editing an existing file, output just the url, without '(new')
3. In a new line, the start of search block: ╔═══ SEARCH ════╗
4. A contiguous chunk of lines to search for in the existing source code
5. The dividing line: ╠═══════════════╣
6. The lines to replace into the source code
7. The end of the replace block: ╚═══ REPLACE ═══╝
8. The closing fence: ```

Each of the three markers appears _EXACTLY ONCE_ per block: one ╔═══ SEARCH ════╗, one ╠═══════════════╣ dividing line, one ╚═══ REPLACE ═══╝. Never repeat the dividing line. Do NOT add a second ╠═══════════════╣ (or any marker) before the closing ╚═══ REPLACE ═══╝ — the replace section ends at ╚═══ REPLACE ═══╝, and anything you put after your replacement lines is treated as file content, so a stray marker gets written into the file as a literal line of box-drawing characters.

Every _SEARCH_ section must _EXACTLY MATCH_ the existing file content, character for character, including all comments, docstrings, etc.
If the file contains code or other data wrapped/escaped in json/xml/quotes or other containers, you need to propose edits to the literal contents of the file, including the container markup.

_SEARCH/REPLACE_ blocks will _only_ replace the first match occurrence.
Including multiple unique _SEARCH/REPLACE_ blocks if needed.
Include enough lines in each SEARCH section to uniquely match each set of lines that need to change.

Keep _SEARCH/REPLACE_ blocks concise.
Break large _SEARCH/REPLACE_ blocks into a series of smaller blocks that each change a small portion of the file.
Include just the changing lines, and a few surrounding lines if needed for uniqueness.
Do not include long runs of unchanging lines in _SEARCH/REPLACE_ blocks.

To move code within a file, use 2 _SEARCH/REPLACE_ blocks: 1 to delete it from its current location, 1 to insert it in the new location.

Pay attention to which filenames the user wants you to edit, especially if they are asking you to create a new file.

Avoid detailed description of the SEARCH/REPLACE blocks. For every SEARCH/REPLACE block write 1 sentence description max.

If you propose a search/replace block for file edits, it must be for the currently attached file(s), and not for those attached before the most recent one (unless you ask and get the user's approval).

Your new SEARCH/REPLACE blocks must target ONLY the content of currently attached files - the search portion must not target any of your previous suggestions since it is not guaranteed that your previous SEARCH/REPLACE blocks were applied. If you do not have the contents of the gts file you want to update, you must first use the tool read-file-for-ai-assistant\_[hash] tool to get the files contents, and only after that is complete, attempt to generate a SEARCH?REPLACe change.

If you recognize the user wants to edit a template, do a visual change to a card, or describe a certain implementation or style, then you must use a SEARCH/REPLACE block to perform an edit to the attached gts file, by default in the isolated template. Do not default to using the patchCardInstance tool function, unless the user asks you to change the supporting data of the card.

When you respond with a SEARCH/REPLACE block, do not refer to it as a SEARCH/REPLACE block in your prose responses, as this is an internal code structure that will get shown to user in a different format. If you need to refer to it, talk about it in a semantic way. For example, do not say 'I'll use a SEARCH/REPLACE block to add a template', but rather 'I'll add a border around the section'.

After emitting one or more SEARCH/REPLACE blocks, the user will need to apply the changes. Therefore, end your response after emitting all your SEARCH/REPLACE blocks instead of summarizing. You will be notified when the blocks have been applied, and you can summarize the updates that have been made then.

Never respond with '[Omitting previously suggested code change]', or '[Omitting previously suggested and applied code change]'. If you see that in historic context it means it was used to reduce its payload, but you should always respond with actual code when you are suggesting changes.
