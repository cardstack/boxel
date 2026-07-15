---
validated: source-proven
---

# layout-sectioned-record-with-nav — Long-record card with left sidebar TOC, scroll-spy active highlight, and badge cluster

**What this gives you:** A two-column isolated layout for a long record card. Left rail is a sticky navigation with one entry per `contains(FieldDef)` section, plus a cluster of conditional flag badges (IEP, Allergy, etc.) and an optional preview slot for a linked card. Right column is the section stack rendered via `<@fields.<section> @format='embedded' />`. The active section highlight tracks scrolling so the user always knows where they are in a long record.

**When to use:**
- **Long-record cards.** Student profiles, employee profiles, patient charts, contracts, project briefs, brand books, anything that runs >5 sections of dense content.
- **App-card hubs.** When a CardDef is the *one* place a user goes to manage an entity over time, and they need quick jumps between domains (Identity / Medical / Financial / Custody / IEP, or whatever your domain shape is).
- **Anything with `prefersWideFormat = true`** that has more than ~3 distinct conceptual sections. Without nav, users scroll past sections they want.

Don't use for short cards (≤3 sections) — the nav becomes overhead. Don't use as a generic "tabs" replacement either — the scroll-on-click semantics are different from tabs (a tab swaps content; nav scrolls within continuous content).

**The insight:** Boxel's `@fields.<section> @format='embedded'` delegation gives you each section's own embedded view for free. Compose them in a vertical stack with stable DOM ids (`<section id="section-<key>">`), then add a sticky `<nav>` on the left whose buttons call `element.scrollIntoView({ behavior: 'smooth' })`. The active state is `@tracked activeSection` — set on click; could be refined later with `IntersectionObserver` for true scroll-spy, but the click-to-set version is what most cards land on first.

The pattern composes naturally with `organize-sensitive-stub-pair` (the left rail also shows the linked stub preview and a "Sync" affordance), `theme-first-workflow` (use theme tokens for the sensitive banner + nav highlight), and `cardinfo-override-title` (the page title in the header comes from `cardInfo.name` or a primary field).

## Recipe shape

```ts
import { CardDef, Component, field, contains, linksTo } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IdentitySection, MedicalSection, /* … */ } from './sections';

export class LongRecord extends CardDef {
  static displayName = 'Long Record';
  static prefersWideFormat = true; // ← required; the 220px nav rail needs the width

  @field identity = contains(IdentitySection);
  @field medical  = contains(MedicalSection);
  // … one @field per section …

  static isolated = class Isolated extends Component<typeof this> {
    @tracked activeSection = 'identity'; // default to first section

    // Section list drives both the nav rail and (optionally) the section render order.
    sections = [
      { id: 'identity', label: 'Overview', icon: 'user'     },
      { id: 'medical',  label: 'Medical',  icon: 'medical'  },
      // …
    ];

    scrollToSection = (sectionId: string) => {
      this.activeSection = sectionId;
      const element = document.getElementById(`section-${sectionId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    <template>
      <article class='record'>
        <div class='record-layout'>
          {{!-- Left rail: header, nav buttons, badge cluster, optional stub preview --}}
          <nav class='record-nav'>
            <div class='nav-header'>
              <div class='nav-avatar'>{{@model.initials}}</div>
              <div class='nav-info'>
                <span class='nav-name'>{{@model.displayName}}</span>
                <span class='nav-id'>{{@model.recordId}}</span>
              </div>
            </div>
            <div class='nav-sections'>
              {{#each this.sections as |section|}}
                <button
                  class='nav-btn {{if (eq this.activeSection section.id) "active"}}'
                  type='button'
                  {{on 'click' (fn this.scrollToSection section.id)}}
                >
                  {{!-- icon switch by section.icon — see Gotchas --}}
                  <span>{{section.label}}</span>
                </button>
              {{/each}}
            </div>
            <div class='nav-badges'>
              {{!-- Conditional badges; rendered only when flags are set --}}
            </div>
          </nav>

          {{!-- Main content: header band + sections stack --}}
          <main class='record-main'>
            <header class='record-header'>
              {{!-- Avatar, title, metadata row, badge cluster --}}
            </header>
            <div id='section-identity' class='section-anchor'>
              <@fields.identity @format='embedded' />
            </div>
            <div id='section-medical' class='section-anchor'>
              <@fields.medical @format='embedded' />
            </div>
            {{!-- … one wrapper per section, each with the id Pattern --}}
          </main>
        </div>
      </article>
    </template>
  };
}
```

CSS skeleton:

```css
.record-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}
.record-nav {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  padding: 1.25rem;
  background: var(--surface-0, var(--background));
  border-right: 1px solid var(--border, var(--boxel-200));
}
.nav-btn {
  display: flex; align-items: center; gap: 0.5rem;
  width: 100%; padding: 0.5rem 0.75rem;
  background: transparent; border: 0; border-radius: var(--radius-md, var(--boxel-border-radius));
  text-align: left; cursor: pointer;
}
.nav-btn.active {
  background: var(--primary, var(--boxel-purple-100));
  color: var(--primary-foreground, var(--boxel-purple-900));
}
.record-main { padding: 1.5rem 2rem; max-width: 56rem; }
.section-anchor { scroll-margin-top: 1rem; }
```

## Section definitions

Each section is a `FieldDef` with its own `embedded` view. Keep them in a sibling `profile-sections.gts` (or split per section if they get long) so the record file stays focused on the layout shell:

```ts
// profile-sections.gts
import { FieldDef, Component, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';

export class IdentitySection extends FieldDef {
  static displayName = 'Identity';

  @field recordId  = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName  = contains(StringField);
  @field preferredName = contains(StringField);
  @field dateOfBirth = contains(DateField);

  @field displayName = contains(StringField, {
    computeVia: function (this: IdentitySection) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ') || 'Untitled';
    },
  });
  @field initials = contains(StringField, {
    computeVia: function (this: IdentitySection) {
      const f = this.firstName?.[0] ?? '', l = this.lastName?.[0] ?? '';
      return (f + l).toUpperCase() || '??';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <section class='section identity-section'>
        <h2 class='section-title'>Identity</h2>
        <dl class='section-grid'>
          <dt>Record ID</dt> <dd>{{@model.recordId}}</dd>
          <dt>Name</dt>      <dd>{{@model.displayName}}</dd>
          {{#if @model.preferredName}}
            <dt>Preferred</dt> <dd>{{@model.preferredName}}</dd>
          {{/if}}
        </dl>
      </section>
    </template>
  };
}
```

Pass-through computed fields on the parent CardDef (`@field displayName = contains(StringField, { computeVia: ... return this.identity?.displayName })`) keep the header band clean — the record's own template doesn't have to dig through the section to render the name.

## Linked stub preview in the nav

If the record is the sensitive half of an `organize-sensitive-stub-pair`, the left rail is a natural home for the linked stub preview:

```handlebars
{{#if @model.operationalStub}}
  <div class='nav-stub'>
    <span class='stub-label'>Public Record</span>
    {{#if this.needsSync}}
      <button type='button' {{on 'click' this.syncStub}}>Sync</button>
    {{/if}}
    <div class='stub-preview'>
      <@fields.operationalStub @format='fitted' />
    </div>
  </div>
{{/if}}
```

The fitted format keeps the preview compact in the 220px rail.

## Gotchas

- **`prefersWideFormat = true` is required.** Without it, the host gives you a narrow column and the 220px nav rail eats half the content.
- **Section ids vs section keys.** Use a single `sections = [{ id, label, icon }, …]` array as the source of truth; both the nav buttons and the section wrappers derive ids from it. Hand-syncing two lists is the most common bug.
- **Icon switching with `{{#if (eq section.icon 'user')}}` is verbose but explicit.** The alternative — passing a Glimmer component as `section.iconComponent` — runs into template-typing pain. Keep the if/else if chain unless you have 10+ icons; then move to a Map.
- **Scroll-spy via `IntersectionObserver` is a follow-up improvement.** Most cards land first with click-only highlight (set `activeSection` in the click handler). Wire IntersectionObserver later only if real users complain that the active state drifts during free scrolling.
- **`scroll-margin-top` on section wrappers.** Without it, scrolled-to sections land flush with the nav rail top edge. Set 1–2rem so the section title has breathing room above.
- **The nav header is sticky inside an `overflow-y: auto` rail.** That works on most browsers; old iOS Safari occasionally needs `-webkit-overflow-scrolling: touch` on the rail. Skip unless your audience demands it.
- **Theme tokens for `.nav-btn.active`.** Use the theme's primary color (or a section-specific accent), not a hard-coded purple. Theming a 6-color palette is part of the design playbook stage 2.
- **Mobile fallback.** At <800px, the grid collapses; the nav rail goes above the main, becomes a horizontal scroller. Test before shipping; otherwise the rail breaks the page.

## Source

- A `<long-record>.gts` card in the workspace, ~1100 lines including the nav rail, section anchors, scroll-to-section handler, header band, badge cluster, and the linked-stub preview. Section FieldDefs sit in a sibling `*-sections.gts`.
- Common shape across multiple real implementations in the workspace's school-LMS and HR-style realms; the layout transfers cleanly to any long-record domain.

## See also

- [`organize-sensitive-stub-pair`](../organize-sensitive-stub-pair/README.md) — paired pattern; sectioned records often have a public stub. The nav rail is a natural place for the stub preview + sync affordance.
- [`format-morph-shared-component`](../format-morph-shared-component/README.md) — when you want the edit + isolated views to share the same layout shell, morphing only the inputs.
- [`theme-first-workflow`](../theme-first-workflow/README.md) — every long-record card wants a brand theme before this template lands; the nav-highlight color and section accents come from there.
- [`cardinfo-override-title`](../cardinfo-override-title/README.md) — the header band's title comes from `cardInfo.name` first, primary field second.
- [`app-card-home-with-search`](../app-card-home-with-search/README.md) — when the record is part of a card family, the home app links into it.
