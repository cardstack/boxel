// Pretui — the Component card: one card per catalog entry, each rendering
// its ember-freestyle usage page (ported machinery in freestyle.gts — the
// verbatim-reuse directive) inside Boxel. It extends the base Spec card, so
// every instance is findable by Spec type queries and carries a `ref` to the
// module that exports the component. Instances live in whichever realm
// catalogs the kit and adopt from this module. The isolated view loads the
// component's usage page when it renders (demo-locations.ts says where it
// lives). Components without a page fall back to an EmptyState; host-retained
// entries state the goal-2 split.
import {
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { Spec } from 'https://cardstack.com/base/spec';
import { MarkdownDef } from 'https://cardstack.com/base/markdown-file-def';
import { MarkdownPreview } from 'https://cardstack.com/base/file-formats/index';
import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import GlimmerComponent from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { fn } from '@ember/helper';
import { not } from '@cardstack/boxel-ui/helpers';
import StarIcon from '@cardstack/boxel-icons/star';
import type { Query, RealmResourceIdentifier } from '@cardstack/runtime-common';
import { ThemeFrame } from './components/theme-frame';
import { EmptyState } from './components/empty-state';
import { LoadingState } from './components/loading-state';
import { StatusChip } from './components/status-chip';
import { Chip } from './components/chip';
import { Token } from './components/token';
import { Button } from './components/button';
import { Switch } from './components/switch';
import { noteExcerpt, noteSummary } from './note-text';
import { Tooltip } from './components/tooltip';
import { VisuallyHidden } from './components/visually-hidden';
import { Textarea } from './components/textarea';
import { StepList } from './components/step-list';
import { toIsoDate } from './components/known-date';
import type { StepItem, StepState } from './components/step-list';
import { Popover } from './components/popover';
import {
  demoModuleFor,
  loadDemo,
  loadExamples,
  siblingHref,
} from './demo-locations';
import type { DemoSubject } from './demo-locations';
import { iconFor } from './icon-registry';
import { ExampleGallery } from './example-gallery';
import type { ExampleSpec } from './examples-kit';

// Structural shape of a PretuiNote instance as read off a getCards result.
// Declared rather than imported: pretui-note.gts imports THIS module for its
// linksTo target, so importing it back would make the pair circular. The
// query names the type by module + name strings instead.
interface NoteLike {
  id?: string;
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

// The note card lives beside this module, not beside the Spec instance: an
// instance can sit in any realm, and a note must adopt from a module that
// resolves wherever it is written.
const NOTE_REF = { module: siblingHref('./pretui-note'), name: 'PretuiNote' };

// The stage as shown: capitalized, from the stored lowercase value.
function stageLabel(stage: string | undefined): string {
  let value = stage || 'planned';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// A live component's stage chip takes the success tone; every other stage
// keeps StatusChip's muted pill with its name-derived dot.
function stageTone(stage: string | undefined): 'success' | undefined {
  return stage === 'live' ? 'success' : undefined;
}

// A component name split at its camel-case humps ("ApprovalFooter" →
// "Approval", "Footer"), so a narrow title breaks between words.
const NAME_HUMP_RE = new RegExp('(?<=[a-z0-9])(?=[A-Z])');
function nameParts(name: string): string[] {
  return name.split(NAME_HUMP_RE);
}

// The write-up shows its first lines under a fade, with a centered toggle
// over the fade; opening it grows the region to the content's height. Its own
// component for the same reason as NoteComposer: the open state can't live in
// the format class.
interface WriteupFoldSignature {
  Args: { writeup: MarkdownDef };
  Element: HTMLDivElement;
}

class WriteupFold extends GlimmerComponent<WriteupFoldSignature> {
  @tracked open = false;
  @tracked overflows = false;
  regionId = `${guidFor(this)}-writeup`;
  toggle = () => (this.open = !this.open);
  get showToggle(): boolean {
    return this.open || this.overflows;
  }
  // The toggle and its fade only matter when the closed region clips the
  // prose; measured while closed, so opening keeps "Show less".
  measureOverflow = modifier((region: HTMLElement) => {
    let prose = region.firstElementChild;
    let check = () => {
      if (!this.open && prose) {
        this.overflows = prose.scrollHeight > region.clientHeight;
      }
    };
    let observer = new ResizeObserver(check);
    observer.observe(region);
    if (prose) observer.observe(prose);
    return () => observer.disconnect();
  });

  <template>
    <div class='wb-fold' data-open={{if this.open 'true'}} ...attributes>
      {{! the write-up's prose only — the panel owns the padding, so the
          file's own embedded chrome and surface stay out }}
      <div id={{this.regionId}} class='wb-fold-region' {{this.measureOverflow}}>
        <div class='wb-fold-prose'>
          <MarkdownPreview
            @model={{@writeup}}
            @format='isolated'
            @displayContainer={{false}}
          />
        </div>
      </div>
      {{#if this.showToggle}}
        <div class='wb-fold-more'>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='xs'
            aria-expanded={{if this.open 'true' 'false'}}
            aria-controls={{this.regionId}}
            {{on 'click' this.toggle}}
            data-test-pretui-writeup-toggle
          >{{if this.open 'Show less' 'Show more'}}</Button>
        </div>
      {{/if}}
    </div>
    <style scoped>
      /* closed, the preview fills whatever height the fold is given, never
         less than --_wb-fold-preview-h; open, it grows to the content */
      .wb-fold {
        --_wb-fold-preview-h: 14rem;
        --_wb-fold-fade-h: 2rem;

        position: relative;
        display: flex;
        flex-direction: column;
      }
      .wb-fold-region {
        flex: 1 1 0;
        min-block-size: var(--_wb-fold-preview-h);
        overflow: hidden;
        /* the open state changes the flex basis and grow, not height, so those
           are what animate; interpolate-size lets the basis reach auto */
        interpolate-size: allow-keywords;
        transition:
          flex-basis 250ms ease,
          flex-grow 250ms ease;
      }
      .wb-fold[data-open='true'] .wb-fold-region {
        flex: 0 0 auto;
      }
      /* mono reads larger than sans at the same size; a step down in em
         matches the prose around it optically */
      .wb-fold-prose {
        --markdown-code-font-size: 0.875em;
        --markdown-pre-font-size: 0.875em;
        --markdown-pre-border-radius: var(--boxel-border-radius-sm);

        padding: var(--boxel-sp-sm);
      }
      /* highlighted code joins its words with non-breaking spaces, so a long
         line can't wrap; it scrolls inside its block instead of being
         clipped by the fold */
      .wb-fold-prose :deep(pre) {
        overflow-x: auto;
      }
      /* closed, the toggle sits over a fade into the panel's surface; open,
         it follows the content */
      .wb-fold-more {
        display: flex;
        justify-content: center;
        position: absolute;
        inset-inline: 0;
        inset-block-end: 0;
        padding: var(--_wb-fold-fade-h) var(--boxel-sp-sm) var(--boxel-sp-xs);
        background-image: linear-gradient(transparent, var(--card) 70%);
      }
      .wb-fold[data-open='true'] .wb-fold-more {
        position: static;
        padding-block-start: 0;
        background-image: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .wb-fold-region {
          transition: none;
        }
      }
    </style>
  </template>
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
  fieldId = `${guidFor(this)}-note`;
  hintId = `${guidFor(this)}-hint`;
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
      <label class='note-compose-cap' for={{this.fieldId}}>Note on
        {{if @componentName @componentName 'this component'}}</label>
      <Textarea
        class='note-compose-field'
        @controlId={{this.fieldId}}
        @value={{this.draft}}
        @onInput={{this.setDraft}}
        @placeholder='What should change? Markdown welcome.'
        aria-describedby={{this.hintId}}
        data-test-pretui-note-draft
      />
      <div class='note-compose-foot'>
        <span class='note-compose-hint' id={{this.hintId}}>Picked up by the next
          triage pass.</span>
        <Button
          @tone='primary'
          @size='s'
          @disabled={{this.draftEmpty}}
          {{on 'click' this.save}}
          data-test-pretui-note-save
        >Save note</Button>
      </div>
    </div>
    <style scoped>
      .note-compose {
        /* the composer sits on --popover, where --muted-foreground isn't a
           guaranteed pair (4.2:1 in dark); a softer mix of its own ink is */
        --_note-compose-dim: color-mix(
          in oklch,
          var(--popover-foreground) 75%,
          var(--popover)
        );

        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xs);
      }
      .note-compose-cap {
        font-family: var(--boxel-eyebrow-font-family);
        font-size: var(--boxel-eyebrow-font-size);
        font-weight: var(--boxel-eyebrow-font-weight);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
      }
      .note-compose-field {
        width: 100%;
      }
      .note-compose-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .note-compose-cap,
      .note-compose-hint {
        color: var(--_note-compose-dim);
      }
      .note-compose-hint {
        font-size: var(--boxel-font-size-2xs);
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

// Closed vocabularies for the Spec's classification fields: the edit form
// offers these as dropdowns. Each list covers every value the catalog's
// Specs store, so existing instances read unchanged.
const CATEGORY_OPTIONS = [
  'Actions',
  'Agentic',
  'Authoring Tools',
  'Containers',
  'Data Display',
  'Feedback',
  'Forms',
  'Foundations',
  'Inputs',
  'Layout',
  'Media',
  'Motion & Effects',
  'Navigation',
  'Overlays',
].map((value) => ({ value, label: value }));
const TIER_OPTIONS = [
  'Primitive',
  'Element',
  'Compound',
  'Block',
  'Surface',
  'Runtime',
].map((value) => ({ value, label: value }));
const OWNERSHIP_OPTIONS = [
  { value: 'pretui', label: 'Pret UI' },
  { value: 'boxel-ui', label: 'boxel-ui' },
];
const ADOPTION_OPTIONS = [
  { value: 'in-use', label: 'In use' },
  { value: 'demo-ready', label: 'Demo ready' },
  { value: 'experimental', label: 'Experimental' },
];
const SOURCE_OPTIONS = [
  { value: 'design-v1', label: 'design-v1' },
  { value: 'react-ecosystem', label: 'React ecosystem' },
  { value: 'boxel-ui', label: 'boxel-ui' },
  { value: 'ember-freestyle', label: 'ember-freestyle' },
  { value: 'webawesome', label: 'Web Awesome' },
  { value: 'pretui', label: 'Pret UI' },
];
const DEMAND_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: String(value),
}));

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
  @field category = contains(
    enumField(StringField, { options: CATEGORY_OPTIONS }),
  );
  @field tier = contains(enumField(StringField, { options: TIER_OPTIONS }));
  @field tags = containsMany(StringField);
  @field ownership = contains(
    enumField(StringField, { options: OWNERSHIP_OPTIONS }),
  );
  @field implementationStatus = contains(StringField);
  @field adoptionStatus = contains(
    enumField(StringField, { options: ADOPTION_OPTIONS }),
  );
  @field introducedVersion = contains(StringField);
  // ── legacy axes, retained through the migration ──
  @field territory = contains(StringField);
  @field stage = contains(StringField);
  @field source = contains(
    enumField(StringField, { options: SOURCE_OPTIONS }),
  );
  @field lineage = contains(StringField);
  @field version = contains(StringField);
  @field brief = contains(StringField);
  // prose citation ('shadcn Button · wa-button'), not Spec's `ref` CodeRef
  @field refs = contains(StringField);
  @field buildsOn = contains(StringField);
  /** a hand-picked flagship of the kit, the components to look at first;
   *  shown as a gold star on the Spec page and its fitted card */
  @field featured = contains(BooleanField);
  @field isNew = contains(BooleanField);
  @field hasDesign = contains(BooleanField);
  @field hasExamples = contains(BooleanField);
  @field liveInUse = contains(BooleanField);
  // cross-library demand signal, 1-5 — how many independent kits converged
  // on this component (sourcing/index.md dupe density)
  @field demand = contains(
    enumField(NumberField, { options: DEMAND_OPTIONS }),
  );
  // the write-up lives in the sibling <name>.md; the indexer extracts its
  // content into the linked MarkdownDef, so the .md stays the single source.
  // searchable puts that content in the spec's search doc, once.
  @field writeup = linksTo(() => MarkdownDef, { searchable: true });

  // each format is cast: Spec's format classes carry getters these views do not use
  static isolated = class Isolated extends Component<typeof PretUISpec> {
    writeupHeadingId = `${guidFor(this)}-writeup-heading`;
    provenanceHeadingId = `${guidFor(this)}-provenance-heading`;
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
    // the brief stands in for a missing usage page; hidden while one loads,
    // so it doesn't show and then vanish
    get showBrief() {
      return Boolean(this.args.model.brief) && !this.demo && !this.isDemoLoading;
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
      let rows: { key: string; value: string; dots?: boolean[] }[] = [
        { key: 'Category', value: m.category ?? m.territory ?? '—' },
        { key: 'Tier', value: m.tier ?? '—' },
        { key: 'Stage', value: m.stage ? stageLabel(m.stage) : '—' },
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
      if (this.demand) {
        rows.push({
          key: 'Demand',
          value: `${this.demand} of 5`,
          dots: [1, 2, 3, 4, 5].map((i) => i <= this.demand!),
        });
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
    // '5 of 5 complete' summary
    get provenanceSteps(): StepItem[] {
      return this.facetPills.map((f) => ({
        label: f.label,
        state: (f.on ? 'complete' : 'upcoming') as StepState,
      }));
    }
    get demand(): number | undefined {
      let d = this.args.model.demand;
      if (!d || d < 1) return undefined;
      return Math.min(5, Math.round(d));
    }
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
              module: NOTE_REF.module as RealmResourceIdentifier,
              name: NOTE_REF.name,
            },
            // The id stays in its branded RealmResourceIdentifier form —
            // that is exactly what an `.id` query value is typed as.
            eq: { 'target.id': id },
          },
        };
      },
      () => {
        // the card id may be prefix-form (@cardstack/catalog/…), which is
        // not a URL base, so the realm comes from the card itself
        let realm = this.args.model[realmURL];
        return realm ? [realm.href] : undefined;
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
    // the rail shows the first few open notes; the rest sit in a disclosure
    get firstNotes(): NoteLike[] {
      return this.openNotes.slice(0, 3);
    }
    get moreNotes(): NoteLike[] {
      return this.openNotes.slice(3);
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
      this.args.viewCard?.(id as RealmResourceIdentifier, 'isolated');
    };

    // The composer is a popover, so leaving a note never takes you off the
    // page you are annotating. The note card is created only on save — an
    // abandoned composer leaves nothing behind, where create-then-edit would
    // strew empty notes through the realm.
    saveNote = (close: () => void, body: string) => {
      let id = this.args.model.id;
      let realm = this.args.model[realmURL];
      let create = createCardAction(this.args.context);
      if (!id || !realm || !create || !body) return;
      let ref = NOTE_REF;
      // The timestamp is stamped HERE, in an event handler, not in a getter.
      // The no-clock rule exists so that RENDER is deterministic (the same
      // card must prerender identically); recording when a note was written
      // is data capture at the moment of a user action, which is exactly
      // what a timestamp is for.
      // the author's local date, not toISOString()'s UTC one
      let now = new Date();
      let noted = toIsoDate(
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate(),
      );
      create(ref, realm, {
        realmURL: realm,
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
        class='wb-frame'
        @theme={{@model.cardTheme}}
        @context={{@context}}
        @bar={{false}}
        as |ThemeControls|
      >
        <article class='page' data-demo-policy={{this.demoPolicy}}>
          <header class='wb-topbar'>
            <div class='wb-crumb' data-test-pretui-spec-crumb>
              <span>Pret UI</span>
              <span aria-hidden='true'>/</span>
              <span>{{if
                  @model.category
                  @model.category
                  (if @model.territory @model.territory 'components')
                }}</span>
              <span aria-hidden='true'>/</span>
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
              <StatusChip
                @value={{stageLabel @model.stage}}
                @tone={{stageTone @model.stage}}
              />
              {{#if @model.isNew}}<Chip @label='New' @tone='attention' />{{/if}}
              {{#if @model.featured}}
                <Tooltip @content='Featured: a flagship component' @side='bottom'>
                  <Chip @tone='warning' @dot={{false}}><StarIcon
                      class='wb-star'
                      width='12'
                      height='12'
                      aria-hidden='true'
                    /><VisuallyHidden>Featured: a flagship component</VisuallyHidden></Chip>
                </Tooltip>
              {{/if}}
            </div>
            <div class='wb-grow'></div>
            <ThemeControls />
          </header>

          <div class='wb-head'>
            <h1 class='wb-title'>
              {{#let (iconFor @model.icon) as |TitleIcon|}}
                {{#if TitleIcon}}
                  <span class='wb-title-frame'>
                    <TitleIcon width='22' height='22' role='presentation' />
                  </span>
                {{/if}}
              {{/let}}
              <span class='wb-title-text'>{{#each
                  (nameParts (if @model.componentName @model.componentName 'Component'))
                  as |part i|
                }}{{#if i}}<wbr />{{/if}}{{part}}{{/each}}</span>
            </h1>
              {{! Sticky notes sit beside the title, where you left them, and
                the first few stay visible: an annotation hidden behind a
                disclosure is an annotation nobody reads. }}
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
                    <Popover
                      class='note-popover'
                      @placement='bottom-end'
                      @label='Leave a sticky note'
                    >
                      <:trigger as |open toggle|>
                        <Button
                          @tone='neutral'
                          @appearance='outlined'
                          @size='xs'
                          aria-expanded={{if open 'true' 'false'}}
                          aria-haspopup='dialog'
                          {{on 'click' toggle}}
                          data-test-pretui-note-add
                        >Add note</Button>
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
                    <span class='notes-done'>{{this.addressedCount}}
                      addressed</span>
                  {{/if}}
                </div>
                {{#if this.openNotes}}
                  <ul class='notes-list'>
                    {{#each this.firstNotes key='id' as |n|}}
                      <li>
                        <button
                          type='button'
                          class='note'
                          {{on 'click' (fn this.openNote n.id)}}
                          data-test-pretui-note
                        >
                          <span class='note-title'>{{noteSummary n.note}}</span>
                          {{#let (noteExcerpt n.note) as |excerpt|}}
                            {{#if excerpt}}
                              <span class='note-excerpt'>{{excerpt}}</span>
                            {{/if}}
                          {{/let}}
                        </button>
                      </li>
                    {{/each}}
                  </ul>
                  {{#if this.moreNotes.length}}
                    {{! buttons in a details' content, outside its summary, are
                        valid; the rule counts details itself as interactive }}
                    {{! template-lint-disable no-nested-interactive }}
                    <details class='notes-more' data-test-pretui-notes-more>
                      <summary>Show
                        {{this.moreNotes.length}}
                        more</summary>
                      <ul class='notes-list'>
                        {{#each this.moreNotes key='id' as |n|}}
                          <li>
                            <button
                              type='button'
                              class='note'
                              {{on 'click' (fn this.openNote n.id)}}
                              data-test-pretui-note
                            >
                              <span class='note-title'>{{noteSummary n.note}}</span>
                              {{#let (noteExcerpt n.note) as |excerpt|}}
                                {{#if excerpt}}
                                  <span class='note-excerpt'>{{excerpt}}</span>
                                {{/if}}
                              {{/let}}
                            </button>
                          </li>
                        {{/each}}
                      </ul>
                    </details>
                    {{! template-lint-enable no-nested-interactive }}
                  {{/if}}
                {{/if}}
              </aside>
            {{/if}}
          </div>
          {{#if this.showBrief}}
            <p class='brief'>{{@model.brief}}</p>
          {{/if}}
          <div class='wb-work'>
            {{#if this.demo}}
              <this.demo />
            {{else if this.isDemoLoading}}
              <section class='panel'>
                <LoadingState @label='Loading the usage page' />
              </section>
            {{else if this.isDemoExcluded}}
              <section class='panel'>
                {{#if this.isHost}}
                  <EmptyState
                    @title='Catalog infrastructure — demo excluded'
                    @message='Host chrome stays in boxel-ui by design. It is indexed here for vocabulary coverage, not as a Pret UI demo target.'
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
          <div class='wb-below'>
            {{#if @model.writeup}}
              <section
                class='wb-panel wb-writeup-panel'
                aria-labelledby={{this.writeupHeadingId}}
              >
                <div class='wb-panel-h'>
                  <h2 id={{this.writeupHeadingId}} class='wb-cap'>Write-up</h2>
                </div>
                <WriteupFold
                  class='wb-writeup-fold'
                  @writeup={{@model.writeup}}
                />
              </section>
            {{/if}}
            <section
              class='wb-panel wb-provenance'
              aria-labelledby={{this.provenanceHeadingId}}
            >
              <div class='wb-panel-h'>
                <h2
                  id={{this.provenanceHeadingId}}
                  class='wb-cap'
                >Provenance</h2>
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
                    <dd>
                      {{#if row.dots}}
                        {{! drawn, not ●/○ glyphs, so filled and hollow share one
                        size and baseline }}
                        <span
                          class='wb-dots'
                          role='img'
                          aria-label={{row.value}}
                        >
                          {{#each row.dots as |on|}}
                            <span
                              class='wb-dot'
                              data-on={{if on 'true'}}
                            ></span>
                          {{/each}}
                        </span>
                      {{else}}
                        {{row.value}}
                      {{/if}}
                    </dd>
                  </div>
                {{/each}}
              </dl>
            </section>
          </div>
        </article>
      </ThemeFrame>
      <style scoped>
        /* the isolated root: the card's height and its scroller. No
           overscroll-behavior: where a host sizes the card to its content
           (code mode's preview), the frame has nothing to scroll and the
           wheel has to pass up to the host's scroller. position: relative
           keeps absolute descendants (visually hidden text) inside this
           scroller; otherwise they overflow the card container, which then
           scrolls past the frame onto its own background */
        .wb-frame {
          position: relative;
          height: 100%;
          overflow-y: auto;
        }
        .page {
          --_wb-topbar-h: 2.75rem;
          --_wb-panel-h: 2.25rem;
          --_wb-title-frame-size: 3rem;
          --_wb-notes-w: 17.5rem;
          --_wb-notes-max-h: 20rem;
          --_wb-writeup-min-w: 48rem;
          /* StepList's track turns vertical at 24rem; with the panel's
             padding, provenance needs 26rem to keep it horizontal */
          --_wb-provenance-min-w: 26rem;
          --_wb-provenance-max-w: 30rem;
          --_wb-krow-label-w: 6.875rem;
          --_wb-dot-size: 0.5rem;
          /* the page's inline padding, which the topbar cancels and restores
             to run edge to edge */
          --_wb-page-gutter: var(--boxel-sp-lg);

          min-height: 100%;
          padding: 0 var(--_wb-page-gutter) var(--boxel-sp-2xl);
          /* one column that may shrink below its content, so a long name
             breaks instead of widening the page */
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: var(--boxel-sp);
          align-content: start;
        }
        /* ── workbench chrome (pretui-alert-workbench format) ── */
        .wb-title {
          margin: var(--boxel-sp-2xs) 0 calc(-1 * var(--boxel-sp-3xs));
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
          letter-spacing: var(--boxel-lsp-xs);
          line-height: 1.1;
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        /* the component's icon beside its title: a --background tile with a
           hairline ring, not a raised button */
        /* the name shrinks and breaks, so a long one can't push the page
           sideways at narrow widths */
        .wb-title-text {
          min-width: 0;
          overflow-wrap: break-word;
        }
        .wb-title-frame {
          --icon-color: currentColor;
          --icon-bg: none;

          display: grid;
          place-items: center;
          width: var(--_wb-title-frame-size);
          height: var(--_wb-title-frame-size);
          flex: none;
          border-radius: var(--boxel-border-radius-sm);
          box-shadow: inset 0 0 0 1px var(--border);
          background-color: var(--background);
          color: var(--muted-foreground);
        }
        .wb-topbar {
          position: sticky;
          top: 0;
          /* sticky page chrome sits above content and well below every
             floating surface, so a menu opened from this bar clears it */
          z-index: var(--pretui-z-sticky, 10);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          min-height: var(--_wb-topbar-h);
          margin: 0 calc(-1 * var(--_wb-page-gutter));
          padding: var(--boxel-sp-2xs) var(--_wb-page-gutter);
          background-color: var(--card);
          color: var(--card-foreground);
          box-shadow: inset 0 -1px 0 var(--border);
          flex-wrap: wrap;
        }
        .wb-crumb {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          min-width: 0;
        }
        .wb-here {
          min-width: 0;
          overflow-wrap: break-word;
          color: var(--card-foreground);
          font-weight: 600;
        }
        .wb-badges {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-2xs);
          margin-inline-start: var(--boxel-sp-6xs);
        }
        .wb-grow {
          flex: 1;
        }
        /* the icon set's star is outline-only; filled reads as a flag */
        .wb-star {
          fill: currentColor;
        }
        .wb-work {
          min-width: 0;
        }
        /* the title and the notes rail share a row; the rail wraps under
           the title when the row is too narrow for both */
        .wb-head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          gap: var(--boxel-sp) var(--boxel-sp-lg);
        }
        .wb-head > .wb-title {
          flex: 1 1 18rem;
          min-width: 0;
        }
        /* ── Sticky notes ── */
        .notes {
          flex: 0 1 var(--_wb-notes-w);
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--boxel-sp-2xs);
          min-width: 0;
        }
        /* a note wants room to write: Popover reads its width knob on the
           panel, which inherits it from the Popover root */
        .note-popover {
          --pretui-popover-width: 20rem;
        }
        /* a long run of notes scrolls instead of pushing the page down; the
           padding keeps the notes' focus rings inside the scroller */
        .notes-list {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-2xs);
          width: 100%;
          max-block-size: var(--_wb-notes-max-h);
          overflow-y: auto;
          margin: 0;
          padding: var(--boxel-sp-3xs);
          list-style: none;
        }
        .note {
          /* a tint of --attention over --card, so the sticky holds
             contrast in light and dark */
          width: 100%;
          text-align: start;
          padding: var(--boxel-sp-xs);
          /* a real border, so the clickable edge survives forced colors */
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius);
          /* oklab, so the tint stays warm over a cool dark card */
          background-color: color-mix(
            in oklab,
            var(--attention) 14%,
            var(--card)
          );
          color: var(--card-foreground);
          box-shadow: var(--shadow-sm);
          font-size: var(--boxel-caption-font-size);
          line-height: 1.5;
        }
        .note:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .note:hover {
          box-shadow: var(--shadow-md);
        }
        .notes-more {
          width: 100%;
        }
        .notes-more > summary {
          width: fit-content;
          margin-inline-start: auto;
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .notes-more[open] > summary {
          margin-block-end: var(--boxel-sp-2xs);
        }
        /* each note reads as a small card: its title, then the start of
           its body; clicking opens the whole note */
        .note {
          display: grid;
          gap: var(--boxel-sp-6xs);
        }
        .note-title {
          font-weight: 600;
          overflow-wrap: break-word;
        }
        .note-excerpt {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          overflow-wrap: break-word;
          color: var(--muted-foreground);
        }
        .notes-foot {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .notes-done {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-2xs);
          color: var(--muted-foreground);
        }
        /* the write-up and provenance share a row when both fit, and stack
           otherwise; provenance stops at its cap and the write-up takes the
           rest */
        .wb-below {
          container-type: inline-size;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          /* on a shared row the write-up is at least as tall as provenance */
          align-items: stretch;
        }
        .wb-below > .wb-writeup-panel {
          flex: 1 1 var(--_wb-writeup-min-w);
          display: flex;
          flex-direction: column;
        }
        .wb-writeup-fold {
          flex: 1;
        }

        .wb-below > .wb-provenance {
          flex: 1 1 var(--_wb-provenance-min-w);
          align-self: start;
        }
        /* capped only while it shares the row: 75rem is the write-up's 48rem
           minimum plus provenance's 26rem plus the 1rem gap (a container query
           can't read the variables). Stacked, it runs full width. Unnamed: a
           named container query doesn't survive the realm's scoped-CSS
           transpiler. */
        @container (width >= 75rem) {
          .wb-below > .wb-writeup-panel ~ .wb-provenance {
            max-inline-size: var(--_wb-provenance-max-w);
          }
        }
        .wb-panel {
          background-color: var(--card);
          color: var(--card-foreground);
          border-radius: var(--boxel-border-radius);
          box-shadow: 0 0 0 1px var(--border);
          overflow: hidden;
          min-width: 0;
        }
        .wb-panel-h {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: var(--_wb-panel-h);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          box-shadow: inset 0 -1px 0 var(--border);
        }
        /* THE caps treatment — panel and group headers only (type spec:
           one caps style, everything else sentence case) */
        .wb-cap {
          font-family: var(--boxel-eyebrow-font-family);
          font-size: var(--boxel-eyebrow-font-size);
          font-weight: var(--boxel-eyebrow-font-weight);
          line-height: var(--boxel-eyebrow-line-height);
          letter-spacing: var(--boxel-eyebrow-letter-spacing);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        /* the provenance rail is the kit's StepList in its track variant —
           the panel only positions it; every bar, glyph, state text and the
           completion summary belong to the component */
        .wb-pipe {
          padding: var(--boxel-sp-sm) var(--boxel-sp-sm) var(--boxel-sp-2xs);
        }
        .wb-kv {
          margin: 0;
          padding: var(--boxel-sp-3xs) 0 var(--boxel-sp-2xs);
        }
        .wb-krow {
          display: grid;
          grid-template-columns: var(--_wb-krow-label-w) minmax(0, 1fr);
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
          align-items: baseline;
        }
        .wb-krow dt {
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          color: var(--muted-foreground);
        }
        .wb-dots {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          vertical-align: middle;
        }
        .wb-dot {
          width: var(--_wb-dot-size);
          height: var(--_wb-dot-size);
          border-radius: 50%;
          box-shadow: inset 0 0 0 1px currentColor;
        }
        .wb-dot[data-on='true'] {
          background-color: currentColor;
        }
        .wb-krow dd {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          overflow-wrap: break-word;
        }
        .panel {
          background-color: var(--card);
          color: var(--card-foreground);
          border-radius: var(--boxel-border-radius);
          box-shadow: 0 0 0 1px var(--border);
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
          align-content: start;
        }
        .brief {
          max-width: 78ch;
          font-size: var(--boxel-caption-font-size);
          line-height: 1.5;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  } as unknown as typeof Spec.isolated;

  static fitted = class Fitted extends Component<typeof PretUISpec> {
    get monogram() {
      return (this.args.model.componentName ?? '?').charAt(0);
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
          <div class='mono'>
            {{#let (iconFor @model.icon) as |FitIcon|}}
              {{#if FitIcon}}
                <FitIcon width='18' height='18' role='presentation' />
              {{else}}
                {{this.monogram}}
              {{/if}}
            {{/let}}
          </div>
          <div class='fit-body'>
            <div class='fit-name'>
              {{@model.componentName}}
              {{#if @model.featured}}<span
                  class='fit-star'
                  title='Featured: a flagship component'
                ><StarIcon
                    class='wb-star'
                    width='12'
                    height='12'
                    aria-hidden='true'
                  /><VisuallyHidden>Featured: a flagship component</VisuallyHidden></span>{{/if}}
            </div>
            <div class='fit-sub'>
              <span>{{if
                  @model.category
                  @model.category
                  @model.territory
                }}</span>
              {{#if @model.liveInUse}}
                <span>{{if @model.version @model.version '0.0.0'}}</span>
              {{/if}}
            </div>
            <div class='fit-extra'>
              <StatusChip
                @value={{stageLabel @model.stage}}
                @tone={{stageTone @model.stage}}
              />
              {{#if @model.isNew}}<Chip @label='New' @tone='attention' />{{/if}}
            </div>
            {{#if @model.brief}}<div
                class='fit-brief'
              >{{@model.brief}}</div>{{/if}}
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
          --fit-mono-size: 1.875rem;
          --fit-mono-font-size: var(--boxel-font-size-sm);
          --fit-mono-radius: var(--boxel-border-radius);

          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          background-color: var(--card);
          color: var(--card-foreground);
          overflow: hidden;
          box-sizing: border-box;
        }
        .mono {
          --icon-color: currentColor;
          --icon-bg: none;

          flex: none;
          width: var(--fit-mono-size);
          height: var(--fit-mono-size);
          border-radius: var(--fit-mono-radius);
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: var(--fit-mono-font-size);
          background-color: var(--muted);
          color: var(--foreground);
          box-shadow: inset 0 0 0 1px var(--border);
        }
        .fit-body {
          min-width: 0;
          display: grid;
          gap: var(--boxel-sp-6xs);
        }
        .fit-name {
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-star {
          color: var(--warning-ink);
        }
        /* the icon set's star is outline-only; filled reads as a flag */
        .wb-star {
          fill: currentColor;
        }
        .fit-sub {
          display: flex;
          gap: var(--boxel-sp-xs);
          font-family: var(--font-mono);
          font-size: var(--boxel-eyebrow-font-size);
          letter-spacing: var(--boxel-eyebrow-letter-spacing);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .fit-extra,
        .fit-brief {
          display: none;
        }
        /* badge: monogram + name only */
        @container ((max-width: 139px) or (max-height: 47px)) {
          .fit-root {
            --fit-mono-size: 1.375rem;
            --fit-mono-font-size: var(--boxel-font-size-xs);
            --fit-mono-radius: var(--boxel-border-radius-sm);

            gap: var(--boxel-sp-2xs);
            padding: var(--boxel-sp-3xs) var(--boxel-sp-xs);
          }
          .fit-sub {
            display: none;
          }
        }
        /* tile & card: stack vertically, grow the monogram */
        @container ((min-width: 140px) and (min-height: 140px)) {
          .fit-root {
            --fit-mono-size: 2.75rem;
            --fit-mono-font-size: var(--boxel-font-size-lg);
            --fit-mono-radius: var(--boxel-border-radius-lg);

            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-end;
            padding: var(--boxel-sp-sm);
            gap: var(--boxel-sp-xs);
          }
          .fit-extra {
            display: flex;
            align-items: center;
            gap: var(--boxel-sp-2xs);
          }
        }
        /* full card: show the brief */
        @container ((min-width: 190px) and (min-height: 220px)) {
          .fit-brief {
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
            overflow: hidden;
            font-size: var(--boxel-caption-font-size);
            color: var(--muted-foreground);
            line-height: 1.5;
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
          <span class='tile-name'>{{if
              @model.componentName
              @model.componentName
              'Component'
            }}</span>
          <StatusChip
            @value={{stageLabel @model.stage}}
            @tone={{stageTone @model.stage}}
          />
        </div>
        <div class='tile-meta'>
          <span class='territory'>{{if
              @model.category
              @model.category
              @model.territory
            }}</span>
          {{#if @model.source}}<Token @value={{@model.source}} />{{/if}}
        </div>
      </div>
      <style scoped>
        .tile {
          padding: var(--boxel-sp-sm) var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-xs);
          align-content: start;
        }
        .tile-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .tile-name {
          min-width: 0;
          overflow-wrap: break-word;
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
        }
        .tile-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .territory {
          font-family: var(--font-mono);
          font-size: var(--boxel-eyebrow-font-size);
          letter-spacing: var(--boxel-eyebrow-letter-spacing);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  } as unknown as typeof Spec.embedded;

  // Hand-written: Spec's own edit template throws without a resolved ref, and
  // the default field editor surfaces ten inherited fields this card never sets.
  static edit = class Edit extends Component<typeof PretUISpec> {
    // ids for the captions that name editors a <label> can't wrap
    captionId = (key: string) => `${guidFor(this)}-${key}`;
    // the yes/no signals are switches that write the field directly
    setFlag = (
      key: 'featured' | 'isNew' | 'hasDesign' | 'hasExamples' | 'liveInUse',
      on: boolean,
    ) => {
      this.args.model[key] = on;
    };
    <template>
      <div class='wb-edit'>
        <fieldset class='wb-group'>
          <legend>Identity</legend>
          <div class='wb-fields'>
            <label><span class='wb-cap'>Name</span>
              <@fields.componentName /></label>
            <label><span class='wb-cap'>Icon</span> <@fields.icon /></label>
            <label class='wb-wide'><span class='wb-cap'>Brief</span>
              <@fields.brief /></label>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Taxonomy</legend>
          <div class='wb-fields'>
            <label><span class='wb-cap'>Category</span>
              <@fields.category /></label>
            <label><span class='wb-cap'>Tier</span> <@fields.tier /></label>
            <label><span class='wb-cap'>Ownership</span>
              <@fields.ownership /></label>
            <label><span class='wb-cap'>Implementation</span>
              <@fields.implementationStatus /></label>
            <label><span class='wb-cap'>Adoption</span>
              <@fields.adoptionStatus /></label>
            <label><span class='wb-cap'>Introduced in</span>
              <@fields.introducedVersion /></label>
            <div
              class='wb-wide'
              role='group'
              aria-labelledby={{this.captionId 'tags'}}
            >
              <span id={{this.captionId 'tags'}} class='wb-cap'>Tags</span>
              <@fields.tags />
            </div>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Provenance</legend>
          <div class='wb-fields'>
            <label><span class='wb-cap'>Source</span> <@fields.source /></label>
            <label><span class='wb-cap'>Lineage</span>
              <@fields.lineage /></label>
            <label><span class='wb-cap'>Version</span>
              <@fields.version /></label>
            <label><span class='wb-cap'>Builds on</span>
              <@fields.buildsOn /></label>
            <label class='wb-wide'><span class='wb-cap'>References</span>
              <@fields.refs /></label>
          </div>
        </fieldset>

        {{! editors a <label> can't wrap (the tag list, the linked file with
            its Remove button) sit in a named group instead: a wrapping label
            would activate their first control on any click. The yes/no
            signals are single switches, so their label does wrap them. }}
        <fieldset class='wb-group'>
          <legend>Signals</legend>
          <div class='wb-fields'>
            <label><span class='wb-cap'>Demand (1-5)</span>
              <@fields.demand /></label>
            <label class='wb-switch-row'>
              <Switch
                @checked={{@model.featured}}
                @onCheckedChange={{fn this.setFlag 'featured'}}
                @disabled={{not @canEdit}}
              />
              <span class='wb-cap'>Featured</span>
            </label>
            <label class='wb-switch-row'>
              <Switch
                @checked={{@model.isNew}}
                @onCheckedChange={{fn this.setFlag 'isNew'}}
                @disabled={{not @canEdit}}
              />
              <span class='wb-cap'>New</span>
            </label>
            <label class='wb-switch-row'>
              <Switch
                @checked={{@model.hasDesign}}
                @onCheckedChange={{fn this.setFlag 'hasDesign'}}
                @disabled={{not @canEdit}}
              />
              <span class='wb-cap'>Has design</span>
            </label>
            <label class='wb-switch-row'>
              <Switch
                @checked={{@model.hasExamples}}
                @onCheckedChange={{fn this.setFlag 'hasExamples'}}
                @disabled={{not @canEdit}}
              />
              <span class='wb-cap'>Has examples</span>
            </label>
            <label class='wb-switch-row'>
              <Switch
                @checked={{@model.liveInUse}}
                @onCheckedChange={{fn this.setFlag 'liveInUse'}}
                @disabled={{not @canEdit}}
              />
              <span class='wb-cap'>Live in use</span>
            </label>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Legacy axes</legend>
          <div class='wb-fields'>
            <label><span class='wb-cap'>Territory</span>
              <@fields.territory /></label>
            <label><span class='wb-cap'>Stage</span> <@fields.stage /></label>
          </div>
        </fieldset>

        <fieldset class='wb-group'>
          <legend>Write-up</legend>
          <div class='wb-fields'>
            <div
              class='wb-wide'
              role='group'
              aria-labelledby={{this.captionId 'writeup'}}
            >
              <span id={{this.captionId 'writeup'}} class='wb-cap'>Linked
                file</span>
              <@fields.writeup />
            </div>
          </div>
        </fieldset>
      </div>
      <style scoped>
        .wb-edit {
          --_wb-field-min-w: 12.5rem;

          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }
        .wb-group {
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius-sm);
          padding: var(--boxel-sp-sm) var(--boxel-sp) var(--boxel-sp);
          margin: 0;
          min-width: 0;
        }
        .wb-group > legend {
          font-family: var(--boxel-eyebrow-font-family);
          font-size: var(--boxel-eyebrow-font-size);
          font-weight: var(--boxel-eyebrow-font-weight);
          line-height: var(--boxel-eyebrow-line-height);
          letter-spacing: var(--boxel-eyebrow-letter-spacing);
          text-transform: uppercase;
          color: var(--muted-foreground);
          padding-inline: var(--boxel-sp-2xs);
        }
        .wb-fields {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(min(var(--_wb-field-min-w), 100%), 1fr)
          );
          gap: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .wb-fields > label,
        .wb-fields > div {
          display: grid;
          gap: var(--boxel-sp-2xs);
          min-width: 0;
        }
        .wb-wide {
          grid-column: 1 / -1;
        }
        .wb-fields > .wb-switch-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          cursor: pointer;
        }
        /* field captions are sentence-case labels; the caps style is the
           group legends' alone */
        .wb-cap {
          display: block;
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          line-height: var(--boxel-ui-label-line-height);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
          color: var(--muted-foreground);
        }
      </style>
    </template>
  } as unknown as typeof Spec.edit;
}
