// Pretui — Accordion: disclosure panels with animated expand and collapse, a thin wrap of boxel-ui Accordion.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Accordion as BoxelAccordion } from '@cardstack/boxel-ui/components';

// ── Accordion — WRAPS boxel-ui ───────────────────────────────────────────
// boxel-ui's disclosure engine is the value: the grid-template-rows
// 0fr→1fr height transition, ARIA region wiring, inert-when-closed
// content. The wrapper feeds Pretui cloth through the --boxel-accordion-*
// knob channel plus the semantic tokens the engine already reads
// (--border, --radius, --ring). State stays with the consumer — boxel's
// controlled @isOpen/@onClick per item — so single- or multi-open policy
// is yours; the yielded contextual A.Item is boxel-ui's AccordionItem
// passed straight through (blocks <:title>/<:content>).

export interface AccordionSignature {
  Args: {
    /** draw the rounded container border around the group */
    displayContainer?: boolean;
  };
  Blocks: {
    /* eslint-disable @typescript-eslint/no-explicit-any -- the yielded
       contextual hash carries boxel-ui's AccordionItem; its signature
       type is not exported from the components barrel */
    default: [{ Item: any }];
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
  Element: HTMLDivElement;
}

export const Accordion: TemplateOnlyComponent<AccordionSignature> = <template>
  <div class='pretui-accordion' data-test-pretui-accordion ...attributes>
    <BoxelAccordion @displayContainer={{@displayContainer}} as |A|>
      {{yield A}}
    </BoxelAccordion>
  </div>
  <style scoped>
    @layer PretComponent {
      /* Pretui dress via the token channel. The engine reads --ring for the
         trigger focus outline and var(--radius) for the container corner;
         both are mapped to the Pretui equivalents here. Title voice: body
         size, 600 weight — the Panel header voice, not boxel's 700. */
      .pretui-accordion {
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--foreground);
        --ring: var(--primary);
        --radius: var(--radius-surface, 10px);
        --boxel-accordion-border: 1px solid var(--border);
        --boxel-accordion-item-border: 1px solid var(--border);
        --boxel-accordion-item-min-height: var(--control-h, 28px);
        --boxel-accordion-title-font-weight: 600;
        --boxel-accordion-trigger-padding-block: var(--space-3, 8px);
        --boxel-accordion-transition: var(--pretui-dur-snap, 180ms)
          var(--pretui-ease-snap, ease);
      }
    }
  </style>
</template>;
