import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';

import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import type { Placement } from '@floating-ui/dom';

import Popover from '../popover';
import {
  POPOVER_KIND_GLYPHS,
  resolvePopoverEscalationTarget,
  type PopoverKind,
  type PopoverAnchoring,
  type PopoverSize,
  type PopoverBackdrop,
  type PopoverElevation,
  type PopoverKeyboardModel,
} from '../utils/popover-types';
import CodeSnippet from '@cardstack/catalog/components/code-snippet';

/**
 * A config explorer for `<Popover>`. Every exported type union is shown
 * as a `BoxelSelect` across the top, so you can mix any combination and
 * watch a live `<Popover>` preview + the generated invocation update
 * together. The preview body is crafted per `kind`, mirroring how the
 * popover docs describe each: 'details' is a read-only info view, 'edit'
 * is a BoxelSelect + input editor (the yellow editor surface), and
 * 'tools' is a dark action menu. Escalating with the corner glyph swaps
 * between them.
 */
class PopoverPlaygroundIsolated extends Component<typeof PopoverPlayground> {
  kindOptions = ['details', 'edit', 'tools'];
  anchoringOptions = ['beside', 'overlay', 'center'];
  sizeOptions = ['compact', 'comfortable', 'spacious', 'auto'];
  backdropOptions = ['none', 'tint', 'blur', 'dim'];
  elevationOptions = ['flat', 'raised', 'elevated', 'floating'];
  keyboardOptions = ['none', 'pick', 'edit'];
  trapFocusOptions = ['off', 'on'];

  @tracked kind: PopoverKind = 'details';
  @tracked anchoring: PopoverAnchoring = 'beside';
  @tracked size: PopoverSize = 'compact';
  @tracked backdrop: PopoverBackdrop = 'none';
  @tracked elevation: PopoverElevation = 'raised';
  @tracked keyboard: PopoverKeyboardModel | undefined = undefined;
  @tracked trapFocusOn = false;
  @tracked escalationEnabled = true;

  // autoFocus is the one boolean-ish arg whose unset default is NOT the
  // same as `false`: omitted, the component focuses edit/tools but not
  // details. So it needs three states — 'default' leaves it unset.
  autoFocusOptions = ['default', 'on', 'off'];
  @tracked autoFocusChoice = 'default';

  /** Value passed to @autoFocus — undefined on 'default' so the
   *  component's per-kind default applies (and previewCode omits it). */
  get autoFocusArg(): boolean | undefined {
    if (this.autoFocusChoice === 'on') return true;
    if (this.autoFocusChoice === 'off') return false;
    return undefined;
  }

  @tracked openFrom: 'hover' | 'click' | null = null;

  get open(): boolean {
    return this.openFrom !== null;
  }

  get anchorSelector(): string {
    return this.openFrom === 'click'
      ? '[data-anchor=pp-click]'
      : '[data-anchor=pp-hover]';
  }

  // Priority options — edited via BoxelSelect in the 'edit' view and
  // shown read-only in the 'details' view.
  pickOptions = ['Low', 'Medium', 'High', 'Urgent'];
  @tracked pickIndex = 1;
  @tracked editNote = '';

  /** Currently selected priority label. */
  get selectedPick(): string {
    return this.pickOptions[this.pickIndex] ?? '—';
  }

  setPickByLabel = (label: string): void => {
    const index = this.pickOptions.indexOf(label);
    if (index >= 0) this.pickIndex = index;
  };

  setEditNote = (event: Event): void => {
    this.editNote = (event.target as HTMLInputElement).value;
  };

  // ── extra knobs beyond the 6 type unions: the beside-positioning
  // args (@placement / @offset / @arrow) ──
  @tracked placement: Placement = 'bottom';
  @tracked offset = 8;
  @tracked arrowOn = false;

  placementOptions: Placement[] = [
    'top',
    'top-start',
    'top-end',
    'bottom',
    'bottom-start',
    'bottom-end',
    'left',
    'left-start',
    'left-end',
    'right',
    'right-start',
    'right-end',
  ];
  offsetOptions = ['0', '4', '8', '12', '16', '24'];
  arrowOptions = ['off', 'on'];

  get offsetStr(): string {
    return String(this.offset);
  }

  get arrowChoice(): string {
    return this.arrowOn ? 'on' : 'off';
  }

  /** undefined when off — see trapFocusArg. */
  get arrowArg(): boolean | undefined {
    return this.arrowOn ? true : undefined;
  }

  setPlacement = (value: Placement): void => {
    this.placement = value;
  };

  setOffset = (value: string): void => {
    this.offset = Number(value);
  };

  setArrow = (value: string): void => {
    this.arrowOn = value === 'on';
  };

  // ── tools-menu actions (the 'tools' view) — each drives a real
  // popover behavior the docs describe (placement / caret / dismissal). ──
  cyclePlacement = (): void => {
    const i = this.placementOptions.indexOf(this.placement);
    const next = this.placementOptions[(i + 1) % this.placementOptions.length];
    if (next) this.placement = next;
  };

  toggleArrow = (): void => {
    this.arrowOn = !this.arrowOn;
  };

  /** Generated invocation reflecting every current selection. */
  get previewCode(): string {
    const lines = [
      `<Popover`,
      `  @anchor='[data-anchor=preview]'`,
      `  @open={{this.open}}`,
      `  @kind='${this.kind}'`,
      `  @anchoring='${this.anchoring}'`,
    ];
    // @placement / @offset / @arrow only apply to beside.
    if (this.anchoring === 'beside') {
      lines.push(`  @placement='${this.placement}'`);
      lines.push(`  @offset={{${this.offset}}}`);
      if (this.arrowOn) lines.push(`  @arrow={{true}}`);
    }
    lines.push(`  @size='${this.size}'`);
    lines.push(`  @backdrop='${this.backdrop}'`);
    lines.push(`  @elevation='${this.elevation}'`);
    if (this.keyboard !== undefined) {
      lines.push(`  @keyboardModel='${this.keyboard}'`);
    }
    if (this.trapFocusOn) lines.push(`  @trapFocus={{true}}`);
    // autoFocus is emitted for BOTH overrides; 'default' omits it so the
    // generated code reflects the component's per-kind default.
    if (this.autoFocusChoice !== 'default') {
      lines.push(`  @autoFocus={{${this.autoFocusChoice === 'on'}}}`);
    }
    if (this.escalationEnabled) {
      const targets = this.escalationTargets.map((k) => `'${k}'`).join(' ');
      lines.push(`  @canEscalateTo={{(array ${targets})}}`);
      lines.push(`  @onEscalate={{this.handleEscalate}}`);
    }
    lines.push(`  @onDismiss={{this.close}}`);
    lines.push(`>`);
    // One named block per reachable kind — the current kind plus any
    // escalation targets. The popover renders the block matching @kind.
    const reachable = (['details', 'edit', 'tools'] as PopoverKind[]).filter(
      (k) => k === this.kind || this.escalationTargets.includes(k),
    );
    for (const k of reachable) {
      lines.push(`  <:${k}>`, `    …${k} content…`, `  </:${k}>`);
    }
    lines.push(`</Popover>`);
    return lines.join('\n');
  }

  setKind = (value: PopoverKind): void => {
    this.kind = value;
  };

  setAnchoring = (value: PopoverAnchoring): void => {
    this.anchoring = value;
  };

  setSize = (value: PopoverSize): void => {
    this.size = value;
  };

  setBackdrop = (value: PopoverBackdrop): void => {
    this.backdrop = value;
  };

  setElevation = (value: PopoverElevation): void => {
    this.elevation = value;
  };

  setKeyboard = (value: string): void => {
    this.keyboard =
      value === 'none' ? undefined : (value as PopoverKeyboardModel);
  };

  get keyboardChoice(): string {
    return this.keyboard ?? 'none';
  }

  get trapFocusChoice(): string {
    return this.trapFocusOn ? 'on' : 'off';
  }

  /** Pass undefined (not false) when off so the live preview matches the
   *  generated code, which omits the arg. trapFocus/arrow only need two
   *  states because their unset default already IS false. */
  get trapFocusArg(): boolean | undefined {
    return this.trapFocusOn ? true : undefined;
  }

  setTrapFocus = (value: string): void => {
    this.trapFocusOn = value === 'on';
  };

  setAutoFocus = (value: string): void => {
    this.autoFocusChoice = value;
  };

  escalationOptions = ['off', 'on'];

  get escalationChoice(): string {
    return this.escalationEnabled ? 'on' : 'off';
  }

  setEscalation = (value: string): void => {
    this.escalationEnabled = value === 'on';
  };

  /** All kinds except the currently active one — passed to @canEscalateTo. */
  get escalationTargets(): PopoverKind[] {
    if (!this.escalationEnabled) return [];
    return (['details', 'edit'] as PopoverKind[]).filter(
      (k) => k !== this.kind,
    );
  }

  // Reuse the component's own escalation contract — the destination, its
  // glyph, and the priority order all come from popover.gts, so the
  // playground never re-decides which icon means what.
  get primaryEscalationTarget(): PopoverKind | undefined {
    return resolvePopoverEscalationTarget(this.escalationTargets);
  }

  /** Glyph the corner button shows — the component's glyph for the
   *  destination kind, so ✎ means "switch to edit", ⓘ "to details",
   *  ⋯ "to tools". */
  get escalationGlyphChar(): string {
    const target = this.primaryEscalationTarget;
    return target ? POPOVER_KIND_GLYPHS[target] : '';
  }

  get escalationTargetLabel(): string {
    const labels: Record<PopoverKind, string> = {
      details: 'a details view',
      edit: 'an editor',
      tools: 'a tools menu',
    };
    const target = this.primaryEscalationTarget;
    return target ? labels[target] : '';
  }

  handleEscalate = (next: PopoverKind): void => {
    this.kind = next;
  };

  openHover = (): void => {
    this.openFrom = 'hover';
  };

  openClick = (): void => {
    this.openFrom = this.openFrom === 'click' ? null : 'click';
  };

  close = (): void => {
    this.openFrom = null;
  };

  <template>
    <div class='pp'>
      <div class='pp-section'>Live preview</div>
      <div class='pp-stage'>
        {{#if @model.cardTheme}}
          <span class='pp-theme-chip' data-test-pp-theme-chip>
            Themed:
            {{@model.cardTheme.cardTitle}}
          </span>
        {{/if}}
        <button
          type='button'
          class='pp-open'
          data-anchor='pp-hover'
          {{on 'mouseenter' this.openHover}}
        >
          Hover to open ▾
        </button>
        <button
          type='button'
          class='pp-open {{if (eq this.openFrom "click") "pp-open--active"}}'
          data-anchor='pp-click'
          {{on 'click' this.openClick}}
        >
          Click to open ▾
        </button>

        {{#if this.open}}
          <Popover
            @anchor={{this.anchorSelector}}
            @open={{true}}
            @kind={{this.kind}}
            @anchoring={{this.anchoring}}
            @placement={{this.placement}}
            @offset={{this.offset}}
            @arrow={{this.arrowArg}}
            @size={{this.size}}
            @backdrop={{this.backdrop}}
            @elevation={{this.elevation}}
            @keyboardModel={{this.keyboard}}
            @trapFocus={{this.trapFocusArg}}
            @autoFocus={{this.autoFocusArg}}
            @canEscalateTo={{this.escalationTargets}}
            @onEscalate={{this.handleEscalate}}
            @onDismiss={{this.close}}
          >
            <:edit>
              {{! EDIT — the editor surface (kind paints it yellow). A
                  BoxelSelect + text input, the controls keyboardModel='edit'
                  focuses. }}
              <div class='pp-body pp-edit'>
                <div class='pp-eyebrow'>edit</div>
                <label class='pp-field'>
                  <span class='pp-field-label'>Priority</span>
                  <BoxelSelect
                    @options={{this.pickOptions}}
                    @selected={{this.selectedPick}}
                    @onChange={{this.setPickByLabel}}
                    @placeholder='Choose…'
                    as |item|
                  >
                    {{item}}
                  </BoxelSelect>
                </label>
                <label class='pp-field'>
                  <span class='pp-field-label'>Note</span>
                  <input
                    class='pp-input'
                    placeholder='Add a note…'
                    value={{this.editNote}}
                    {{on 'input' this.setEditNote}}
                  />
                </label>
              </div>
            </:edit>
            <:tools>
              {{! TOOLS — a dark action menu (the docs paint tools kind on a
                  dark surface). Each item drives a real popover behavior. }}
              <div class='pp-body pp-tools'>
                <div class='pp-eyebrow'>tools</div>
                <ul
                  class='pp-tools-menu'
                  role='menu'
                  aria-label='Popover tools'
                >
                  <li role='none'>
                    <button
                      type='button'
                      role='menuitem'
                      class='pp-tool'
                      {{on 'click' this.cyclePlacement}}
                    >
                      <span class='pp-tool-glyph'>⤢</span>
                      <span class='pp-tool-text'>Cycle placement</span>
                      <span class='pp-tool-meta'>{{this.placement}}</span>
                    </button>
                  </li>
                  <li role='none'>
                    <button
                      type='button'
                      role='menuitem'
                      class='pp-tool'
                      {{on 'click' this.toggleArrow}}
                    >
                      <span class='pp-tool-glyph'>▲</span>
                      <span class='pp-tool-text'>Toggle caret</span>
                      <span class='pp-tool-meta'>{{if
                          this.arrowOn
                          'on'
                          'off'
                        }}</span>
                    </button>
                  </li>
                  <li role='none'>
                    <button
                      type='button'
                      role='menuitem'
                      class='pp-tool'
                      {{on 'click' this.close}}
                    >
                      <span class='pp-tool-glyph'>✕</span>
                      <span class='pp-tool-text'>Dismiss popover</span>
                    </button>
                  </li>
                </ul>
              </div>
            </:tools>
            <:details>
              {{! DETAILS — passive, read-only info (the docs give details
                  kind a tooltip role + muted text). No edit field. }}
              <div class='pp-body pp-detail'>
                <div class='pp-eyebrow'>details</div>
                <div class='pp-detail-title'>{{this.selectedPick}}
                  priority</div>
                <dl class='pp-detail-list'>
                  <div class='pp-detail-row'>
                    <dt>Anchoring</dt>
                    <dd>{{this.anchoring}}</dd>
                  </div>
                  <div class='pp-detail-row'>
                    <dt>Size</dt>
                    <dd>{{this.size}}</dd>
                  </div>
                  <div class='pp-detail-row'>
                    <dt>Backdrop</dt>
                    <dd>{{this.backdrop}}</dd>
                  </div>
                  <div class='pp-detail-row'>
                    <dt>Elevation</dt>
                    <dd>{{this.elevation}}</dd>
                  </div>
                </dl>
                {{#if this.primaryEscalationTarget}}
                  <p class='pp-detail-note'>Read-only — click the
                    {{this.escalationGlyphChar}}
                    glyph to switch to
                    {{this.escalationTargetLabel}}.</p>
                {{else}}
                  <p class='pp-detail-note'>Read-only detail view — no edit
                    field.</p>
                {{/if}}
              </div>
            </:details>
          </Popover>
        {{/if}}
      </div>

      <div class='pp-section'>Appearance</div>
      <div class='pp-axes'>
        <div class='pp-axis'>
          <span class='pp-label'>@kind</span>
          <BoxelSelect
            @options={{this.kindOptions}}
            @selected={{this.kind}}
            @onChange={{this.setKind}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Sets the ARIA role, the CSS colour theme, and
            which named block (<code>&lt;:details&gt;</code>,
            <code>&lt;:edit&gt;</code>,
            <code>&lt;:tools&gt;</code>) renders.
            <code>details</code>
            = passive tooltip,
            <code>edit</code>
            = yellow editor surface,
            <code>tools</code>
            = dark action menu.</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@anchoring</span>
          <BoxelSelect
            @options={{this.anchoringOptions}}
            @selected={{this.anchoring}}
            @onChange={{this.setAnchoring}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Controls where the popover is placed.
            <code>beside</code>
            floats next to the anchor,
            <code>overlay</code>
            covers it,
            <code>center</code>
            is viewport-centered (use with
            <code>backdrop=dim</code>
            for a modal).</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@size</span>
          <BoxelSelect
            @options={{this.sizeOptions}}
            @selected={{this.size}}
            @onChange={{this.setSize}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Sets the min/max width and height.
            <code>compact</code>
            for short menus,
            <code>comfortable</code>
            for pickers,
            <code>spacious</code>
            for complex editors,
            <code>auto</code>
            to hug content.</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@backdrop</span>
          <BoxelSelect
            @options={{this.backdropOptions}}
            @selected={{this.backdrop}}
            @onChange={{this.setBackdrop}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Controls the surface material behind the
            popover.
            <code>none</code>
            = opaque white,
            <code>tint</code>
            = 80% opaque,
            <code>blur</code>
            = frosted glass,
            <code>dim</code>
            = full-page overlay.</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@elevation</span>
          <BoxelSelect
            @options={{this.elevationOptions}}
            @selected={{this.elevation}}
            @onChange={{this.setElevation}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Controls shadow depth and corner radius.
            <code>flat</code>
            = no shadow,
            <code>raised</code>
            = subtle lift,
            <code>elevated</code>
            = prominent,
            <code>floating</code>
            = maximum depth.</span>
        </div>
      </div>

      <div class='pp-section'>Positioning &amp; behavior</div>
      <div class='pp-axes'>
        <div class='pp-axis'>
          <span class='pp-label'>@placement</span>
          <BoxelSelect
            @options={{this.placementOptions}}
            @selected={{this.placement}}
            @onChange={{this.setPlacement}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Preferred side and alignment for
            <code>beside</code>
            anchoring (Floating UI). Automatically flips if there is not enough
            room.</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@offset</span>
          <BoxelSelect
            @options={{this.offsetOptions}}
            @selected={{this.offsetStr}}
            @onChange={{this.setOffset}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}px
          </BoxelSelect>
          <span class='pp-desc'>Gap in pixels between the anchor edge and the
            popover. Only applies to
            <code>beside</code>
            anchoring.</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@arrow</span>
          <BoxelSelect
            @options={{this.arrowOptions}}
            @selected={{this.arrowChoice}}
            @onChange={{this.setArrow}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Shows a small caret pointing back at the anchor.
            Only applies to
            <code>beside</code>
            anchoring.</span>
        </div>
      </div>

      <div class='pp-section'>Focus, keyboard &amp; ARIA</div>
      <div class='pp-axes'>
        <div class='pp-axis'>
          <span class='pp-label'>@autoFocus</span>
          <BoxelSelect
            @options={{this.autoFocusOptions}}
            @selected={{this.autoFocusChoice}}
            @onChange={{this.setAutoFocus}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Whether DOM focus moves into the popover when it
            opens. Three states because omitting the arg is NOT the same as
            <code>false</code>:
            <code>default</code>
            omits it, so the component decides by kind (edit / tools focus,
            details does not);
            <code>on</code>
            and
            <code>off</code>
            force it. The generated code only writes
            <code>@autoFocus</code>
            for the two forced states.
            <br />
            <strong>Try it:</strong>
            set
            <code>@kind=edit</code>
            and
            <code>default</code>: the input focuses on open. Switch to
            <code>off</code>
            and it no longer does.</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@keyboardModel</span>
          <BoxelSelect
            @options={{this.keyboardOptions}}
            @selected={{this.keyboardChoice}}
            @onChange={{this.setKeyboard}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>Pass to delegate keyboard events into the
            popover body.
            <code>pick</code>
            focuses the listbox and routes arrow keys,
            <code>edit</code>
            focuses the input and routes typing keys. Omit to leave key handling
            to the host.</span>
        </div>
        <div class='pp-axis'>
          <span class='pp-label'>@trapFocus</span>
          <BoxelSelect
            @options={{this.trapFocusOptions}}
            @selected={{this.trapFocusChoice}}
            @onChange={{this.setTrapFocus}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>When
            <code>on</code>, Tab cycles only within the popover and cannot
            escape to the page. Use for editor popovers that own the full focus
            cycle.</span>
        </div>
      </div>

      <div class='pp-section'>Escalation</div>
      <div class='pp-axes'>
        <div class='pp-axis'>
          <span class='pp-label'>@canEscalateTo / @onEscalate</span>
          <BoxelSelect
            @options={{this.escalationOptions}}
            @selected={{this.escalationChoice}}
            @onChange={{this.setEscalation}}
            @placeholder='Choose…'
            as |item|
          >
            {{item}}
          </BoxelSelect>
          <span class='pp-desc'>When
            <code>on</code>, passes all other kinds to
            <code>@canEscalateTo</code>
            and wires
            <code>@onEscalate</code>. A corner glyph appears that depicts the
            destination kind — ✎ to edit, ⓘ to details, ⋯ to tools — so it never
            shows ✎ while you are already in the edit view. Clicking it switches
            to that kind. Open a popover to try it.</span>
        </div>
      </div>

      <div class='pp-section'>Generated code</div>
      <CodeSnippet @code={{this.previewCode}} />

      <div class='pp-section'>Reference — args set in code only</div>
      <div class='pp-args'>
        <div class='pp-arg'>
          <code>@anchor</code>
          <span>A CSS selector pointing to the element the popover anchors to —
            the trigger button or cell the user interacted with. The popover
            reads this element's bounding box to position itself. In this
            playground the hover button has
            <code>data-anchor="pp-hover"</code>
            so the selector is
            <code>[data-anchor=pp-hover]</code>.</span>
        </div>
        <div class='pp-arg'>
          <code>@open</code>
          <span>Mounts or unmounts the popover. The host owns this boolean — set
            it true to open, false to close. Keeping the
            <code>&lt;Popover&gt;</code>
            element in the DOM while
            <code>@open</code>
            is false means re-opens are cheaper because the component is already
            initialised.</span>
        </div>
        <div class='pp-arg'>
          <code>@onDismiss</code>
          <span>Called when the user presses Esc or clicks outside the popover.
            The host should set
            <code>@open</code>
            to false in this handler. The popover does not close itself — the
            host stays in control of open state.</span>
        </div>
        <div class='pp-arg'>
          <code>@canEscalateTo</code>
          /
          <code>@onEscalate</code>
          <span>Pass an array of
            <code>PopoverKind</code>
            values (excluding the current
            <code>@kind</code>) to show a compact corner glyph that lets the
            user switch kind without re-opening. The glyph always depicts the
            destination kind: ✎ → edit, ⓘ → details, ⋯ → tools. When several
            kinds are offered, the highest-priority one (edit, then tools, then
            details) wins, so the icon and the click always agree. When the user
            clicks it,
            <code>@onEscalate</code>
            fires with that kind — host updates
            <code>@kind</code>
            in that handler, and the popover re-renders the named block matching
            the new kind while staying open. Toggle the
            <em>@canEscalateTo / @onEscalate</em>
            control above to see it live.</span>
        </div>
        <div class='pp-arg'>
          <code>@focusToken</code>
          <span>A stable key (e.g. a row+col index) that prevents autofocus from
            re-firing on every re-render of an already-open popover. Without it,
            any data update while the popover is open would steal focus back to
            the first focusable element.</span>
        </div>
        <div class='pp-arg'>
          <code>@relativeScale</code>
          <span>A scale multiplier for hosts that zoom their canvas (e.g. a
            board at 50% zoom). Pass a damped version of the zoom level so the
            popover shrinks proportionally but stays readable. Ignored for
            <code>anchoring=center</code>
            since modal popovers always render at viewport scale.</span>
        </div>
        <div class='pp-arg'>
          <code>@layerTier</code>
          /
          <code>@zIndex</code>
          <span>Override the automatic z-index layer. The popover assigns layers
            automatically based on anchoring and backdrop, so you only need
            these when your host has its own stacking context that conflicts
            with the defaults.</span>
        </div>
        <div class='pp-arg'>
          <code>@label</code>
          /
          <code>@labelledby</code>
          /
          <code>@describedby</code>
          <span>ARIA labeling for the popover root. Use
            <code>@label</code>
            for a plain string name,
            <code>@labelledby</code>
            when the body already has a visible heading (pass its
            <code>id</code>), and
            <code>@describedby</code>
            to link a longer description element.</span>
        </div>
      </div>
    </div>

    <style scoped>
      .pp {
        display: grid;
        gap: 16px;
        padding: 24px;
        max-width: 760px;
        font:
          14px/1.4 system-ui,
          sans-serif;
      }
      .pp-section {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #6b7280;
      }
      .pp-axes {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }
      .pp-axis {
        display: grid;
        gap: 6px;
        align-content: start;
      }
      .pp-label {
        font-size: 11px;
        font-weight: 600;
        color: #4338ca;
      }
      .pp-typeline {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: #9ca3af;
        white-space: normal;
        word-break: break-word;
      }
      .pp-desc {
        font-size: 11px;
        line-height: 1.5;
        color: #6b7280;
      }
      .pp-desc code {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: #4338ca;
        background: #eef2ff;
        padding: 1px 4px;
        border-radius: 3px;
      }
      .pp-stage {
        position: relative;
        height: 250px;
        width: 100%;
        background: #333333;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        overflow: hidden;
        contain: layout size;
      }
      /* Corner chip naming the Theme card the playground instance links
       * (cardInfo.theme) — the popovers below follow that theme. */
      .pp-theme-chip {
        position: absolute;
        top: 8px;
        right: 10px;
        padding: 3px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        background: color-mix(in srgb, var(--primary, #fff) 22%, transparent);
        color: #fff;
      }
      .pp-open {
        padding: 8px 18px;
        border: 1.5px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        color: #374151;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
        transition:
          background 80ms,
          border-color 80ms,
          box-shadow 80ms;
      }
      .pp-open:hover {
        background: #f9fafb;
        border-color: #9ca3af;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.09);
      }
      .pp-open--active {
        background: #eef2ff;
        border-color: #6366f1;
        color: #4338ca;
      }
      .pp-body {
        padding: 10px 12px;
        display: grid;
        gap: 6px;
      }
      .pp-eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--muted-foreground, #6b7280);
      }
      .pp-detail-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--popover-foreground, #111827);
      }
      .pp-detail-list {
        margin: 0;
        display: grid;
        gap: 4px;
      }
      .pp-detail-row {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
        font-size: 12px;
      }
      .pp-detail-row dt {
        color: var(--muted-foreground, #9ca3af);
      }
      .pp-detail-row dd {
        margin: 0;
        color: var(--popover-foreground, #374151);
        font-weight: 500;
      }
      .pp-detail-note {
        margin: 0;
        font-size: 11px;
        line-height: 1.5;
        color: var(--muted-foreground, #6b7280);
      }
      .pp-input {
        padding: 6px 8px;
        border: 1px solid var(--border, #d1d5db);
        border-radius: 4px;
        font: inherit;
        width: 100%;
        background: var(--background, #fff);
      }
      /* EDIT view — form fields on the popover's yellow editor surface. */
      .pp-edit {
        gap: 10px;
      }
      .pp-field {
        display: grid;
        gap: 4px;
      }
      .pp-field-label {
        font-size: 11px;
        font-weight: 600;
        color: #92710c;
      }
      /* TOOLS view — light controls for the popover's dark tools surface. */
      .pp-tools-menu {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px;
      }
      .pp-tool {
        width: 100%;
        display: grid;
        grid-template-columns: 18px 1fr auto;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
        transition: background 80ms;
      }
      .pp-tool:hover,
      .pp-tool:focus-visible {
        background: rgba(255, 255, 255, 0.12);
        outline: none;
      }
      .pp-tool-glyph {
        font-size: 13px;
        opacity: 0.8;
      }
      .pp-tool-meta {
        font-size: 11px;
        opacity: 0.55;
        font-variant-numeric: tabular-nums;
      }
      .pp-args {
        margin: 0;
        display: grid;
        gap: 8px;
      }
      .pp-arg {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 12px;
        align-items: baseline;
        font-size: 12px;
      }
      .pp-arg code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: #4338ca;
      }
      .pp-arg span {
        color: #4b5563;
      }
      .pp-arg em {
        font-style: normal;
        font-family: ui-monospace, monospace;
        color: #6b7280;
      }
      @media (max-width: 520px) {
        .pp-arg {
          grid-template-columns: 1fr;
          gap: 2px;
        }
      }
    </style>
  </template>
}

export class PopoverPlayground extends CardDef {
  static displayName = 'Popover Playground';

  @field title = contains(StringField);

  static isolated = PopoverPlaygroundIsolated;
}
