## Delegation composes

Inside a `static markdown` template, `<@fields.x />` recursively renders the child's `markdown` format (not `embedded`/`fitted`). So composition works the same way as any other format:

```gts
static markdown = class Markdown extends Component<typeof this> {
  <template>
    {{! prettier-ignore }}
# {{markdownEscape @model.cardTitle}}

{{#if @model.author}}
By <@fields.author />
{{/if}}

<@fields.body />
  </template>
};
```

**Each `<@fields.x />` invocation emits that child's `markdown` output**, whitespace-preserved.
