import type { TOC } from '@ember/component/template-only';
import { modifier } from 'ember-modifier';
import type { DemoEntry } from 'test-app/lib/catalog';
import { restWhenOff } from 'test-app/lib/onstage';
import { forceDarkTheme } from 'test-app/lib/theme';
const embed = modifier(() => {
  const releaseTheme = forceDarkTheme();
  document.body.classList.add('widget-embedded');
  return () => {
    document.body.classList.remove('widget-embedded');
    releaseTheme();
  };
});
<template>
  <style>
    body.widget-embedded {
      margin: 0;
      overflow: hidden;
    }
    .widget-embedded .topbar,
    .widget-embedded .footer {
      display: none;
    }
    .widget-embedded .app-shell,
    .widget-embedded .page-shell,
    .widget-embedded .page {
      padding: 0 !important;
      margin: 0 !important;
      max-width: none !important;
      min-height: 0 !important;
    }
    .widget-embed {
      width: 100vw;
      height: 100vh;
      overflow: auto;
      display: grid;
      align-items: center;
      background: var(--bg, #151616);
    }
    .widget-embed > * {
      width: 100%;
    }
  </style>
  <div class="widget-embed" data-test-widget-embed {{embed}} {{restWhenOff}}>
    {{#if @model}}{{#let @model.Example as |Example|}}<Example />{{/let}}{{/if}}
  </div>
</template> satisfies TOC<{ Args: { model?: DemoEntry } }>;
