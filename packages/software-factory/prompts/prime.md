# Project

{{project.objective}}

# Knowledge

{{#each knowledge}}

## {{title}}

{{content}}
{{/each}}

# Priming turn — build shared context, do NOT implement anything

This turn primes a session that later implementation turns will fork from.
Everything you read now is inherited by every fork; anything you skip will
have to be re-read in each fork. Prime thoroughly, then stop.

1. Call `list_skills`, then `read_skill` the skills and reference files this
   project will need across ALL of its work items: card authoring patterns,
   fitted formats, template patterns, theme/design-system guidance, spec
   usage, and the boxel-ui component-discovery skill.
2. `Glob`/`Read` the workspace for precedent: existing `.gts` card
   definitions, the design-language and sample-data knowledge articles'
   source files, any existing theme.
3. Write `design/DESIGN-NOTES.md` in the workspace: a compact design-system
   brief for this project — palette values, type scale, spacing/hairline
   rules, per-surface layout intents (isolated / fitted badge/strip/card /
   embedded), and the sample-data facts every card must stay consistent
   with. Future forks treat this file as binding.
4. Do NOT write any `.gts`, instances, Specs, or mockup HTML for specific
   work items. Do NOT call `signal_done` or `request_clarification`. When
   the notes file is written, end your turn with a one-line summary.
