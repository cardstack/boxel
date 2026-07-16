// Minimal page CardDef for the host-mode routing pattern.
//
// The interesting part of this pattern lives in realm.json (see the
// README for the annotated shape), not in any individual .gts file —
// page cards are just normal CardDefs that happen to be referenced
// from a hostRoutingRules entry. Most page cards want
// `prefersWideFormat = true` (so they get the full viewport on a
// published realm) and a brand-driven cardTheme (see
// theme-first-workflow). Nothing else is required for routing.
//
// realm.json shape (lives at the realm root, not next to this card):
//
// {
//   "data": {
//     "type": "card",
//     "attributes": {
//       "cardInfo": { "name": "My App Realm" },
//       "hostRoutingRules": [
//         { "path": "/" },
//         { "path": "/about" },
//         { "path": "/pricing" }
//       ]
//     },
//     "relationships": {
//       "hostRoutingRules.0.instance": { "links": { "self": "./HomePage/index" } },
//       "hostRoutingRules.1.instance": { "links": { "self": "./HomePage/about" } },
//       "hostRoutingRules.2.instance": { "links": { "self": "./HomePage/pricing" } }
//     },
//     "meta": {
//       "adoptsFrom": {
//         "module": "https://cardstack.com/base/realm-config",
//         "name": "RealmConfig"
//       }
//     }
//   }
// }

import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import LayoutPageIcon from '@cardstack/boxel-icons/layout-dashboard';

export class HomePage extends CardDef {
  static displayName = 'Home Page';
  static icon = LayoutPageIcon;

  // prefersWideFormat = true lets a published realm hand the page
  // the full viewport without the operator-mode chrome.
  static prefersWideFormat = true;

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field body = contains(MarkdownField);

  // Optional nav-bar list of (label, path) pairs. The paths line up
  // with the realm.json hostRoutingRules so the nav links are clean
  // external URLs.
  @field navLinks = contains(StringField, {
    description:
      'JSON-encoded array of {label, path} for the top nav, e.g. [{"label":"About","path":"/about"}]',
  });

  static isolated = class Isolated extends Component<typeof this> {
    get navItems(): Array<{ label: string; path: string }> {
      let raw = this.args.model.navLinks?.trim();
      if (!raw) return [];
      try {
        let parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    <template>
      <article class='page'>
        <header class='page-header'>
          <nav class='nav'>
            {{#each this.navItems as |item|}}
              {{! Clean external URLs — these match the realm.json
                  routing rules and the realm-server rewrites them
                  to the right cards on each request. }}
              <a href={{item.path}}>{{item.label}}</a>
            {{/each}}
          </nav>
          <h1>{{@model.headline}}</h1>
          {{#if @model.subheadline}}
            <p class='subhead'>{{@model.subheadline}}</p>
          {{/if}}
        </header>

        <section class='page-body'>
          <@fields.body />
        </section>
      </article>

      <style scoped>
        .page {
          max-width: 64rem;
          margin: 0 auto;
          padding: var(--boxel-sp-xl) var(--boxel-sp-lg);
          background: var(--background, white);
          color: var(--foreground, #111);
        }
        .page-header {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          margin-bottom: var(--boxel-sp-xxl);
        }
        .nav {
          display: flex;
          gap: var(--boxel-sp-lg);
        }
        .nav a {
          color: var(--primary, currentColor);
          text-decoration: none;
          font-weight: 600;
        }
        .nav a:hover {
          text-decoration: underline;
        }
        h1 {
          margin: 0;
          font-size: clamp(2rem, 4vw, 3.5rem);
          letter-spacing: -0.02em;
        }
        .subhead {
          margin: 0;
          color: var(--muted-foreground, #555);
          font-size: 1.125rem;
        }
        .page-body :deep(*) {
          line-height: 1.7;
        }
      </style>
    </template>
  };
}
