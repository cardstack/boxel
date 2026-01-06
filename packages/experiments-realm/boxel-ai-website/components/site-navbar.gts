import Component from '@glimmer/component';

import { Button, Switch } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import Sun from '@cardstack/boxel-icons/sun';
import Moon from '@cardstack/boxel-icons/moon';

import setBackgroundImage from 'https://cardstack.com/base/helpers/set-background-image';

import type { Site } from '../site-config';

import { Cta } from './cta';

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
        --mode-toggle-highlight: 0 1px 3px rgba(0, 0, 0, 0.2);

        position: relative;
        display: flex;
        align-items: center;
        width: calc(var(--icon-size) * 2);
        height: var(--icon-size);
      }
      .switch-dark {
        --mode-toggle-highlight: 0 1px 3px rgba(255, 255, 255, 0.2);
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
    <nav class={{cn 'site-navbar' site-navbar--dark=@isDarkMode}} ...attributes>
      {{#if @logoUrl.length}}
        <div class='logo' style={{setBackgroundImage @logoUrl}} />
      {{/if}}

      {{#if this.sortedNavPages.length}}
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
      {{/if}}

      <div class='nav-actions'>
        {{#if @toggleMode}}
          <ModeToggle @onToggle={{@toggleMode}} @isDarkMode={{@isDarkMode}} />
        {{/if}}

        {{#if @site.ctaSecondaryText}}
          <Cta
            @href={{@site.ctaSecondaryUrl}}
            @size='small'
          >{{@site.ctaSecondaryText}}</Cta>
        {{/if}}
        {{#if @site.ctaPrimaryText}}
          <Cta
            @href={{@site.ctaPrimaryUrl}}
            @variant='primary'
            @size='small'
          >{{@site.ctaPrimaryText}}</Cta>
        {{/if}}

      </div>
    </nav>

    <style scoped>
      .site-navbar {
        --nav-bg: rgba(255, 255, 255, 0.4);
        --nav-border: rgba(255, 255, 255, 0.6);
        --nav-box-shadow:
          0 8px 32px rgba(102, 56, 255, 0.12), 0 4px 16px rgba(0, 0, 0, 0.04),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);

        max-width: 100%;
        display: flex;
        align-items: center;
        gap: 0.5rem 2rem;
        background: var(--nav-bg);
        color: var(--foreground);
        backdrop-filter: blur(24px) saturate(200%);
        -webkit-backdrop-filter: blur(24px) saturate(200%);
        border: 1px solid var(--nav-border);
        border-radius: 100px;
        padding: 0.75rem 3rem;
        white-space: nowrap;
        box-shadow: var(--nav-box-shadow);
        overflow: hidden;
      }
      .site-navbar--dark {
        --nav-bg: rgba(50, 45, 60, 0.85);
        --nav-border: rgba(100, 95, 115, 0.4);
        --nav-box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }
      .nav-links {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        flex: 1;
      }
      .nav-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-left: auto;
        padding-left: 1.5rem;
        border-left: 1px solid var(--border);
      }

      .logo {
        flex-shrink: 0;
        width: var(--nav-logo-width, 9rem);
        height: var(--nav-logo-height, 2.75rem);
        min-height: var(--brand-primary-mark-min-height);
        background-size: contain;
        background-repeat: no-repeat;
      }

      .nav-link {
        min-width: unset;
        padding: 0.25rem 0.5rem;
        background: none;
        font-weight: 500;
      }
      .nav-link:hover {
        color: var(--foreground);
      }

      @container navbar (inline-size <= 800px) {
        .site-navbar {
          --nav-logo-height: 1.75rem;
          padding-inline: 1rem;
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
