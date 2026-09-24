// Pretui — the Component card: one card per catalog entry, each rendering
// its ember-freestyle usage page (ported machinery in freestyle.gts — the
// verbatim-reuse directive) inside Boxel. It extends the base Spec card, so
// every instance is findable by Spec type queries and carries a `ref` to the
// module that exports the component. Instances live in components/ as
// <kebab>-spec.json and are the source of truth. The isolated view loads the
// component's usage page when it renders (demo-locations.ts says where it
// lives). Components without a page fall back to an EmptyState; host-retained
// entries state the goal-2 split.
import {
  Component,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Spec } from 'https://cardstack.com/base/spec';
import { MarkdownDef } from 'https://cardstack.com/base/markdown-file-def';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { cssStyle } from './pretui-css';
import { fn } from '@ember/helper';
import type { Query, RealmResourceIdentifier } from '@cardstack/runtime-common';
import { ThemeFrame } from './components/theme-frame';
import { EmptyState } from './components/empty-state';
import {
  StatusChip,
  Token,
  statusHue,
} from './ink';
import { Button } from './components/button';
import { Textarea } from './components/textarea';
import { StepList } from './components/composites';
import type { StepItem, StepState } from './components/composites';
import { Popover } from './overlay';
import { demoModuleFor, loadDemo, loadExamples } from './demo-locations';
import type { DemoSubject } from './demo-locations';
import { iconFor } from './icon-registry';
import { ExampleGallery } from './example-gallery';
import type { ExampleSpec } from './examples-kit';

// Today's callers pass a statusHue() result, which is always a `var(--chart-N)`
// we built ourselves — but the hue originates in card data, so it goes through
// the kit-wide allowlist rather than straight to htmlSafe. Nothing unvalidated
// reaches an inline style anywhere in the kit.
function htmlSafeHue(hue: string) {
  return cssStyle('--pretui-fit-hue', hue);
}

// Structural shape of a PretuiNote instance as read off a getCards result.
// Declared rather than imported: pretui-note.gts imports THIS module for its
// linksTo target, so importing it back would make the pair circular. The
// query names the type by module + name strings instead.
interface NoteLike {
  id?: string;
  title?: string;
  note?: string;
  status?: string;
}

// The host supplies `context.actions.createCard` at runtime — the base
// library and the CRM app both call it — but the CardContext type shipped
// with the CLI does not declare it. A narrow structural cast, with the shape
// written out, rather than reaching for `any`.
type CreateCardAction = (
  ref: { module: string; name: string },
  realmURL: URL,
  opts: { realmURL: URL; doc: unknown },
) => unknown;

function createCardAction(context: unknown): CreateCardAction | undefined {
  return (
    context as { actions?: { createCard?: CreateCardAction } } | undefined
  )?.actions?.createCard;
}

// The note module, resolved from a PretUISpec instance id. Instances
// live at <realm>/components/<kebab>-spec, so the module is ONE LEVEL UP —
// './pretui-note' would resolve to <realm>/components/pretui-note,
// which does not exist, and a filter naming a module that does not exist
// matches nothing at all rather than erroring. Resolved relative to the
// instance (not hardcoded) so the kit still works copied into another realm.
function noteModuleHref(instanceId: string): string {
  return new URL('../pretui-note', instanceId).href;
}

// ── The sticky-note composer ─────────────────────────────────────────────
// A top-level component, not an inline block in the page: reactive state
// cannot live in a format-class expression (`static isolated = class …`),
// so the draft belongs here. Also the right seam — the composer owns
// nothing but the text, and hands a finished body to the page.
interface NoteComposerSignature {
  Args: {
    /** the component being annotated, for the composer's own label */
    componentName?: string;
    /** called with the trimmed body when the author commits */
    onSave: (body: string) => void;
  };
  Element: HTMLDivElement;
}

class NoteComposer extends GlimmerComponent<NoteComposerSignature> {
  @tracked draft = '';
  setDraft = (v: string) => (this.draft = v);
  get draftEmpty(): boolean {
    return this.draft.trim().length === 0;
  }
  save = () => {
    let body = this.draft.trim();
    if (!body) return;
    this.args.onSave(body);
    this.draft = '';
  };
  <template>
    <div class='note-compose' data-test-pretui-note-compose ...attributes>
      <span class='note-compose-cap'>Note on
        {{if @componentName @componentName 'this component'}}</span>
      <Textarea
        class='note-compose-field'
        @value={{this.draft}}
        @onInput={{this.setDraft}}
        @placeholder='What should change? Markdown welcome.'
        aria-label='Note text'
        data-test-pretui-note-draft
      />
      <div class='note-compose-foot'>
        <span class='note-compose-hint'>Picked up by the next triage pass.</span>
        <Button
          @tone='primary'
          @size='s'
          @disabled={{this.draftEmpty}}
          data-test-pretui-note-save
          {{on 'click' this.save}}
        >Stick it</Button>
      </div>
    </div>
    <style scoped>
      /* Widened past the popover's default through the knobs Popover
         exposes, rather than reaching into its panel with :deep() — a note
         wants room to write. */
      .note-compose {
        --pretui-popover-width: 320px;
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 6px);
        min-width: 280px;
      }
      .note-compose-cap {
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .note-compose-field {
        width: 100%;
      }
      .note-compose-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3, 10px);
      }
      .note-compose-hint {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

// ── Usage pages, loaded when a Spec renders ──────────────────────────────

class Loaded<T> {
  @tracked state: 'loading' | 'loaded' | 'missing' = 'loading';
  @tracked value: T | undefined;

  constructor(load: Promise<T | undefined>) {
    load.then(
      (value) => {
        this.value = value;
        this.state = value ? 'loaded' : 'missing';
      },
      () => {
        this.state = 'missing';
      },
    );
  }
}

const demoLoads = new Map<string, Loaded<unknown>>();
const exampleLoads = new Map<string, Loaded<ExampleSpec[]>>();

function demoLoadFor(subject: DemoSubject): Loaded<unknown> | undefined {
  let path = demoModuleFor(subject);
  if (!path) {
    return undefined;
  }
  let key = `${path}#${subject.name}`;
  let load = demoLoads.get(key);
  if (!load) {
    load = new Loaded(loadDemo(subject));
    demoLoads.set(key, load);
  }
  return load;
}

function examplesLoadFor(name: string): Loaded<ExampleSpec[]> {
  let load = exampleLoads.get(name);
  if (!load) {
    load = new Loaded(loadExamples(name));
    exampleLoads.set(name, load);
  }
  return load;
}

// ── The card ─────────────────────────────────────────────────────────────

export class PretUISpec extends Spec {
  static displayName = 'Pret UI Spec';
  static prefersWideFormat = true;

  @field componentName = contains(StringField);
  // boxel-ui icon export name ('@cardstack/boxel-ui/icons'), resolved at
  // render time via icon-registry.gts — data, never a static icon
  @field icon = contains(StringField);
  // ── taxonomy axes (catalog-taxonomy.md) ──
  // category = the primary user-facing home; tier = compositional
  // complexity; tags = cross-cutting capabilities. Independent axes — never
  // infer one from another.
  @field category = contains(StringField);
  @field tier = contains(StringField);
  @field tags = containsMany(StringField);
  @field ownership = contains(StringField);
  @field implementationStatus = contains(StringField);
  @field adoptionStatus = contains(StringField);
  @field introducedVersion = contains(StringField);
  // ── legacy axes, retained through the migration ──
  @field territory = contains(StringField);
  @field stage = contains(StringField);
  @field source = contains(StringField);
  @field lineage = contains(StringField);
  @field version = contains(StringField);
  @field brief = contains(StringField);
  // prose citation ('shadcn Button · wa-button'), not Spec's `ref` CodeRef
  @field refs = contains(StringField);
  @field buildsOn = contains(StringField);
  @field featured = contains(BooleanField);
  @field isNew = contains(BooleanField);
  @field hasDesign = contains(BooleanField);
  @field hasExamples = contains(BooleanField);
  @field liveInUse = contains(BooleanField);
  // cross-library demand signal, 1-5 — how many independent kits converged
  // on this component (sourcing/index.md dupe density)
  @field demand = contains(NumberField);
  // the write-up lives in the sibling <name>.md; the indexer extracts its
  // content into the linked MarkdownDef, so the .md stays the single source.
  // searchable puts that content in the spec's search doc, once.
  @field writeup = linksTo(() => MarkdownDef, { searchable: true });

  // each format is cast: Spec's format classes carry getters these views do not use
  static isolated = class Isolated extends Component<typeof PretUISpec> {
    get demoLoad() {
      let m = this.args.model;
      return m.componentName
        ? demoLoadFor({ name: m.componentName, stage: m.stage, tier: m.tier })
        : undefined;
    }
    get demo() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.demoLoad?.value as any;
    }
    get examples() {
      let name = this.args.model.componentName;
      return name ? examplesLoadFor(name).value : undefined;
    }
    get isDemoLoading() {
      return this.demoLoad?.state === 'loading';
    }
    get isHost() {
      return this.args.model.stage === 'host';
    }
    get isDemoExcluded() {
      let model = this.args.model;
      return model.stage === 'host' || model.tier === 'Runtime';
    }
    get demoPolicy() {
      if (this.demo) return 'included';
      if (this.isDemoLoading) return 'loading';
      return this.isDemoExcluded ? 'excluded' : 'missing';
    }
    get metaItems() {
      let m = this.args.model;
      let rows = [
        { key: 'Category', value: m.category ?? m.territory ?? '—' },
        { key: 'Tier', value: m.tier ?? '—' },
        { key: 'Stage', value: m.stage ?? '—' },
        // versions are earned by use — nothing worn shows no number
        ...(m.liveInUse
          ? [{ key: 'Version', value: m.version ?? '0.0.0' }]
          : []),
        { key: 'Source', value: m.source ?? '—' },
      ];
      if (m.buildsOn) {
        rows.push({ key: 'Builds on', value: m.buildsOn });
      }
      if (m.lineage) {
        rows.push({ key: 'boxel-ui lineage', value: m.lineage });
      }
      if (m.refs) {
        rows.push({ key: 'Elsewhere', value: m.refs });
      }
      return rows;
    }
    get facetPills() {
      let m = this.args.model;
      return [
        { label: 'design', on: m.hasDesign },
        { label: 'brief', on: Boolean(m.brief) },
        { label: 'impl', on: m.stage === 'live' },
        { label: 'examples', on: m.hasExamples },
        { label: 'in use', on: m.liveInUse },
      ];
    }
    get toolbarMeta() {
      let m = this.args.model;
      return `${m.territory ?? ''} · ${m.source ?? ''}`;
    }
    // the same five facets, handed to the kit's StepList as an ordered
    // pipeline: it owns the list semantics, the per-step state text and the
    // '5 of 5 complete' summary (which used to be a floating span here)
    get provenanceSteps(): StepItem[] {
      return this.facetPills.map((f) => ({
        label: f.label,
        state: (f.on ? 'complete' : 'upcoming') as StepState,
      }));
    }
    get railFacts() {
      let m = this.args.model;
      return [
        { label: 'Category', value: m.category ?? m.territory ?? '—', dim: true },
        { label: 'Tier', value: m.tier ?? '—', dim: true },
        {
          label: 'Stage',
          value: m.stage ?? 'planned',
          accent: m.stage === 'live',
        },
        ...(m.liveInUse
          ? [{ label: 'Version', value: m.version ?? '0.0.0' }]
          : []),
        { label: 'Source', value: m.source ?? '—', dim: true },
        ...(m.lineage
          ? [{ label: 'Lineage', value: `boxel-ui/${m.lineage}`, dim: true }]
          : []),
        ...(this.demandDots
          ? [{ label: 'Demand', value: this.demandDots, accent: true }]
          : []),
      ];
    }
    get demandDots() {
      let d = this.args.model.demand;
      if (!d || d < 1) return undefined;
      let n = Math.min(5, Math.round(d));
      return '●'.repeat(n) + '○'.repeat(5 - n);
    }
    get titleHue() {
      return htmlSafeHue(statusHue(this.args.model.stage ?? 'planned'));
    }
    openCatalog = () => {
      if (!this.args.model.id) return;
      this.args.viewCard?.(
        new URL('../PretuiCatalog/catalog', this.args.model.id),
        'isolated',
      );
    };

    // ── Sticky notes ───────────────────────────────────────────────────
    // Notes are their own cards (pretui-note.gts) that LINK to this one, so
    // the page finds its annotations by querying that edge. This file does
    // NOT import PretuiNote: the query names the type by module + name
    // strings, which keeps the dependency one-directional (note → component)
    // and avoids a cycle.
    notesResource = this.args.context?.getCards?.(
      this,
      (): Query | undefined => {
        let id = this.args.model.id;
        if (!id) return undefined;
        return {
          filter: {
            on: {
              // A CodeRef module is a branded URL type: a string LITERAL
              // satisfies it, but a runtime-computed href is plain `string`.
              module: noteModuleHref(id) as RealmResourceIdentifier,
              name: 'PretuiNote',
            },
            // The id stays in its branded RealmResourceIdentifier form —
            // that is exactly what an `.id` query value is typed as.
            eq: { 'target.id': id },
          },
        };
      },
      () => {
        let id = this.args.model.id;
        // instance id .../pretui/components/<kebab>-spec → realm root
        return id ? [new URL('../', id).href] : undefined;
      },
    );

    get notes(): NoteLike[] {
      return (this.notesResource?.instances ?? []) as NoteLike[];
    }
    get openNotes(): NoteLike[] {
      return this.notes.filter(
        (n) => (n.status ?? '').toLowerCase() !== 'addressed',
      );
    }
    get addressedCount(): number {
      return this.notes.length - this.openNotes.length;
    }
    get canAddNote(): boolean {
      return Boolean(createCardAction(this.args.context));
    }
    // Nothing to show is nothing to render: without this the aside would
    // still occupy a grid row (and its gap) on every page in a prerender or
    // test context, where createCard is absent and there are no notes.
    get showNotes(): boolean {
      return this.openNotes.length > 0 || this.canAddNote;
    }

    openNote = (id: string | undefined) => {
      if (!id) return;
      this.args.viewCard?.(new URL(id), 'isolated');
    };

    // The composer is a popover, so leaving a note never takes you off the
    // page you are annotating. The note card is created only on save — an
    // abandoned composer leaves nothing behind, where create-then-edit would
    // strew empty notes through the realm.
    saveNote = (close: () => void, body: string) => {
      let id = this.args.model.id;
      let create = createCardAction(this.args.context);
      if (!id || !create || !body) return;
      let realmURL = new URL('../', id);
      let ref = { module: noteModuleHref(id), name: 'PretuiNote' };
      // The timestamp is stamped HERE, in an event handler, not in a getter.
      // The no-clock rule exists so that RENDER is deterministic (the same
      // card must prerender identically); recording when a note was written
      // is data capture at the moment of a user action, which is exactly
      // what a timestamp is for.
      let noted = new Date().toISOString().slice(0, 10);
      create(ref, realmURL, {
        realmURL,
        doc: {
          data: {
            type: 'card',
            attributes: { note: body, status: 'open', noted },
            relationships: { target: { links: { self: id } } },
            meta: { adoptsFrom: ref },
          },
        },
      });
      close();
    };

    <template>
      <ThemeFrame
        @theme={{@model.cardTheme}}
        @context={{@context}}
        @bar={{false}}
        as |ThemeControls|
      >
      <article class='page' data-demo-policy={{this.demoPolicy}}>
        <nav class='wb-topbar'>
          <div class='wb-crumb'>
            <button
              type='button'
              class='wb-crumb-link'
              {{on 'click' this.openCatalog}}
            >Pretui</button>
            <span class='wb-sep'>/</span>
            <span class='wb-crumb-dim'>{{if
                @model.category
                @model.category
                (if @model.territory @model.territory 'components')
              }}</span>
            <span class='wb-sep'>/</span>
            <span class='wb-here'>{{if
                @model.componentName
                @model.componentName
                'Component'
              }}</span>
          </div>
          <div class='wb-badges'>
            {{#if @model.liveInUse}}
              <Token @value={{if @model.version @model.version '0.0.0'}} />
            {{/if}}
            <StatusChip @value={{if @model.stage @model.stage 'planned'}} />
            {{#if @model.isNew}}<span class='flag flag-new'>NEW</span>{{/if}}
            {{#if @model.featured}}<span class='flag flag-feat'>★</span>{{/if}}
          </div>
          <div class='wb-grow'></div>
          <ThemeControls />
        </nav>

        {{! Sticky notes live top-right, where you left them. Visible by
            design: an annotation hidden behind a disclosure is an annotation
            nobody reads. }}
        {{#if this.showNotes}}
          <aside
            class='notes'
            aria-label='Sticky notes on this component'
            data-test-pretui-notes
          >
            {{! The trigger sits FIRST — directly under the theme control and
                above the artboard — so leaving a note is a fixed target on
                every page, not something that moves as notes accumulate. }}
            <div class='notes-foot'>
              {{#if this.canAddNote}}
                <Popover @placement='bottom-end' @label='Leave a sticky note'>
                  <:trigger as |open toggle|>
                    <button
                      type='button'
                      class='note-add'
                      aria-expanded={{if open 'true' 'false'}}
                      data-test-pretui-note-add
                      {{on 'click' toggle}}
                    >+ Note</button>
                  </:trigger>
                  <:default as |close|>
                    <NoteComposer
                      @componentName={{@model.componentName}}
                      @onSave={{fn this.saveNote close}}
                    />
                  </:default>
                </Popover>
              {{/if}}
              {{#if this.addressedCount}}
                <span class='notes-done'>{{this.addressedCount}} addressed</span>
              {{/if}}
            </div>
            {{#if this.openNotes}}
              <ul class='notes-list'>
                {{#each this.openNotes key='id' as |n|}}
                  <li>
                    <button
                      type='button'
                      class='note'
                      data-test-pretui-note
                      {{on 'click' (fn this.openNote n.id)}}
                    >
                      <span class='note-text'>{{if
                          n.note
                          n.note
                          'Empty note'
                        }}</span>
                    </button>
                  </li>
                {{/each}}
              </ul>
            {{/if}}
          </aside>
        {{/if}}
        <h1 class='wb-title'>
          {{#let (iconFor @model.icon) as |TitleIcon|}}
            {{#if TitleIcon}}
              <span class='wb-title-frame' style={{this.titleHue}}>
                <TitleIcon class='wb-title-icon' role='presentation' />
              </span>
            {{/if}}
          {{/let}}
          {{if @model.componentName @model.componentName 'Component'}}
        </h1>
        {{#unless this.demo}}
          {{#if @model.brief}}
            <p class='brief'>{{@model.brief}}</p>
          {{/if}}
        {{/unless}}
        <div class='wb-work'>
          {{#if this.demo}}
            <this.demo />
          {{else if this.isDemoLoading}}
            <section class='panel' aria-busy='true'></section>
          {{else if this.isDemoExcluded}}
            <section class='panel'>
              {{#if this.isHost}}
                <EmptyState
                  @title='Catalog infrastructure — demo excluded'
                  @message='Host chrome stays in boxel-ui by design. It is indexed here for vocabulary coverage, not as a Pretui demo target.'
                />
              {{else}}
                <EmptyState
                  @title='Catalog infrastructure — demo excluded'
                  @message='This Runtime primitive builds the fitting room itself. It is indexed for API coverage and explicitly excluded from missing-demo QA.'
                />
              {{/if}}
            </section>
          {{else}}
            <section class='panel'>
              <EmptyState
                @title='No usage page yet'
                @message='This component has no freestyle page in the fitting room yet — see the kit showcase for the territory rail.'
              />
            </section>
          {{/if}}
        </div>
        <ExampleGallery @specs={{this.examples}} />
        {{#if @model.writeup}}
          <section class='wb-panel' aria-label='Write-up'>
            <div class='wb-panel-h'>
              <span class='wb-cap'>Write-up</span>
            </div>
            <@fields.writeup @format='embedded' />
          </section>
        {{/if}}
        <div class='wb-below'>
          <section class='wb-panel' aria-label='Provenance'>
            <div class='wb-panel-h'>
              <span class='wb-cap'>Provenance</span>
            </div>
            <StepList
              class='wb-pipe'
              @steps={{this.provenanceSteps}}
              @variant='track'
              @label='Provenance pipeline'
              @summary={{true}}
            />
            <dl class='wb-kv'>
              {{#each this.metaItems as |row|}}
                <div class='wb-krow'>
                  <dt>{{row.key}}</dt>
                  <dd>{{row.value}}</dd>
                </div>
              {{/each}}
            </dl>
          </section>
          <aside class='wb-rail' aria-label='Component facts'>
            <div class='wb-igroup'>
              <span class='wb-cap'>Component</span>
              {{#each this.railFacts as |f|}}
                <div class='wb-irow'>
                  <span class='wb-ilabel'>{{f.label}}</span>
                  <span
                    class='wb-ival'
                    data-dim={{if f.dim 'true'}}
                    data-accent={{if f.accent 'true'}}
                  >{{f.value}}</span>
                </div>
              {{/each}}
            </div>
            <div class='wb-igroup'>
              <span class='wb-cap'>Provenance</span>
              {{#each this.facetPills as |f|}}
                <div class='wb-irow'>
                  <span class='wb-ilabel'>{{f.label}}</span>
                  <span
                    class='wb-ival'
                    data-accent={{if f.on 'true'}}
                    data-dim={{unless f.on 'true'}}
                  >{{if f.on '✓' '—'}}</span>
                </div>
              {{/each}}
            </div>
          </aside>
        </div>
      </article>
      </ThemeFrame>
      <style scoped>
        .page {
          min-height: 100%;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-sans);
          font-size: var(--text-body, 15px);
          letter-spacing: var(--track-ui, 0.01em);
          padding: 0 var(--space-6, 19px) var(--space-8, 34px);
          display: grid;
          gap: var(--space-5, 14px);
          align-content: start;
        }
        /* ── workbench chrome (pretui-alert-workbench format) ── */
        .wb-title {
          margin: 6px 0 -4px;
          font-family: var(--font-serif);
          font-size: var(--text-display, 33px);
          font-weight: var(--weight-heading, 700);
          letter-spacing: var(--track-heading, -0.02em);
          line-height: 1.1;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        /* the icon sits framed — same box language as catalog cells and
           the fitted disc: stage hue tint + hairline, fixed scale */
        .wb-title-frame {
          display: grid;
          place-items: center;
          width: 40px;
          height: 40px;
          flex: none;
          border-radius: 9px;
          background: color-mix(in oklch, var(--pretui-fit-hue, var(--chart-1)) 14%, var(--card));
          box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--pretui-fit-hue, var(--chart-1)) 32%, var(--border));
          color: color-mix(in oklch, var(--pretui-fit-hue, var(--chart-1)) 60%, var(--foreground));
          --icon-color: currentColor;
          --icon-bg: none;
        }
        .wb-title-icon {
          width: 22px;
          height: 22px;
        }
        .wb-topbar {
          position: sticky;
          top: 0;
          /* kit stacking scale (pretui-css.gts): sticky page chrome sits
             above content and well below every floating surface, so a menu
             opened FROM this bar clears it. */
          z-index: var(--pretui-z-sticky, 10);
          display: flex;
          align-items: center;
          gap: var(--space-4, 11px);
          min-height: 44px;
          margin: 0 calc(-1 * var(--space-6, 19px));
          padding: 6px var(--space-6, 19px);
          background: var(--card);
          box-shadow: inset 0 -1px 0 var(--border);
          flex-wrap: wrap;
        }
        .wb-crumb {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: var(--text-ui, 12px);
          color: var(--muted-foreground);
          min-width: 0;
        }
        .wb-crumb-link {
          font: inherit;
          color: inherit;
          background: none;
          border: 0;
          padding: 3px 5px;
          border-radius: 4px;
          cursor: pointer;
        }
        .wb-crumb-link:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .wb-sep {
          color: var(--ink-3, var(--boxel-400));
          user-select: none;
        }
        .wb-here {
          color: var(--foreground);
          font-weight: 600;
        }
        .wb-badges {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: 2px;
        }
        .wb-grow {
          flex: 1;
        }
        .wb-work {
          min-width: 0;
        }
        /* ── Sticky notes ────────────────────────────────────────────────
           Pinned to the right edge of the page column, above the title, so
           an annotation is the first thing you see on a page that has one.
           justify-self keeps the rail narrow instead of stretching across
           the grid column. */
        .notes {
          justify-self: end;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--space-2, 6px);
          width: min(280px, 100%);
          min-width: 0;
        }
        .notes-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 6px);
          width: 100%;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .note {
          /* Law 2: one hue in, a complete treatment out — a tint of the hue
             over --card with ink derived from the same hue, so the sticky
             holds contrast in light and dark with no branch. */
          --hue: var(--pretui-note-hue, var(--chart-3));
          width: 100%;
          text-align: left;
          padding: var(--space-3, 10px);
          border: 0;
          border-radius: var(--radius-surface, 10px);
          background: color-mix(in oklch, var(--hue) 14%, var(--card));
          /* Law 1: depth is hairline + shadow, never contrast. */
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.2),
            0 2px 6px rgb(0 0 0 / 0.2)
          );
          font: inherit;
          font-size: var(--text-ui-md, 12.5px);
          line-height: 1.5;
          color: var(--foreground);
          cursor: pointer;
        }
        .note:hover {
          box-shadow: var(
            --pretui-shadow-raised,
            0 0 0 1px var(--border),
            0 2px 10px rgb(0 0 0 / 0.22)
          );
        }
        .note:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* Clamp long notes: the rail is a pointer to the note card, not the
           note card. Clicking opens the whole thing. */
        .note-text {
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
          /* a pasted URL or a long identifier is one "word" — without this
             it blows the rail out of the narrow-pane layout instead of
             clamping */
          overflow-wrap: anywhere;
        }
        .notes-foot {
          display: flex;
          align-items: center;
          gap: var(--space-3, 10px);
        }
        .note-add {
          padding: 3px 9px;
          border: 0;
          border-radius: var(--radius-control, 7px);
          background: transparent;
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .note-add:hover {
          background: var(--card);
          color: var(--foreground);
        }
        .note-add:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .notes-done {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
        }
        /* The composer inside the popover. Widened past the popover's default
           through the knobs Popover exposes, rather than reaching into its
           panel with :deep() — a note wants room to write. */
        .note-compose {
          --pretui-popover-width: 320px;
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 6px);
          min-width: 280px;
        }
        .note-compose-cap {
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: var(--track-eyebrow, 0.06em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .note-compose-field {
          width: 100%;
        }
        .note-compose-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3, 10px);
        }
        .note-compose-hint {
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
        }
        /* the below-the-demo band: panels left, facts rail right — the rail
           column matches FreestyleUsage's 280px properties rail so the two
           read as one continuous inspector */
        .wb-below {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 280px;
          gap: var(--space-5, 14px);
          align-items: start;
        }
        @media (max-width: 1100px) {
          .wb-below {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .wb-panel {
          background: var(--card);
          border-radius: 6px;
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          overflow: hidden;
          min-width: 0;
        }
        .wb-panel-h {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 36px;
          padding: 8px var(--space-4, 11px);
          box-shadow: inset 0 -1px 0 var(--border);
        }
        /* THE caps treatment — panel and group headers only (type spec:
           one caps style, everything else sentence case) */
        .wb-cap {
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        /* the provenance rail is the kit's StepList in its track variant —
           the panel only positions it; every bar, glyph, state text and the
           completion summary belong to the component */
        .wb-pipe {
          padding: 12px var(--space-4, 11px) 6px;
        }
        .wb-kv {
          margin: 0;
          padding: 4px 0 6px;
        }
        .wb-krow {
          display: grid;
          grid-template-columns: 110px minmax(0, 1fr);
          gap: 12px;
          padding: 6.5px var(--space-4, 11px);
          align-items: baseline;
        }
        .wb-krow:hover {
          background: var(--stripe, var(--boxel-100));
        }
        .wb-krow dt {
          font-size: var(--text-ui, 12px);
          font-weight: 500;
          color: var(--muted-foreground);
        }
        .wb-krow dd {
          margin: 0;
          font-size: var(--text-ui-md, 12.5px);
          overflow-wrap: anywhere;
        }
        .wb-rail {
          display: grid;
          gap: 0;
          background: var(--card);
          border-radius: 6px;
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          align-self: start;
          overflow: hidden;
        }
        .wb-igroup {
          padding: 10px var(--space-4, 11px) 14px;
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .wb-igroup:last-child {
          box-shadow: none;
        }
        .wb-igroup > .wb-cap {
          display: block;
          margin-bottom: 10px;
        }
        .wb-irow {
          display: grid;
          grid-template-columns: 76px minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          margin-bottom: 8px;
        }
        .wb-irow:last-child {
          margin-bottom: 0;
        }
        .wb-ilabel {
          font-size: var(--text-ui, 12px);
          font-weight: 500;
          color: var(--muted-foreground);
        }
        .wb-ival {
          font-family: var(--font-mono);
          font-size: var(--text-ui, 12px);
          color: var(--foreground);
          overflow-wrap: anywhere;
        }
        .wb-ival[data-dim='true'] {
          color: var(--muted-foreground);
        }
        .wb-ival[data-accent='true'] {
          color: var(--pretui-accent, var(--primary));
        }
        .wb-pad {
          padding: 10px var(--space-4, 11px);
        }
        .panel {
          background: var(--card);
          border-radius: var(--radius-surface, 10px);
          box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
          padding: var(--space-5, 14px);
          display: grid;
          gap: var(--space-4, 11px);
          align-content: start;
        }
        .brief {
          margin: 0;
          max-width: 78ch;
          font-size: var(--text-ui-md, 12.5px);
          line-height: 1.5;
          color: var(--muted-foreground);
        }
        /* flags share the single caps treatment, sized to chip scale */
        .flag {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          border-radius: 999px;
          padding: 2px 8px;
        }
        .flag-new {
          color: var(--pretui-attention-ink, var(--boxel-fuschia));
          background: color-mix(in oklch, var(--pretui-attention, var(--boxel-fuschia)) 14%, var(--card));
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-attention, var(--boxel-fuschia)) 35%, var(--border));
        }
        .flag-feat {
          color: color-mix(in oklch, var(--warning, var(--boxel-warning)) 75%, var(--foreground));
          background: color-mix(in oklch, var(--warning, var(--boxel-warning)) 13%, var(--card));
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--warning, var(--boxel-warning)) 35%, var(--border));
        }
      </style>
    </template>
  } as unknown as typeof Spec.isolated;

  static fitted = class Fitted extends Component<typeof PretUISpec> {
    get hue() {
      return statusHue(this.args.model.stage ?? 'planned');
    }
    get monogram() {
      return (this.args.model.componentName ?? '?').charAt(0);
    }
    get monoStyle() {
      return htmlSafeHue(this.hue);
    }
    <template>
      {{! The container element and the element the queries STYLE must be
          two different elements. An unnamed `@container` resolves against
          the nearest ancestor container — so a rule that restyles the
          container itself can never be written unnamed, and naming it is a
          realm law violation that silently deletes every rule after it.
          `fitted.gts` solves this with an outer container plus an inner
          root; this is the same shape. }}
      <div class='fit' data-test-pretui-component-fitted>
        <div class='fit-root'>
          <div class='mono' style={{this.monoStyle}}>
            {{#let (iconFor @model.icon) as |FitIcon|}}
              {{#if FitIcon}}
                <FitIcon class='mono-icon' role='presentation' />
              {{else}}
                {{this.monogram}}
              {{/if}}
            {{/let}}
          </div>
          <div class='fit-body'>
            <div class='fit-name'>
              {{@model.componentName}}
              {{#if @model.featured}}<span class='fit-star'>★</span>{{/if}}
            </div>
            <div class='fit-sub'>
              <span class='fit-terr'>{{if
                  @model.category
                  @model.category
                  @model.territory
                }}</span>
              {{#if @model.liveInUse}}
                <span class='fit-ver'>{{@model.version}}</span>
              {{/if}}
            </div>
            <div class='fit-extra'>
              <StatusChip @value={{if @model.stage @model.stage 'planned'}} />
              {{#if @model.isNew}}<span class='fit-new'>NEW</span>{{/if}}
            </div>
            {{#if @model.brief}}<div class='fit-brief'>{{@model.brief}}</div>{{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .fit {
          container-type: size;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        .fit-root {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          background: var(--card);
          font-family: var(--font-sans);
          overflow: hidden;
          box-sizing: border-box;
        }
        .mono {
          flex: none;
          width: 30px;
          height: 30px;
          border-radius: 9px;
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: 15px;
          background: color-mix(in oklch, var(--pretui-fit-hue, var(--chart-1)) 16%, var(--card));
          color: color-mix(in oklch, var(--pretui-fit-hue, var(--chart-1)) 60%, var(--foreground));
          box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--pretui-fit-hue, var(--chart-1)) 32%, var(--border));
        }
        .mono {
          --icon-color: currentColor;
          --icon-bg: none;
        }
        .mono-icon {
          width: 60%;
          height: 60%;
        }
        .fit-body {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .fit-name {
          font-weight: 600;
          font-size: var(--text-ui-md, 12.5px);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-star {
          color: var(--warning, var(--boxel-warning));
        }
        .fit-sub {
          display: flex;
          gap: 8px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .fit-extra,
        .fit-brief {
          display: none;
        }
        .fit-new {
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--pretui-attention-ink, var(--boxel-fuschia));
        }
        /* badge: monogram + name only */
        @container ((max-width: 139px) or (max-height: 47px)) {
          .fit-root {
            gap: 7px;
            padding: 5px 8px;
          }
          .mono {
            width: 22px;
            height: 22px;
            font-size: 12px;
            border-radius: 7px;
          }
          .fit-sub {
            display: none;
          }
        }
        /* tile & card: stack vertically, grow the monogram */
        @container ((min-width: 140px) and (min-height: 140px)) {
          .fit-root {
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-end;
            padding: 12px;
            gap: 8px;
          }
          .mono {
            width: 44px;
            height: 44px;
            font-size: 22px;
            border-radius: 12px;
          }
          .fit-extra {
            display: flex;
            align-items: center;
            gap: 7px;
          }
        }
        /* full card: show the brief */
        @container ((min-width: 190px) and (min-height: 220px)) {
          .fit-brief {
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
            overflow: hidden;
            font-size: var(--text-ui-sm, 11.5px);
            color: var(--muted-foreground);
            line-height: 1.45;
            white-space: normal;
          }
        }
      </style>
    </template>
  } as unknown as typeof Spec.fitted;

  static embedded = class Embedded extends Component<typeof PretUISpec> {
    <template>
      <div class='tile'>
        <div class='tile-head'>
          <span class='tile-name'>{{@model.componentName}}</span>
          <StatusChip @value={{if @model.stage @model.stage 'planned'}} />
        </div>
        <div class='tile-meta'>
          <span class='territory'>{{if
              @model.category
              @model.category
              @model.territory
            }}</span>
          <Token @value={{if @model.source @model.source 'design-v1'}} />
        </div>
      </div>
      <style scoped>
        .tile {
          padding: var(--space-4, 11px) var(--space-5, 14px);
          display: grid;
          gap: var(--space-3, 8px);
          align-content: start;
        }
        .tile-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3, 8px);
        }
        .tile-name {
          font-weight: 600;
          font-size: var(--text-ui-md, 12.5px);
        }
        .tile-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3, 8px);
        }
        .territory {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  } as unknown as typeof Spec.embedded;

  // Hand-written: Spec's own edit template throws without a resolved ref, and
  // the default field editor surfaces ten inherited fields this card never sets.
  static edit = class Edit extends Component<typeof PretUISpec> {
    <template>
      <div class='wb-edit'>
        <fieldset class='wb-group'>
          <legend>Identity</legend>
          <div class='wb-fields'>
            <label>Name <@fields.componentName /></label>
            <label>Icon <@fields.icon /></label>
            <label class='wb-wide'>Brief <@fields.brief /></label>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Taxonomy</legend>
          <div class='wb-fields'>
            <label>Category <@fields.category /></label>
            <label>Tier <@fields.tier /></label>
            <label>Ownership <@fields.ownership /></label>
            <label>Implementation <@fields.implementationStatus /></label>
            <label>Adoption <@fields.adoptionStatus /></label>
            <label>Introduced in <@fields.introducedVersion /></label>
            <div class='wb-wide'>
              <span class='wb-cap'>Tags</span>
              <@fields.tags />
            </div>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Provenance</legend>
          <div class='wb-fields'>
            <label>Source <@fields.source /></label>
            <label>Lineage <@fields.lineage /></label>
            <label>Version <@fields.version /></label>
            <label>Builds on <@fields.buildsOn /></label>
            <label class='wb-wide'>References <@fields.refs /></label>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Signals</legend>
          <div class='wb-fields'>
            <label>Demand (1-5) <@fields.demand /></label>
            <label class='wb-flag'><@fields.featured /> Featured</label>
            <label class='wb-flag'><@fields.isNew /> New</label>
            <label class='wb-flag'><@fields.hasDesign /> Has design</label>
            <label class='wb-flag'><@fields.hasExamples /> Has examples</label>
            <label class='wb-flag'><@fields.liveInUse /> Live in use</label>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Legacy axes</legend>
          <div class='wb-fields'>
            <label>Territory <@fields.territory /></label>
            <label>Stage <@fields.stage /></label>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Write-up</legend>
          <div class='wb-fields'>
            <label class='wb-wide'>Linked file <@fields.writeup /></label>
          </div>
        </fieldset>
      </div>
      <style scoped>
        .wb-edit {
          display: grid;
          gap: var(--space-5, 14px);
          padding: var(--space-5, 14px);
        }
        .wb-group {
          border: 1px solid var(--border);
          border-radius: var(--radius-md, 8px);
          padding: var(--space-4, 11px) var(--space-5, 14px)
            var(--space-5, 14px);
          margin: 0;
          min-width: 0;
        }
        .wb-group > legend {
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
          padding-inline: var(--space-2, 6px);
        }
        .wb-fields {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--space-3, 8px) var(--space-4, 11px);
        }
        .wb-fields > label,
        .wb-fields > div {
          display: grid;
          gap: var(--space-2, 6px);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: var(--track-eyebrow, 0.04em);
          text-transform: uppercase;
          color: var(--muted-foreground);
          min-width: 0;
        }
        .wb-wide {
          grid-column: 1 / -1;
        }
        .wb-flag {
          grid-template-columns: auto 1fr;
          align-items: center;
        }
        .wb-cap {
          display: block;
        }
      </style>
    </template>
  } as unknown as typeof Spec.edit;
}
