// Pretui — Accordion usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Accordion } from './accordion';

// ── Accordion ← accordion/usage.gts ──────────────────────────────────────
// Dropped knobs: the --boxel-accordion-* cssVars rows (the CSS knob layer
// is not ported; the wrapper pins that channel to Pretui tokens). Item
// @className/@contentClass pass through untyped (the contextual Item is
// boxel's own). The demo keeps upstream's single-open policy: clicking an
// open item closes it, clicking another moves the open state.
class AccordionUsage extends Component {
  @tracked displayContainer = true;
  @tracked openId: string | null = 'schema';
  setDisplayContainer = (v: boolean) => (this.displayContainer = v);
  toggle = (id: string) => {
    this.openId = this.openId === id ? null : id;
  };
  toggleSchema = (_e: Event) => this.toggle('schema');
  togglePlayground = (_e: Event) => this.toggle('playground');
  toggleDisabled = (_e: Event) => this.toggle('disabled');
  get schemaOpen() {
    return this.openId === 'schema';
  }
  get playgroundOpen() {
    return this.openId === 'playground';
  }
  get disabledOpen() {
    return this.openId === 'disabled';
  }
  get usage() {
    let bit = this.displayContainer ? ' @displayContainer={{true}}' : '';
    return `<Accordion${bit} as |A|>\n  <A.Item @id='schema' @isOpen={{this.schemaOpen}} @onClick={{this.toggleSchema}}>\n    <:title>Schema editor</:title>\n    <:content>…</:content>\n  </A.Item>\n</Accordion>`;
  }
  <template>
    <FreestyleUsage
      @name='Accordion'
      @description="Collapsible disclosure panels with a clickable header and animated expand/collapse — group several to build FAQ entries, settings groups, or any progressive-disclosure UI. Wraps boxel-ui's Accordion engine (grid-rows height transition, ARIA region wiring) in the Pretui cloth; open state is controlled per item, so single- or multi-open policy is yours."
      @source={{this.usage}}
    >
      <:example>
        <Accordion @displayContainer={{this.displayContainer}} as |A|>
          <A.Item
            @id='schema'
            @isOpen={{this.schemaOpen}}
            @onClick={{this.toggleSchema}}
          >
            <:title>Schema editor</:title>
            <:content>
              <p class='accordion-copy'>Fields, computeds, and relationships —
                the card's typed shape. The content region is inert while
                closed and transitions its height open.</p>
            </:content>
          </A.Item>
          <A.Item
            @id='playground'
            @isOpen={{this.playgroundOpen}}
            @onClick={{this.togglePlayground}}
          >
            <:title>Playground</:title>
            <:content>
              <p class='accordion-copy'>Try instances against the schema in
                every format.</p>
              <p class='accordion-copy'>A second paragraph, to show the region
                grows to fit whatever the content block renders.</p>
            </:content>
          </A.Item>
          <A.Item
            @id='disabled'
            @isOpen={{this.disabledOpen}}
            @onClick={{this.toggleDisabled}}
            @disabled={{true}}
          >
            <:title>Disabled item</:title>
            <:content>
              <p class='accordion-copy'>Never opens.</p>
            </:content>
          </A.Item>
        </Accordion>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='displayContainer'
          @defaultValue={{false}}
          @value={{this.displayContainer}}
          @description='Draws the rounded container border around the group.'
          @onInput={{this.setDisplayContainer}}
        />
        <Args.Yield
          @description='Yields { Item } — boxel-ui AccordionItem passed through. Item args: @id (string, wires ARIA), @isOpen (controlled), @onClick, @disabled; blocks <:title> and <:content>.'
          @hideControls={{true}}
        />
        <Args.String
          @name='Item @id'
          @description='Unique id per item — becomes the trigger id and the aria-controls target.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='Item @isOpen'
          @description='Controlled open state for the item; the height transition and inert content follow it.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='Item @onClick'
          @description='Trigger click handler — implement toggle/exclusive policy here.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='Item @disabled'
          @description='Disables the trigger button.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .accordion-copy {
        margin: 0 0 6px;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
        max-width: 52ch;
      }
    </style>
  </template>
}

export const DEMOS_ACCORDION: Record<string, unknown> = {
  Accordion: AccordionUsage,
};
