## What it is

The **prose atoms** React agents type: `Title`, `Text`, `Paragraph`, `Code`, `Blockquote` and `Link`. Each renders the element its name promises: a Title is an `h1`–`h6`, a Paragraph a `<p>`, a Link an `<a href>`. Screen readers navigate by those tags, and styled divs that only look like headings are the failure these exist to prevent.

They are available as a namespace, `<Typography.Title>`, the way Ant and Mantine agents write them, and each is also exported on its own.

Reach for a neighbour in these cases:

- **Prose** styles a whole block of rendered markdown.
- **Token** is for machine values such as ids, hashes and paths (Law 3), not Code.
- **CodeBlock** is for a block of source.
- **Label** names a form control.

## The contract

```
Title        @level? (1–6; default 2), @size? ('display' | 'heading' | 'subheading')
Text         @tone? ('default' | 'muted' | 'success' | 'warning' | 'danger'), @size? ('xs' | 'sm' | 'md' | 'lg')
             @strong?, @italic?, @mark?, @strike?
Paragraph    @tone?, @size?
Code         (inline <code>)
Blockquote   @attribution?, @cite?
Link         @href, @external?, @variant? ('inline' | 'quiet')
Typography   { Title, Text, Paragraph, Code, Blockquote, Link }
```

**Title's level is structure; its size is look.** `@level` picks the tag and belongs to the document outline. `@size` decouples the appearance when a design wants an `h3` to look like a subheading. Level 1 defaults to display size, 2 and 3 to heading, and 4 to 6 to subheading.

**Text's flags are real tags.** `@strong` renders `<strong>`, `@italic` `<em>`, `@mark` `<mark>` and `@strike` `<s>`, so the meaning reaches assistive technology and copy-paste, not just the colour. `@strong` and `@italic` combine with each other and with either `@mark` or `@strike`. When both of those are set, `@mark` wins. `@tone` and `@size` style the outer span, and unknown values fall back to the default.

**Paragraph** keeps a readable measure (`--pretui-paragraph-measure`, default 68ch) and `text-wrap: pretty`.

**Blockquote is a `<figure>`** with the quote in a `<blockquote cite>` and `@attribution` as the `<figcaption>`, so the attribution belongs to the quote rather than being loose text after it.

**Link's `@external`** opens a new tab with `rel='noopener noreferrer'`, shows a ↗ and says "(opens in a new tab)" to screen readers. `@variant='quiet'` underlines on hover only, for links in dense UI. Prose links keep the underline.

## Prior art

**Ant `Typography`** has `Title` (`level` 1–5), `Text` (`type`, `strong`, `mark`, `code`, `delete`, `underline`, `italic`, `keyboard`, `copyable`, `editable`, `ellipsis`), `Paragraph` and `Link`. **Mantine** has `Title` (`order`), `Text` (`c`, `size`, `fw`, `td`), `Code`, `Blockquote` (`cite`, `icon`), `Mark` and `Anchor`. **MUI `Typography`** is one component with `variant` and `component`. **Chakra** has `Heading`, `Text`, `Code`, `Mark`, `Blockquote` and `Link`.

Where Pretui is better: **Title always renders a heading tag.** MUI's `variant="h1"` with `component="div"` is a common way to break the outline, and here the look and the level are separate args, so the tag is never lost. **External links are safe and announced by default.** **Blockquote pairs the attribution semantically.**

Where it is thinner: **no `copyable`, `editable` or `ellipsis`** on Text. Use **CopyButton**, **Editable** and CSS truncation. There is **no `underline` or `keyboard` flag**; use **Kbd** for keys. **No Title level beyond the tag**: there is no `h7` styling.

## Accessibility

No single APG pattern. These are the tags the patterns are made of.

- **Title renders `h1`–`h6`**, `h2` by default. The tests assert each tag. Keep the outline in order: don't skip from `h2` to `h4` for looks, use `@size`.
- **Text's emphasis is semantic.** The tests assert `<strong>`, `<mark>`, `<s>` and nested `<strong><em>`.
- **Blockquote's attribution is its `<figcaption>`.** The tests assert the figure, the `cite` and the caption.
- **External links announce the new tab** with a visually hidden "(opens in a new tab)", and the ↗ is `aria-hidden`. The tests assert `target`, `rel` and the announcement.
- **Tone is not the message.** A `danger` Text still has to say what went wrong.
- **Link text must make sense on its own.** Screen reader users list links out of context, so "cupping notes" beats "here".

## Theming

`--font-serif` (Title, Blockquote), `--font-sans` (subheading), `--font-mono` (Code), `--text-display`, `--text-heading`, `--text-body`, `--text-ui-xs` / `--text-ui-sm` / `--text-ui-md` / `--text-ui-lg`, `--weight-heading`, `--weight-strong`, `--track-heading`, `--leading-heading`, `--leading-body`, `--foreground`, `--muted-foreground`, `--success`, `--warning`, `--destructive` (tone inks mixed toward `--foreground`), `--pretui-text-mark` (the highlight, default `--warning`), `--pretui-paragraph-measure`, `--pretui-quote-rule` (default `--border`), `--pretui-link-ink` (default `--primary`), `--ring`, `--card` and `--radius-control` (Code's ground), and `--space-2` / `--space-4`.

A season restyles all prose through the font, size and weight tokens it already defines for the kit.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                                     | Give them                                   |
| ----------------------------------------------- | ------------------------------------------- |
| Ant `<Typography.Title level={2}>`              | `<Typography.Title @level={{2}}>`           |
| Ant `<Text type="secondary">`                   | `<Text @tone='muted'>`                      |
| Ant `strong` / `mark` / `delete` / `italic`     | `@strong` / `@mark` / `@strike` / `@italic` |
| Ant `code` / Mantine `<Code>`                   | `<Code>`, or **Token** for machine values   |
| Mantine `<Title order={3}>`                     | `<Title @level={{3}}>`                      |
| MUI `<Typography variant="h1" component="div">` | `<Title @level={{…}} @size='display'>`      |
| Mantine `<Anchor target="_blank">`              | `<Link @href @external={{true}}>`           |
| Ant `copyable` / `ellipsis`                     | **CopyButton** / CSS truncation             |
