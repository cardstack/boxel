import Component from '@glimmer/component';
import { on } from '@ember/modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type { Site } from '../site-config';

export interface SiteNavbarSignature {
  Args: {
    site?: Site;
    currentPageId?: string | null;
    toggleMode?: () => void;
  };
}

// TODO: add dropdown nav
export class SiteNavbar extends Component<SiteNavbarSignature> {
  private get sortedNavPages() {
    return this.args.site?.pages
      ?.filter((p) => p.showInNav)
      ?.sort((a, b) => {
        let orderA = a.navOrder ?? 0;
        let orderB = b.navOrder ?? 0;
        return orderA - orderB;
      });
  }

  <template>
    <nav class='site-navbar'>
      <div class='logo'>{{@site.siteTitle}}</div>

      <div class='nav-links'>
        {{#each this.sortedNavPages as |page|}}
          <a
            href={{page.pageUrl}}
            class={{cn 'nav-link' is-active=(eq page.pageId @currentPageId)}}
          >
            {{page.pageLabel}}
          </a>
        {{/each}}
      </div>

      <div class='nav-actions'>
        {{#if @toggleMode}}
          <button
            class='dark-mode-toggle'
            id='darkModeToggle'
            aria-label='Toggle dark mode'
            {{on 'click' @toggleMode}}
          >
            <svg
              class='icon-sun'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='5'></circle>
              <path
                d='M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42'
              ></path>
            </svg>
            <svg class='icon-moon' viewBox='0 0 24 24' fill='currentColor'>
              <path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'></path>
            </svg>
          </button>
        {{/if}}

        {{#if @site.ctaSecondaryText}}
          <Button
            class='site-navbar-cta-secondary'
            @as='anchor'
            @href={{@site.ctaSecondaryUrl}}
            @kind='muted'
            @size='small'
          >{{@site.ctaSecondaryText}}</Button>
        {{/if}}
        {{#if @site.ctaPrimaryText}}
          <Button
            class='site-navbar-cta-primary'
            @as='anchor'
            @href={{@site.ctaPrimaryUrl}}
            @kind='primary'
            @size='small'
          >{{@site.ctaPrimaryText}}</Button>
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

      .dark-mode-toggle {
        width: 44px;
        height: 24px;
        background: var(--border-light);
        border-radius: 100px;
        position: relative;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        border: none;
        padding: 0;
      }
      .dark-mode-toggle::before {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }
      .dark-mode-toggle svg {
        fill: var(--boxel-slate);
      }
      .dark-mode-toggle .icon-sun,
      .dark-mode-toggle .icon-moon {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 12px;
        height: 12px;
        transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .dark-mode-toggle .icon-sun {
        left: 6px;
        opacity: 1;
      }
      .dark-mode-toggle .icon-moon {
        right: 6px;
        opacity: 0.4;
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

      .nav-link.is-active {
        color: var(--foreground, #111);
        background: var(--brand-muted, rgba(0, 0, 0, 0.05));
        font-weight: 600;
      }

      .nav-actions {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
      }
      .site-navbar-cta-primary {
        transition:
          color var(--boxel-transition),
          background-color var(--boxel-transition),
          transform var(--boxel-transition),
          opacity var(--boxel-transition);
      }
      .site-navbar-cta-primary:hover {
        background-color: var(--accent);
        color: var(--accent-foreground);
        opacity: 0.9;
        transform: translateY(-2px);
      }
      .site-navbar-cta-secondary {
        transition: color var(--boxel-transition);
      }
      .site-navbar-cta-secondary:hover {
        color: var(--secondary);
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
