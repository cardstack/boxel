// Pretui — BrokenLink usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { BrokenLink } from '../feedback';

// ── BrokenLink ← broken-link/usage.gts ───────────────────────────────────
// Dropped knobs: itemType + state + format (Pretui renders one inline token,
// no card/file or not-found/error variants), errorDoc.status / errorDoc.title
// / errorDoc.message / errorDoc.stack (no diagnostics reveal overlay).
// viewCard is documented below as an Args.Action row from the boxel-ui
// lineage; Pretui's signature does not carry it.
class BrokenLinkUsage extends GlimmerComponent {
  @tracked label = 'Author';
  @tracked refId = 'exploded-card-id';
  setLabel = (v: string) => (this.label = v);
  setRefId = (v: string) => (this.refId = v);
  get labelVal() {
    return this.label || undefined;
  }
  get refIdVal() {
    return this.refId || undefined;
  }
  <template>
    <FreestyleUsage
      @name='BrokenLink'
      @description='Placeholder shown when a card/file reference fails to resolve (deleted, moved, or no permission). Renders an identical box across failures — a link-off icon with the type/file label — and hides the diagnostics (status, message, stack, additional errors) behind a warning-triangle reveal overlay that also carries the reference URL and a copy button. Used by broken linksTo / linksToMany field values and the markdown-embed chooser.'
    >
      <:example>
        <BrokenLink @label={{this.labelVal}} @refId={{this.refIdVal}} />
        <BrokenLink />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='refId'
          @description='The unresolvable reference. Shown (as plain text, never a link) — in Pretui inline beside the label rather than in a reveal overlay.'
          @value={{this.refId}}
          @onInput={{this.setRefId}}
        />
        <Args.String
          @name='label'
          @description="Human-readable label next to the link-off icon — the card type name, or a filename for file refs. Falls back to 'missing card'."
          @value={{this.label}}
          @onInput={{this.setLabel}}
        />
        <Args.Action
          @name='viewCard'
          @description='Wire an "Open anyway" handler. The affordance shows only when set and the reference is a navigable http(s) URL. Not in the Pretui signature yet — documented from the boxel-ui lineage.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_BROKEN_LINK: Record<string, unknown> = {
  BrokenLink: BrokenLinkUsage,
};
