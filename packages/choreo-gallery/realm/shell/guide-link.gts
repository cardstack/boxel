import Component from '@glimmer/component';
import { consume } from 'ember-provide-consume-context';

import type { GalleryDemo } from '../demo';
import { CurrentGuideContext } from '../lib/guide-index';
import { realmFile } from '../lib/realm-url';

interface Signature {
  Args: { demo: GalleryDemo };
  Element: HTMLAnchorElement;
}

/**
 * "Read the guide →": a real link to the concept guide the demo's lesson
 * names, the guide's card in the realm's `docs/guides/`. Following it is the
 * host's navigation, so the guide opens at its own URL.
 *
 * Inside the guide it would link, as a demo embedded in that guide, the link
 * would lead back to the page being read, so it is left out.
 */
export class GuideLink extends Component<Signature> {
  @consume(CurrentGuideContext) declare currentGuide: string | undefined;

  get guide(): string | undefined {
    let guide = this.args.demo.lesson?.guide;
    return guide && guide !== this.currentGuide ? guide : undefined;
  }

  get href(): string | undefined {
    return this.guide ? realmFile(`docs/guides/${this.guide}`) : undefined;
  }

  <template>
    {{#if this.href}}
      <a
        href={{this.href}}
        class='guide-link'
        data-demo-guide={{this.guide}}
        data-test-guide-link
        ...attributes
      >Read the guide <span aria-hidden='true'>→</span></a>
    {{/if}}
    <style scoped>
      .guide-link {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--copper-ink);
      }

      @media (hover: hover) {
        .guide-link:hover {
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
