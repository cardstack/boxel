import Component from '@glimmer/component';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { Site } from '../site-config';

export interface SiteNavbarSignature {
  Args: {
    site: Site;
    currentPageId: string | null;
  };
}

export class SiteNavbar extends Component<SiteNavbarSignature> {
  get sortedPages() {
    return (this.args.site.pages || []).slice().sort((a, b) => {
      let orderA = a.navOrder ?? 0;
      let orderB = b.navOrder ?? 0;
      return orderA - orderB;
    });
  }

  isActive(pageId: string | null | undefined) {
    return Boolean(pageId) && pageId === this.args.currentPageId;
  }

  <template>
    <nav class='site-navbar'>
      <div class='logo'>{{@site.siteTitle}}</div>

      <div class='nav-links'>
        {{#each this.sortedPages as |page|}}
          {{#if
            (if page.showInNav page.showInNav (eq page.showInNav undefined))
          }}
            <a
              href={{page.pageUrl}}
              class={{cn 'nav-link' active=(this.isActive page.pageId)}}
            >
              {{page.pageLabel}}
            </a>
          {{/if}}
        {{/each}}
      </div>

      <div class='nav-actions'>
        {{#if @site.ctaSecondaryText}}
          <a class='secondary' href={{@site.ctaSecondaryUrl}}>
            {{@site.ctaSecondaryText}}
          </a>
        {{/if}}
        {{#if @site.ctaPrimaryText}}
          <a class='primary' href={{@site.ctaPrimaryUrl}}>
            {{@site.ctaPrimaryText}}
          </a>
        {{/if}}
      </div>
    </nav>

    <style scoped>
      .site-navbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
        padding: 1rem 1.5rem;
        position: sticky;
        top: 0;
        backdrop-filter: blur(10px);
        background: color-mix(
          in srgb,
          var(--background, #fff) 75%,
          transparent
        );
        border-bottom: 1px solid var(--border, #e5e5e5);
        z-index: 1000;
      }

      .logo {
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .nav-links {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex: 1;
      }

      .nav-link {
        color: var(--muted-foreground, #666);
        text-decoration: none;
        padding: 0.5rem 0.75rem;
        border-radius: 999px;
        transition:
          color 150ms ease,
          background 150ms ease;
      }

      .nav-link:hover {
        color: var(--foreground, #111);
        background: var(--muted, #f6f6f6);
      }

      .nav-link.active {
        color: var(--foreground, #111);
        background: var(--brand-muted, rgba(0, 0, 0, 0.05));
        font-weight: 600;
      }

      .nav-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .nav-actions a {
        text-decoration: none;
        padding: 0.5rem 0.9rem;
        border-radius: 0.75rem;
        font-weight: 600;
        border: 1px solid var(--border, #e5e5e5);
      }

      .nav-actions .secondary {
        color: var(--foreground, #111);
        background: var(--card, #fff);
      }

      .nav-actions .primary {
        color: var(--card, #fff);
        background: var(--brand-primary, #111);
        border-color: var(--brand-primary, #111);
      }

      @media (max-width: 900px) {
        .site-navbar {
          flex-wrap: wrap;
        }

        .nav-links {
          order: 3;
          width: 100%;
          justify-content: flex-start;
          flex-wrap: wrap;
        }

        .nav-actions {
          order: 2;
          width: 100%;
          justify-content: flex-end;
        }
      }
    </style>
  </template>
}
