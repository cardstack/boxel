## Card directives (the Boxel extension)

Two forms reference a card by its full URL:

### Inline: `:card[URL]`

Renders the target card in **atom** format, inline with surrounding text.

```md
Written by :card[https://my.realm/Author/jane] for the team.
```

Use inline form when the card should flow with the sentence.

### Block: `::card[URL]`  or  `::card[URL | spec]`

Renders the target card in a block slot, separated from surrounding prose. Default format is **embedded**.

```md
See the latest post:

::card[https://my.realm/BlogPost/first-look]
```

The optional `| spec` after the URL controls size/format. The grammar:

| Spec                             | Meaning                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| *(no spec)*                      | Default — embedded                                                     |
| `embedded`                       | Embedded format (explicit)                                             |
| `isolated`                       | Isolated format (full detailed view)                                   |
| `fitted`                         | Fitted format at its container's natural size                          |
| `fitted <WxH>`                   | Fitted at an exact width × height in px, e.g. `fitted 400x200`         |
| `fitted <named>`                 | Fitted at a named size constant, e.g. `fitted strip`                   |
| `<WxH>`                          | Bare dimensions (fitted implied), e.g. `400x200`                       |
| `<named>`                        | Bare named constant (fitted implied), e.g. `strip`                     |
| `w:<N> h:<N>` (or either alone)  | Explicit width/height in px. Width accepts `%`, e.g. `w:50% h:200`     |

**Named size constants** are the 16 fitted format ids (`small-badge` … `expanded-card`), plus three shorthand aliases: `strip` (→ `single-strip`), `tile` (→ `regular-tile`), `grid-tile` (→ `cardsgrid-tile`). Ids and their pixel sizes are listed once, in `skills/boxel/references/fitted-formats.md`.

```md
Featured authors:

::card[https://my.realm/Author/jane | fitted 300x120]
::card[https://my.realm/Author/mohammed | strip]
::card[https://my.realm/Essay/manifesto | isolated]
```

If a spec fails to parse, the renderer emits the directive with no format override, so the card falls back to embedded with no error — validate specs before shipping.

### Unresolved references

If the renderer can't resolve a card URL (deleted, permissions, offline), the directive falls back to a muted pill badge showing the URL. Don't rely on card directives for content that must render without the Boxel runtime — plain markdown links (`[text](url)`) are safe everywhere.

### Inside code blocks

Card directives inside fenced or inline code are **not** converted — they render as literal text. Use this when you need to show directive syntax in documentation.
