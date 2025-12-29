import Component from '@glimmer/component';

import { Button, Switch } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import Sun from '@cardstack/boxel-icons/sun';
import Moon from '@cardstack/boxel-icons/moon';

import setBackgroundImage from 'https://cardstack.com/base/helpers/set-background-image';

import type { Site } from '../site-config';

export interface SiteNavbarSignature {
  Args: {
    site?: Site;
    currentPageId?: string | null;
    logoUrl?: string | null;
    toggleMode?: () => void;
    isDarkMode?: boolean;
  };
  Element: HTMLElement;
}

interface ModeToggleSignature {
  Args: {
    onToggle?: () => void;
    isDarkMode?: boolean;
  };
  Element: HTMLElement;
}

export class ModeToggle extends Component<ModeToggleSignature> {
  <template>
    <div
      class='switch-container {{if @isDarkMode "switch-dark" "switch-light"}}'
      ...attributes
    >
      <Switch
        class='switch-toggle'
        @onChange={{@onToggle}}
        @isEnabled={{@isDarkMode}}
      />
      <Sun
        class='mode-icon light-mode-icon'
        width='14'
        height='14'
        role='presentation'
      />
      <Moon
        class='mode-icon dark-mode-icon'
        width='14'
        height='14'
        role='presentation'
      />
    </div>
    <style scoped>
      .switch-container {
        --icon-size: 1.375rem;
        position: relative;
        display: flex;
        align-items: center;
        width: calc(var(--icon-size) * 2);
        height: var(--icon-size);
      }
      .mode-icon {
        position: absolute;
        top: 0;
        width: var(--icon-size);
        height: var(--icon-size);
        padding: 0.25rem;
        pointer-events: none;
      }
      .light-mode-icon {
        left: 0;
      }
      .dark-mode-icon {
        right: 0;
      }
      .switch-dark .light-mode-icon,
      .switch-light .dark-mode-icon {
        color: var(--muted-foreground);
        opacity: 0.8;
      }
      .switch-toggle {
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: color-mix(
          in oklab,
          var(--muted-foreground) 20%,
          transparent
        );
        padding: 0;
        transition: none;
      }
      .switch-toggle :deep(.switch-input) {
        background: var(--background);
        box-shadow: var(--mode-toggle-highlight);
      }
    </style>
  </template>
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
    <nav class='site-navbar' ...attributes>
      {{#if @logoUrl.length}}
        <div class='logo' style={{setBackgroundImage @logoUrl}} />
      {{/if}}

      <div class='nav-links'>
        {{#each this.sortedNavPages as |page|}}
          <Button
            @as='anchor'
            @href={{page.pageUrl}}
            @kind='muted'
            @size='small'
            class={{cn 'nav-link' is-active=(eq page.pageId @currentPageId)}}
          >
            {{page.pageLabel}}
          </Button>
        {{/each}}
      </div>

      <div class='nav-actions'>
        {{#if @toggleMode}}
          <ModeToggle @onToggle={{@toggleMode}} @isDarkMode={{@isDarkMode}} />
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
        min-width: 32rem;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs) var(--boxel-sp);
        max-width: 100%;
        background: var(--toolbar-bg);
        color: var(--foreground);
        backdrop-filter: blur(24px) saturate(200%);
        -webkit-backdrop-filter: blur(24px) saturate(200%);
        border: 1px solid var(--toolbar-border);
        border-radius: 100px;
        padding: 0.75rem 3rem;
        white-space: nowrap;
        box-shadow: var(--toolbar-box-shadow);
        overflow: hidden;
      }
      .nav-links {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp);
        flex: 1;
      }
      .nav-actions {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        margin-left: auto;
        padding-left: 1.5rem;
        border-left: 1px solid var(--border);
      }

      .logo {
        flex-shrink: 0;
        width: 9rem;
        height: 2.75rem;
        min-height: var(--brand-primary-mark-min-height);
        background-size: contain;
        background-repeat: no-repeat;
      }

      .nav-link {
        min-width: unset;
        padding: var(--boxel-sp-4xs);
        background: none;
        font-weight: 500;
      }
      .nav-link:hover {
        color: var(--foreground);
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
        background: none;
        transition: color var(--boxel-transition);
      }
      .site-navbar-cta-secondary:hover {
        color: var(--secondary);
      }

      @container navbar (inline-size <= 900px) {
        .site-navbar {
          flex-wrap: wrap;
        }
        .nav-links {
          order: 3;
          width: 100%;
          justify-content: flex-start;
        }
        .nav-actions {
          order: 2;
          justify-content: flex-end;
        }
      }
    </style>
  </template>
}
