// Pretui — Backdrop usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Backdrop } from './backdrop';
import type { BackdropTone } from './backdrop';
import { Button } from './button';

// ── Backdrop ─────────────────────────────────────────────────────────────
const TONE_OPTIONS: BackdropTone[] = ['scrim', 'frost', 'clear'];

const POSITION_OPTIONS = ['absolute', 'fixed'];

class BackdropUsage extends Component {
  @tracked open = true;
  @tracked tone: BackdropTone = 'frost';
  @tracked blur = 8;
  @tracked position: 'fixed' | 'absolute' = 'absolute';
  @tracked label = 'Close the consignment sheet';
  @tracked focusable = true;
  @tracked dismissible = true;

  setTone = (v: string) => (this.tone = v as BackdropTone);
  setBlur = (v: number | null) => (this.blur = v ?? 0);
  setPosition = (v: string) => (this.position = v as 'fixed' | 'absolute');
  setLabel = (v: string) => (this.label = v);
  setFocusable = (v: boolean) => (this.focusable = v);
  setDismissible = (v: boolean) => (this.dismissible = v);
  setOpen = (v: boolean) => (this.open = v);
  dismiss = () => (this.open = false);
  reopen = () => (this.open = true);

  get toneOptions() {
    return TONE_OPTIONS;
  }
  get positionOptions() {
    return POSITION_OPTIONS;
  }
  get usage() {
    let bits = [`@open={{this.open}}`, `@tone='${this.tone}'`];
    if (this.blur !== 8 || this.tone !== 'frost') {
      bits.push(`@blur={{${this.blur}}}`);
    }
    bits.push(`@position='${this.position}'`);
    if (this.dismissible) {
      bits.push('@onDismiss={{this.close}}');
      bits.push(`@label='${this.label}'`);
      if (this.focusable) bits.push('@focusable={{true}}');
    }
    return `<Backdrop ${bits.join(' ')} />\n{{! the layered surface is a SIBLING above it, never a child }}\n<Dialog @open={{this.open}} @onClose={{this.close}} />`;
  }
  <template>
    <FreestyleUsage
      @name='Backdrop'
      @description="The scrim/underlay behind a layered surface — dialogs, drawers, sheets, popovers, media lightboxes. Reach for it whenever something floats above the page and the page beneath should read as inactive. Better than the click-catching div with an onClick that every React overlay tutorial ships: when you pass @onDismiss the scrim is a REAL button, so it has an accessible name and answers Enter/Space and Escape as well as click; without @onDismiss it is an inert aria-hidden div rather than a fake control. The tint is one token (--pretui-overlay-scrim — the same value Dialog and Drawer already paint on ::backdrop), so a themed scrim matches the native top-layer one exactly. The entry fade is @starting-style, so there is no JS mount transition and reduced motion simply gets the end state. It yields nothing on purpose: children would either nest interactive content inside a button or force a second wrapper, so the layered surface is a sibling above it, not a child. @tone='frost' is the expensive one — a full-surface backdrop-filter on every paint."
      @source={{this.usage}}
    >
      <:example>
        <div class='bd-stage'>
          <div class='bd-sheet'>
            <h3 class='bd-title'>Consignment WY-4471</h3>
            <p class='bd-line'>Silver Peak Trading · Wuyishan → Rotterdam</p>
            <p class='bd-line'>48 crates · $102/kg · lands 2026-05-07</p>
            <p class='bd-line'>The sheet keeps painting underneath — a frost
              scrim blurs it, a clear one only catches the click.</p>
          </div>

          {{#if this.dismissible}}
            <Backdrop
              @open={{this.open}}
              @tone={{this.tone}}
              @blur={{this.blur}}
              @position={{this.position}}
              @onDismiss={{this.dismiss}}
              @label={{this.label}}
              @focusable={{this.focusable}}
            />
          {{else}}
            <Backdrop
              @open={{this.open}}
              @tone={{this.tone}}
              @blur={{this.blur}}
              @position={{this.position}}
            />
          {{/if}}

          <div class='bd-controls'>
            {{#if this.open}}
              <span class='bd-hint'>{{if
                  this.dismissible
                  'Click the scrim (or Tab to it and press Enter) to dismiss.'
                  'Inert scrim — no dismiss handler, so nothing to click.'
                }}</span>
            {{else}}
              <Button @tone='primary' {{on 'click' this.reopen}}>Raise the
                scrim</Button>
            {{/if}}
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='open'
          @value={{this.open}}
          @onInput={{this.setOpen}}
          @defaultValue={{true}}
          @description='Render the scrim. Defaults to true so <Backdrop /> just works; bind it to a real state to keep the @starting-style entry fade.'
        />
        <Args.String
          @name='tone'
          @options={{this.toneOptions}}
          @value={{this.tone}}
          @onInput={{this.setTone}}
          @defaultValue='scrim'
          @description='scrim = tinted; frost = tinted plus a backdrop blur and a saturation lift; clear = invisible, purely a click-catcher (the Popover/Select dismissal pattern).'
        />
        <Args.Number
          @name='blur'
          @min={{0}}
          @max={{40}}
          @step={{1}}
          @value={{this.blur}}
          @onInput={{this.setBlur}}
          @defaultValue={{0}}
          @description='Backdrop blur radius in px (clamped 0–40). Any tone may set it; frost defaults to 8 and keeps its saturation lift when you override the radius. Only a value above 0 turns the filter on — a blur(0px) would still promote the scrim to its own compositing layer and make it a containing block for fixed descendants.'
        />
        <Args.String
          @name='position'
          @options={{this.positionOptions}}
          @value={{this.position}}
          @onInput={{this.setPosition}}
          @defaultValue='fixed'
          @description='fixed covers the viewport (the modal case, and the component default). absolute covers the nearest positioned ancestor — a panel-local scrim, which is what this demo uses so the workbench stays visible. Switching this to fixed here will cover the whole workbench; the scrim is still dismissable.'
        />
        <Args.Action
          @name='onDismiss'
          @description='Dismiss handler. Its presence is the switch between the two renderings: with it the scrim is a real <button> (click, Enter/Space, Escape); without it an inert aria-hidden <div> that swallows nothing. Toggle the row below to see both.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='(demo) pass @onDismiss'
          @value={{this.dismissible}}
          @onInput={{this.setDismissible}}
          @defaultValue={{true}}
          @description='Demo-only switch — not a component arg. Flips between the button rendering and the inert-div rendering.'
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @onInput={{this.setLabel}}
          @defaultValue='Close'
          @description='Accessible name for the dismiss button. Only meaningful when @onDismiss is passed; the inert div is aria-hidden and needs none.'
        />
        <Args.Bool
          @name='focusable'
          @value={{this.focusable}}
          @onInput={{this.setFocusable}}
          @defaultValue={{false}}
          @description='Put the dismiss button in the tab order. Off by default: the owning surface owns Escape, and a full-viewport tab stop is noise in a focus-trapped dialog. Turn it on when the backdrop is the only way out.'
        />
        <Args.Number
          @name='z'
          @description='Stacking level for the scrim. Also settable as the --pretui-backdrop-z custom property on any ancestor; defaults to 50, below Popup’s 60.'
          @defaultValue={{50}}
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Yields nothing, on purpose. Children would either nest interactive content inside a <button> (an a11y violation) or force a second wrapper — so the layered surface is a SIBLING of the backdrop, above it in the stacking order.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .bd-stage {
        position: relative;
        min-height: 220px;
        padding: var(--space-5, 15px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: 0 0 0 1px var(--border);
        overflow: hidden;
      }
      .bd-sheet {
        display: grid;
        gap: var(--space-2, 6px);
      }
      .bd-title {
        margin: 0;
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
        color: var(--foreground);
      }
      .bd-line {
        margin: 0;
        max-width: 52ch;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      /* above the scrim, so the demo is never a dead end */
      .bd-controls {
        position: absolute;
        right: var(--space-5, 15px);
        bottom: var(--space-5, 15px);
        z-index: 51;
      }
      .bd-hint {
        display: inline-block;
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
        background: var(--card);
        box-shadow: 0 0 0 1px var(--border);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_BACKDROP: Record<string, unknown> = {
  Backdrop: BackdropUsage,
};
