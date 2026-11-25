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
} from '@cardstack/base/card-api';
import { Spec } from '@cardstack/base/spec';
import { MarkdownDef } from '@cardstack/base/markdown-file-def';
import { MarkdownPreview } from '@cardstack/base/file-formats/index';
import StringField from '@cardstack/base/string';
import enumField from '@cardstack/base/enum';
import BooleanField from '@cardstack/base/boolean';
import NumberField from '@cardstack/base/number';
import { guidFor } from '@ember/object/internals';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { not } from './helpers';
import StarIcon from '@cardstack/boxel-icons/star';
import { ThemeFrame } from './components/theme-frame';
import { EmptyState } from './components/empty-state';
import { LoadingState } from './components/loading-state';
import { StatusChip } from './components/status-chip';
import { Chip } from './components/chip';
import { Token } from './components/token';
import { Switch } from './components/switch';
import { Tooltip } from './components/tooltip';
import { VisuallyHidden } from './components/visually-hidden';
import { demoModuleFor, loadDemo, loadExamples } from './demo-locations';
import type { DemoSubject } from './demo-locations';
import { iconFor } from './icon-registry';
import { ExampleGallery } from './example-gallery';
import { CardLink } from './showcase-chrome';
import { categoryNamed, overviewHref } from './showcase-data';
import type { ExampleSpec } from './examples-kit';

// A stored enum value as shown, from its option label; '—' when unset.
function optionLabel(
  options: { value: string; label: string }[],
  value: string | undefined,
): string {
  if (!value) return '—';
  return options.find((option) => option.value === value)?.label ?? value;
}

// The status chip's label: the adoption status, or the implementation status
// for a component nobody has adopted yet; undefined hides the chip.
function statusLabel(
  adoptionStatus: string | undefined,
  implementationStatus: string | undefined,
): string | undefined {
  if (adoptionStatus) return optionLabel(ADOPTION_OPTIONS, adoptionStatus);
  if (implementationStatus) {
    return optionLabel(IMPLEMENTATION_OPTIONS, implementationStatus);
  }
  return undefined;
}

function isInUse(status: string | undefined): boolean {
  return status === 'in-use';
}

// An in-use component's status chip takes the success tone and a deprecated
// one the danger tone (warning is the Featured star's); every other status
// keeps StatusChip's muted pill with its name-derived dot.
function adoptionTone(
  status: string | undefined,
): 'success' | 'danger' | undefined {
  if (isInUse(status)) return 'success';
  return status === 'deprecated' ? 'danger' : undefined;
}

// The kit release the "New" chip marks: a component introduced in it is new.
// Bump this with each release so the chip clears itself.
export const CURRENT_RELEASE = '0.4.0';
function isNewIn(introducedVersion: string | undefined): boolean {
  return introducedVersion === CURRENT_RELEASE;
}

// A component name split at its camel-case humps ("ApprovalFooter" →
// "Approval", "Footer"), so a narrow title breaks between words.
const NAME_HUMP_RE = new RegExp('(?<=[a-z0-9])(?=[A-Z])');
function nameParts(name: string): string[] {
  return name.split(NAME_HUMP_RE);
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
// Specs store, so existing instances read unchanged, plus the taxonomy's
// values (host, planned, designed, deprecated; docs/catalog-taxonomy.md).
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
  { value: 'host', label: 'Host' },
];
const IMPLEMENTATION_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'designed', label: 'Designed' },
  { value: 'implemented', label: 'Implemented' },
];
const ADOPTION_OPTIONS = [
  { value: 'in-use', label: 'In use' },
  { value: 'demo-ready', label: 'Demo ready' },
  { value: 'experimental', label: 'Experimental' },
  { value: 'deprecated', label: 'Deprecated' },
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
  // an icon-registry.gts key, resolved to its boxel-icons icon at render
  // time — data, never a static icon
  @field icon = contains(StringField);
  // ── taxonomy axes (docs/catalog-taxonomy.md) ──
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
  @field implementationStatus = contains(
    enumField(StringField, { options: IMPLEMENTATION_OPTIONS }),
  );
  @field adoptionStatus = contains(
    enumField(StringField, { options: ADOPTION_OPTIONS }),
  );
  @field introducedVersion = contains(StringField);
  // ── provenance ──
  @field source = contains(enumField(StringField, { options: SOURCE_OPTIONS }));
  @field lineage = contains(StringField);
  @field version = contains(StringField);
  @field brief = contains(StringField);
  // prose citation ('shadcn Button · wa-button'), not Spec's `ref` CodeRef
  @field refs = contains(StringField);
  @field buildsOn = contains(StringField);
  /** a hand-picked flagship of the kit, the components to look at first;
   *  shown as a gold star on the Spec page and its fitted card */
  @field featured = contains(BooleanField);
  @field hasDesign = contains(BooleanField);
  @field hasExamples = contains(BooleanField);
  // cross-library demand signal, 1-5 — how many independent kits converged
  // on this component (sourcing/index.md dupe density)
  @field demand = contains(enumField(NumberField, { options: DEMAND_OPTIONS }));
  // the write-up lives in the sibling <name>.md; the indexer extracts its
  // content into the linked MarkdownDef, so the .md stays the single source.
  // searchable puts that content in the spec's search doc, once.
  @field writeup = linksTo(() => MarkdownDef, { searchable: true });

  // each format is cast: Spec's format classes carry getters these views do not use
  static isolated = class Isolated extends Component<typeof PretUISpec> {
    writeupHeadingId = `${guidFor(this)}-writeup-heading`;
    get overviewHref() {
      return overviewHref();
    }
    get categoryHref() {
      let category = categoryNamed(this.args.model.category);
      return category ? overviewHref(category.slug) : undefined;
    }
    get demoLoad() {
      let m = this.args.model;
      return m.componentName
        ? demoLoadFor({
            name: m.componentName,
            implementationStatus: m.implementationStatus,
            ownership: m.ownership,
            tier: m.tier,
          })
        : undefined;
    }
    get demo() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.demoLoad?.value as any;
    }
    // the brief stands in for a missing usage page; hidden while one loads,
    // so it doesn't show and then vanish
    get showBrief() {
      return (
        Boolean(this.args.model.brief) && !this.demo && !this.isDemoLoading
      );
    }
    get examples() {
      let name = this.args.model.componentName;
      return name ? examplesLoadFor(name).value : undefined;
    }
    get isDemoLoading() {
      return this.demoLoad?.state === 'loading';
    }
    get isHost() {
      return this.args.model.ownership === 'host';
    }
    get isDemoExcluded() {
      return this.isHost || this.args.model.tier === 'Runtime';
    }
    get demoPolicy() {
      if (this.demo) return 'included';
      if (this.isDemoLoading) return 'loading';
      return this.isDemoExcluded ? 'excluded' : 'missing';
    }
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
            <nav
              class='wb-crumb'
              aria-label='Breadcrumb'
              data-test-pretui-spec-crumb
            >
              <ol class='wb-crumb-list'>
                <li><CardLink
                    class='wb-crumb-link'
                    @href={{this.overviewHref}}
                    @viewCard={{@viewCard}}
                  >Pret UI</CardLink></li>
                {{#if this.categoryHref}}
                  <li><CardLink
                      class='wb-crumb-link'
                      @href={{this.categoryHref}}
                      @viewCard={{@viewCard}}
                    >{{@model.category}}</CardLink></li>
                {{else}}
                  <li>{{if @model.category @model.category 'components'}}</li>
                {{/if}}
                <li class='wb-here' aria-current='page'>{{if
                    @model.componentName
                    @model.componentName
                    'Component'
                  }}</li>
              </ol>
            </nav>
            <div class='wb-badges'>
              {{#if (isInUse @model.adoptionStatus)}}
                <Token
                  @value={{if @model.version @model.version '0.0.0'}}
                  data-test-pretui-version
                />
              {{/if}}
              {{#let
                (statusLabel @model.adoptionStatus @model.implementationStatus)
                as |label|
              }}
                {{#if label}}
                  <StatusChip
                    @value={{label}}
                    @tone={{adoptionTone @model.adoptionStatus}}
                    data-test-pretui-status
                  />
                {{/if}}
              {{/let}}
              {{#if (isNewIn @model.introducedVersion)}}<Chip
                  @label='New'
                  @tone='attention'
                  data-test-pretui-new
                />{{/if}}
              {{#if @model.featured}}
                <Tooltip
                  @content='Featured: a flagship component'
                  @side='bottom'
                >
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

          <h1 class='wb-title'>
            {{#let (iconFor @model.icon) as |TitleIcon|}}
              {{#if TitleIcon}}
                <span class='wb-title-frame'>
                  <TitleIcon width='22' height='22' role='presentation' />
                </span>
              {{/if}}
            {{/let}}
            <span class='wb-title-text'>{{#each
                (nameParts
                  (if @model.componentName @model.componentName 'Component')
                )
                as |part i|
              }}{{#if i}}<wbr />{{/if}}{{part}}{{/each}}</span>
          </h1>
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
                    @message='Host chrome is indexed here for vocabulary coverage, not as a Pret UI demo target.'
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
                  @message='This component has no freestyle page in the fitting room yet — see the kit showcase.'
                />
              </section>
            {{/if}}
          </div>
          <ExampleGallery @specs={{this.examples}} />
          {{#if @model.writeup}}
            <section
              class='wb-panel wb-writeup'
              aria-labelledby={{this.writeupHeadingId}}
            >
              <div class='wb-panel-h'>
                <h2 id={{this.writeupHeadingId}} class='wb-cap'>Write-up</h2>
              </div>
              {{! the write-up's prose only — the panel owns the padding, so
                  the file's own embedded chrome and surface stay out }}
              <div class='wb-writeup-prose'>
                <MarkdownPreview
                  @model={{@model.writeup}}
                  @format='isolated'
                  @displayContainer={{false}}
                />
              </div>
            </section>
          {{/if}}
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
        .wb-crumb-list {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin: 0;
          padding: 0;
          list-style: none;
          min-width: 0;
        }
        .wb-crumb-list > li + li::before {
          content: '/' / '';
          margin-inline-end: var(--boxel-sp-xs);
        }
        .wb-crumb-link {
          border-radius: var(--boxel-border-radius-xs);
          color: inherit;
          text-decoration: none;
        }
        .wb-crumb-link:hover {
          color: var(--card-foreground);
          text-decoration: underline;
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
        .wb-writeup-prose {
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
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
              {{#if @model.category}}<span>{{@model.category}}</span>{{/if}}
              {{#if (isInUse @model.adoptionStatus)}}
                <span>{{if @model.version @model.version '0.0.0'}}</span>
              {{/if}}
            </div>
            <div class='fit-extra'>
              {{#let
                (statusLabel @model.adoptionStatus @model.implementationStatus)
                as |label|
              }}
                {{#if label}}
                  <StatusChip
                    @value={{label}}
                    @tone={{adoptionTone @model.adoptionStatus}}
                    data-test-pretui-status
                  />
                {{/if}}
              {{/let}}
              {{#if (isNewIn @model.introducedVersion)}}<Chip
                  @label='New'
                  @tone='attention'
                  data-test-pretui-new
                />{{/if}}
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
        /* last, so it beats the display rules above: a row with nothing in
           it takes no space */
        .fit-sub:not(:has(*)),
        .fit-extra:not(:has(*)) {
          display: none;
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
          {{#let
            (statusLabel @model.adoptionStatus @model.implementationStatus)
            as |label|
          }}
            {{#if label}}
              <StatusChip
                @value={{label}}
                @tone={{adoptionTone @model.adoptionStatus}}
                data-test-pretui-status
              />
            {{/if}}
          {{/let}}
        </div>
        <div class='tile-meta'>
          {{! always rendered, so the source token keeps the right edge }}
          <span class='category'>{{@model.category}}</span>
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
        .category {
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
    setFlag = (key: 'featured' | 'hasDesign' | 'hasExamples', on: boolean) => {
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
              <span id={{this.captionId 'writeup'}} class='wb-cap'>Linked file</span>
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
