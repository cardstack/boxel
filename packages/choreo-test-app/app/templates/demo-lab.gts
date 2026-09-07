import type { TOC } from '@ember/component/template-only';
import { LinkTo } from '@ember/routing';
import { modifier } from 'ember-modifier';
import { pageTitle } from 'ember-page-title';
import { DemoWorkbench } from 'test-app/components/demo-workbench';
import type { DemoEntry } from 'test-app/lib/catalog';

const embedded = modifier((_element: HTMLElement, [on]: [boolean]) => {
  document.body.classList.toggle('guide-demo-embedded', on);
  return () => document.body.classList.remove('guide-demo-embedded');
});

<template>
  {{pageTitle "Playground"}}
  <div class="demo-lab" {{embedded @controller.embedded}}>
    {{#if @model}}
      {{#unless @controller.embedded}}<p class="guide-eyebrow">CHOREO / LIVE
          PLAYGROUND</p><h1>{{@model.title}}</h1><p
          class="guide-deck"
        >{{@model.lede}}</p><p><LinkTo @route="index">← All demos</LinkTo>
          ·
          <LinkTo @route="docs.index">Guides</LinkTo></p>{{/unless}}
      <DemoWorkbench @demo={{@model}} @embedded={{@controller.embedded}} />
    {{/if}}
  </div>
</template> satisfies TOC<{
  Args: { controller: { embedded: boolean }; model?: DemoEntry };
}>;
