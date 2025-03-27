import { next } from '@ember/runloop';
import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';

import { Spec } from 'https://cardstack.com/base/spec';

interface ModifierSignature {
  Args: {
    Named: {
      spec?: Spec;
      onSpecView?: (spec: Spec) => void;
    };
  };
}

export default class SpecPreviewModifier extends Modifier<ModifierSignature> {
  @service private declare playgroundPanelService: PlaygroundPanelService;

  modify(
    _element: HTMLElement,
    _positional: [],
    { spec, onSpecView }: ModifierSignature['Args']['Named'],
  ) {
    if (!spec || !onSpecView) {
      throw new Error('bug: no spec or onSpecView hook');
    }
    next(() => {
      onSpecView(spec);
    });
  }
}
