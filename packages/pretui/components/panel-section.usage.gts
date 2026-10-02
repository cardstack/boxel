// Pretui — PanelSection usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { PanelSection } from './panel-section';
import { PropertyRow } from './property-row';
import { ScrubInput } from './scrub-input';

// ── PanelSection ─────────────────────────────────────────────────────────
class PanelSectionUsage extends Component {
  @tracked title = 'Layout';
  @tracked summary = '3 rules';
  @tracked collapsible = true;
  @tracked open = true;

  setTitle = (v: string) => (this.title = v);
  setSummary = (v: string) => (this.summary = v);
  setCollapsible = (v: boolean) => (this.collapsible = v);
  toggled = (v: boolean) => (this.open = v);

  @tracked width: number | null = 320;
  @tracked height: number | null = 180;
  setWidth = (v: number | null) => (this.width = v);
  setHeight = (v: number | null) => (this.height = v);

  get usage() {
    return (
      "<PanelSection @title='" +
      this.title +
      "' @summary='" +
      this.summary +
      "'>\n  <PropertyRow … />\n</PanelSection>"
    );
  }
  <template>
    <FreestyleUsage
      @name='PanelSection'
      @description='A titled, collapsible group of property rows — the workhorse of an inspector. Ported from figui3 fig-group, with three fixes: the disclosure is a real button (so header actions stay clickable, which upstream’s whole-header click target swallows), the chevron is aria-hidden outside the heading text, and the collapse is a 0fr→1fr grid transition that needs no height measurement and lands on the end state under prefers-reduced-motion.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-section-demo'>
          <PanelSection
            @title={{this.title}}
            @summary={{this.summary}}
            @collapsible={{this.collapsible}}
            @open={{this.open}}
            @onToggle={{this.toggled}}
          >
            <PropertyRow @label='Width' as |controlId|>
              <ScrubInput
                @controlId={{controlId}}
                @label='Width'
                @value={{this.width}}
                @unit='px'
                @precision={{0}}
                @steppers={{true}}
                @onInput={{this.setWidth}}
              />
            </PropertyRow>
            <PropertyRow @label='Height' as |controlId|>
              <ScrubInput
                @controlId={{controlId}}
                @label='Height'
                @value={{this.height}}
                @unit='px'
                @precision={{0}}
                @steppers={{true}}
                @onInput={{this.setHeight}}
              />
            </PropertyRow>
          </PanelSection>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @value={{this.title}}
          @description='Section heading. Rendered as the accessible name of the disclosure button.'
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='summary'
          @value={{this.summary}}
          @description='Mono count/summary after the title — “3 effects”, “2 selected”.'
          @onInput={{this.setSummary}}
        />
        <Args.Bool
          @name='collapsible'
          @defaultValue={{true}}
          @value={{this.collapsible}}
          @description='false makes it a plain titled group with no disclosure.'
          @onInput={{this.setCollapsible}}
        />
        <Args.Bool
          @name='open'
          @description='CONTROLLED open state. Omit to let the section own it (see @defaultOpen).'
        />
        <Args.Bool
          @name='defaultOpen'
          @defaultValue={{true}}
          @description='Initial state when uncontrolled.'
        />
        <Args.Number
          @name='level'
          @defaultValue={{3}}
          @description='Heading level 2–6 for the title; a panel section sits under the panel’s own h2.'
        />
        <Args.Number
          @name='depth'
          @defaultValue={{0}}
          @description='0 is a top-level group; 1–3 mark a group nested INSIDE another (a Person inside a Subject). It drops the peer hairline, takes the heading out of small-caps, and hangs the body off a vertical rule, so the containment is legible in a still frame. Indentation compounds from the parent’s own body padding — this supplies the treatment, not the offset. See the composed inspector.'
        />
        <Args.Action
          @name='onToggle'
          @description='Receives the next open state.'
        />
        <Args.Yield
          @description='Default block is the section body. The actions block rides in the header, outside the disclosure button.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-section-demo {
        max-width: 300px;
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
        overflow: hidden;
      }
    </style>
  </template>
}

export const DEMOS_PANEL_SECTION: Record<string, unknown> = {
  PanelSection: PanelSectionUsage,
};
