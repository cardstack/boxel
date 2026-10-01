import type { TOC } from '@ember/component/template-only';
import { DialStore, mountControlRenderer } from 'dialkit/vanilla';
import { modifier } from 'ember-modifier';
import type { AnyDial } from 'test-app/lib/dial';

const mountControls = modifier((element: HTMLElement, [dial]: [AnyDial]) => {
  const props = () => ({
    panelId: dial.panelId,
    controls: DialStore.getPanel(dial.panelId)?.controls ?? [],
    values: DialStore.getValues(dial.panelId),
  });
  const controls = mountControlRenderer(element, props());
  const stop = DialStore.subscribe(dial.panelId, () =>
    controls.update(props())
  );
  return () => {
    stop();
    controls.destroy();
  };
});

<template>
  <div {{mountControls @dial}}></div>
</template> satisfies TOC<{ Args: { dial: AnyDial } }>;
