---
validated: source-proven
---

# build-planning-cards-trio — three plan documents that ship as cards before the real schema

**What this gives you:** A reusable Stage-0 planning ritual for card families. Three CardDefs (`ArchitecturePlan`, `DataModelPlan`, `MicroMockups`) whose `static isolated` templates ARE the plan documents — pushed to the realm so the user can review the design visually in the same app where the cards will live. Without this stage, fitted views come out pedestrian because the data model isn't rich enough to compose with.

**When to use:** Any time you're about to write 2+ related CardDefs from scratch. The institutional-meerkat batch (10 kits, 70 CardDefs) skipped this stage and produced visually thin fitted views as a result. If you're tempted to "just start with `Product extends CardDef`," stop and write the plan trio first.

**The insight:** The agent has strong intrinsic design taste at stage 1 of the design playbook (mockup pass), but only if the schema gives it something to compose with. Thin schemas (name + description + date) produce thin designs — three lines of text with nothing visually distinctive. Stage 0 forces the agent to identify the SIGNATURE field of each CardDef (the hero image, the price, the rating, the brand mark) and to write sample data rich enough that real design choices have to be made.

The three plan cards split the planning workload into reviewable artifacts:

| Card               | What lives in `static isolated`                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ArchitecturePlan` | ASCII data-flow diagram ("user does X" → "AI interprets" → "structured entries") · multi-realm security model (which fields are sensitive vs operational) · pattern callouts                                                   |
| `DataModelPlan`    | Executive summary · table of contents · per-CardDef schema spec · enumerations · linkage diagrams · implementation roadmap                                                                                                     |
| `MicroMockups`     | Hi-fi mockups of each format (isolated / embedded / fitted / edit / narrow) at desktop AND mobile · design rules baked into the .gts comments ("✗ NO thick left borders", "✓ subtle bg tints") · the divider strategy decision |

Each one is a real CardDef with `prefersWideFormat = true` so the plan reads at full width.

## Recipe shape

```ts
// architecture-plan.gts
import { CardDef, Component } from 'https://cardstack.com/base/card-api';

export class ArchitecturePlan extends CardDef {
  static displayName = 'Architecture Plan';
  static prefersWideFormat = true;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='architecture-doc'>
        <header class='doc-header'>
          <span class='eyebrow'>LMS Architecture</span>
          <h1 class='doc-title'>How We Will Build It</h1>
          <p class='doc-subtitle'>Data model, field definitions, and card relationships behind the mockups.</p>
        </header>

        <section class='section'>
          <h2 class='section-title'>Data Flow Architecture</h2>
          <div class='diagram-card'>
            <pre class='diagram'>
┌─────────────────────────────────────────────────────────┐
│           THE DAILY FEED PRINCIPLE                       │
├─────────────────────────────────────────────────────────┤
│  Staff types: "Jamie finished lesson 45, scored 18/20"   │
│                          │                               │
│                          ▼                               │
│                ┌─────────────────┐                       │
│                │  AI INTERPRETS  │                       │
│                └────────┬────────┘                       │
│         ┌───────────────┼───────────────┐                │
│         ▼               ▼               ▼                │
│   AcademicEntry   CurriculumLog   GoalUpdate             │
│         └───────────────┼───────────────┘                │
│                         ▼                                │
│              Queries · Reports · Daily Communication     │
└─────────────────────────────────────────────────────────┘
            </pre>
          </div>
        </section>

        <section class='section'>
          <h2 class='section-title'>Multi-Realm Security</h2>
          <div class='realm-grid'>
            <div class='realm-card sensitive'>
              <div class='realm-badge'>🔒 SENSITIVE</div>
              <h3>HoS + Front Desk Only</h3>
              <ul>
                <li><code>StudentFullProfile</code> — medical, financial, legal</li>
                <li><code>ParentInfo</code> — full contact details</li>
              </ul>
            </div>
            <div class='realm-card operational'>
              <div class='realm-badge'>📋 OPERATIONAL</div>
              <h3>Teaching Staff</h3>
              <ul>
                <li><code>StudentStub</code> — name, photo, room, hireDate</li>
                <li><code>ActivityFeed</code> — daily entries</li>
              </ul>
            </div>
          </div>
        </section>
      </article>
      <style scoped>
        /* Editorial typography — read like a printed spec */
        .architecture-doc { font-family: 'Inter', system-ui, sans-serif; max-width: 72rem; margin: 0 auto; padding: clamp(2rem, 5vw, 4rem); color: #1a1a1a; }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.75rem; font-weight: 600; color: #6b7280; }
        .doc-title { font-family: 'Source Serif 4', Georgia, serif; font-size: clamp(2.5rem, 4vw, 4rem); font-weight: 300; line-height: 1.05; margin: 0.5rem 0; }
        .doc-subtitle { font-size: 1.125rem; color: #4b5563; max-width: 50rem; }
        .section { margin-top: 3rem; }
        .section-title { font-family: 'Source Serif 4', serif; font-size: 1.75rem; font-weight: 400; margin-bottom: 1rem; }
        .diagram-card { background: #f9f5ec; border: 1px solid #e5e0d0; padding: 1.5rem; border-radius: 4px; overflow-x: auto; }
        .diagram { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 0.75rem; line-height: 1.4; margin: 0; }
        .realm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 1rem; }
        .realm-card { padding: 1.5rem; border-radius: 4px; border: 1px solid #e5e7eb; }
        .realm-card.sensitive { background: #fef2f2; border-color: #fecaca; }
        .realm-card.operational { background: #f0fdf4; border-color: #bbf7d0; }
        .realm-badge { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 0.5rem; }
        .realm-card h3 { font-size: 1rem; margin: 0 0 0.75rem; }
        .realm-card ul { font-size: 0.9rem; padding-left: 1.25rem; margin: 0; }
        .realm-card code { font-family: 'JetBrains Mono', monospace; font-size: 0.85em; background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 2px; }
      </style>
    </template>
  };
}
```

`DataModelPlan` and `MicroMockups` follow the same shape — a CardDef whose `static isolated` is the rendered plan. The MicroMockups card is particularly heavy on design-rules comments at the top:

```gts
// ═══ DESIGN RULES ═══
// ✗ NO thick left borders with rounded corners (ugly pattern)
// ✗ NO gradients
// ✓ Use subtle background tints for emphasis
// ✓ Use badges/tags for status indicators
// ✓ Use top borders or full borders if border needed
```

These rules then constrain every sub-mockup in the file, so the final production CardDefs inherit the discipline.

## DataModelPlan — cycle discipline + thunk audit

While drafting the DataModelPlan card's field table, mark every `linksTo` / `linksToMany` whose target is **another CardDef in the same kit**. Add a `thunk` column; every such row gets a ●. Every one of those — on BOTH sides of the cycle — must use the `() => Class` form in production:

```ts
@field style = linksTo(() => Style);
@field referenceProjects = linksToMany(() => Project);
```

Default-to-thunk for every kit-internal link. Bare `linksTo(X)` works only when X is fully evaluated by decoration time; in a kit with back-edges the timing is unreliable. `cardOrThunk was undefined` fires at runtime with lint and TS both clean.

## MicroMockups — content matrix per CardDef per format (MANDATORY)

Every CardDef in the MicroMockups card MUST have an explicit per-format content matrix. Not "fitted goes in a CQ grid" — that's layout. The matrix is **content**: what fields appear, what wording register, what's hidden at each size.

```
## <CardName> · content matrix

isolated:      full document — every field, formal register
embedded:      identification + 2-3 status fields, peer-list register
fitted/large:  hero 60% + caption 40% — fields: <name>, <category>, <year>
fitted/medium: caption compresses — fields: <name>, <category>
fitted/small:  name + status dot only
atom:          single line, abbreviated wording ($61.3k not $61,320)
edit:          sectioned form; special editors for spatial fields
```

Same data, different register. A Quote isolated reads as a printed estimate; a Quote fitted reads as `Q0247 · Hawthorne · $61.3k · pending`; a Quote atom reads as `Q0247 · $61.3k`. The production agent copies these specs. Without them, fitted/embedded/atom land as data-empty cards that look styled but inform nothing.

## Anti-pattern checklist — the pedestrian mockup

Before declaring a MicroMockups card done, audit against:

- [ ] **All CardDefs in the family are covered** — not just the obvious one. The hard-to-compose cards (Material with its grain swatches, Quote-as-printed-contract, the app-card Home with prerendered grids) are exactly the ones a pedestrian pass skips, and they're exactly where the design challenge lives.
- [ ] **One signature drama move per card**, called out in source comments above its section:
  ```
  // AUDACIOUS MOVE: <one sentence>
  // PENTAGRAM WOULD: <one sentence>
  // TASTE MAKER REFUSES: <one sentence>
  ```
- [ ] **One oversize display moment per card** (clamp ≥ 4-6rem at max). Editorial-safe clamp(2rem, 3.5vw, 3rem) everywhere is pedestrian default.
- [ ] **One pull quote per card** — italic display serif, with leading rules, set big enough that body copy refuses to fight it.
- [ ] **Photo placeholders carry DIRECTION notes** (subject · crop · lighting · prop). "Gradient box labeled Photo" teaches no production agent anything.
- [ ] **Content matrix per CardDef per format** as above. Specifying isolated only and leaving fitted/embedded/atom blank is failure.
- [ ] **Brand-wide chrome conventions** (folio margin marks, edition stamps, plan-view treatment for spatial cards, monospace schedules) spec'd in a dedicated section.
- [ ] **Brand-story spread, not just the appendix** — BrandGuide previews must include cover/voice/founder pages, not only palette/type sheets.

## Gotchas

- **The plan cards are not the final cards.** They're scaffolding. Don't try to make `ArchitecturePlan` `linksTo` your real `Student` or `Order` — keep them standalone documents.
- **Push them to the realm.** Their value comes from being reviewable in the live app, not just as `.md` files. The user can scroll through the mockups, leave a `cardInfo.notes`, and revise the plan iteratively before any production schema is written.
- **Sample data MUST be in the plan.** The DataModelPlan should show 3-5 example dossiers per CardDef — real names, real prices, real photographs. If you skip this, the eventual mockup pass will produce lorem ipsum-looking cards.
- **Mobile mockups are required.** All cards must be responsive in BOTH `isolated` AND `edit`. The MicroMockups card needs to show mobile width for each format, not just desktop. The fitted view doubles as the responsive small-width view for most cards anyway, but the isolated mobile view needs deliberate thought.
- **Don't ship them outside the planning workspace.** These cards are tied to the design phase. After the production schema is built, archive them or keep them in a `_planning/` subfolder.
- **Subfolder placement strands instances.** If you move planning .gts files from root to a `plan/` subfolder mid-session, every instance's `adoptsFrom.module` still points at the old root location. Grep `adoptsFrom.module` across instance JSONs and rewrite paths in lockstep with the move.

## Source

- **Three CardDefs in the wild**, source-proven pattern: `/path/to/app.boxel.ai/.../actual-duck-82/architecture-plan.gts`, `data-model-plan.gts`, `micro-mockups.gts`. Each is a CardDef with `prefersWideFormat = true` whose isolated template renders the planning document inline.

## See also

- `boxel/references/design-playbook.md` "Planning before code — Stage 0" — the textual definition of what each plan card contains + ASCII templates.
- `theme-first-workflow` — runs AFTER stage 0, before stage 1 mockup.
- `app-card-home-with-search` — the production card-family entry point; built from the plan trio's deliverables.
- `cardinfo-override-title` — applies to plan cards too (use the document title).
