import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BrokenLinkTemplate, {
  type BrokenLinkErrorDoc,
  type BrokenLinkFormat,
  type BrokenLinkState,
} from './index.gts';

export default class BrokenLinkUsage extends Component {
  @tracked brokenUrl = 'https://example.com/realm/Author/exploded-card-id';
  @tracked typeName = 'Author';
  @tracked state: BrokenLinkState = 'not-found';
  @tracked format: BrokenLinkFormat = 'embedded';

  // errorDoc is an object arg; expose its rendered fields as individual
  // controls and assemble them into the doc the overlay reads.
  @tracked status = 404;
  @tracked title = 'Not Found';
  @tracked message = 'Could not find the linked card';
  @tracked stack = '';

  // Toggles the optional "Open anyway" affordance, which only shows when a
  // viewCard handler is wired and the reference is a navigable http(s) URL.
  @tracked enableViewCard = false;

  private get errorDoc(): BrokenLinkErrorDoc {
    return {
      status: this.status,
      title: this.title,
      message: this.message,
      stack: this.stack || undefined,
      additionalErrors: null,
    };
  }

  private viewCard = (url: URL) => {
    alert(`Open anyway: ${url.href}`);
  };

  private get maybeViewCard() {
    return this.enableViewCard ? this.viewCard : undefined;
  }

  <template>
    <FreestyleUsage
      @name='BrokenLinkTemplate'
      @description='Placeholder shown when a card/file reference fails to resolve (deleted, moved, or no permission). Renders an identical box across failures — a link-off icon with the type/file label — and hides the diagnostics (status, message, stack, additional errors) behind a warning-triangle reveal overlay that also carries the reference URL and a copy button. Used by broken linksTo / linksToMany field values and the markdown-embed chooser.'
    >
      <:example>
        <div class='broken-link-usage-frame'>
          <BrokenLinkTemplate
            @brokenUrl={{this.brokenUrl}}
            @typeName={{this.typeName}}
            @errorDoc={{this.errorDoc}}
            @state={{this.state}}
            @format={{this.format}}
            @viewCard={{this.maybeViewCard}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='brokenUrl'
          @description='The unresolvable reference. Shown (as plain text, never a link) in the reveal overlay with a copy button.'
          @value={{this.brokenUrl}}
          @onInput={{fn (mut this.brokenUrl)}}
        />
        <Args.String
          @name='typeName'
          @optional={{true}}
          @description="Human-readable label next to the link-off icon — the card type name, or a filename for file refs. Falls back to 'Card'."
          @value={{this.typeName}}
          @onInput={{fn (mut this.typeName)}}
        />
        <Args.String
          @name='state'
          @description="'not-found' shows a single status badge; 'error' shows the diagnostics accordion. Also drives the overlay headline."
          @options={{array 'not-found' 'error'}}
          @value={{this.state}}
          @onInput={{fn (mut this.state)}}
        />
        <Args.String
          @name='format'
          @description='Footprint of the placeholder box, mirroring the card format it stands in for.'
          @options={{array 'atom' 'embedded' 'fitted' 'isolated'}}
          @value={{this.format}}
          @onInput={{fn (mut this.format)}}
        />
        <Args.Number
          @name='errorDoc.status'
          @description='HTTP-ish status code shown in the status badge / accordion header.'
          @value={{this.status}}
          @onInput={{fn (mut this.status)}}
        />
        <Args.String
          @name='errorDoc.title'
          @description='Status title shown alongside the code.'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
        />
        <Args.String
          @name='errorDoc.message'
          @description='Error prose. Hidden for not-found (redundant with the URL) and when the stack already carries it.'
          @value={{this.message}}
          @onInput={{fn (mut this.message)}}
        />
        <Args.String
          @name='errorDoc.stack'
          @description='Optional stack trace shown in the error accordion body.'
          @value={{this.stack}}
          @onInput={{fn (mut this.stack)}}
        />
        <Args.Bool
          @name='viewCard'
          @description='Wire an "Open anyway" handler. The affordance shows only when set and the reference is a navigable http(s) URL.'
          @value={{this.enableViewCard}}
          @onInput={{fn (mut this.enableViewCard)}}
          @defaultValue={{false}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      /* The placeholder fills its slot and lets the reveal overlay extend past
         its footprint, bounded by the surrounding card. Give it a card-sized,
         overflow-hidden frame so the demo mirrors a real card slot. */
      .broken-link-usage-frame {
        position: relative;
        width: 100%;
        max-width: 24rem;
        min-height: 20rem;
        margin: 0 auto;
        padding: var(--boxel-sp);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}
