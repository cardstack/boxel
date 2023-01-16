import Component from '@glimmer/component';
import Modifier from 'ember-modifier';
import { getOwner } from '@ember/application';
import { renderMain, renderSync, inTransaction } from '@glimmer/runtime';
import { createConstRef } from '@glimmer/reference';
import{ track } from '@glimmer/validator';
import { getComponentTemplate } from '@ember/component';

import Sample from './sample';
import { tracked } from '@glimmer/tracking';

// this needs to be a template-only component because the way we're invoking it
// just grabs the template and would drop any associated class.
const root = <template><Sample /></template>

class DoTheRender extends Modifier {
  modify(element) {
    let { _runtime, _context, _owner, _builder } = getOwner(this).lookup('renderer:-dom');
    let self = createConstRef({}, 'this');
    let layout = getComponentTemplate(root)(_owner).asLayout();
    let iterator = renderMain(_runtime, _context, _owner, self, _builder(_runtime.env, { element }), layout);
    try {
      // Current findings: the default error handling resets *all* tracking
      // frames, which is too aggressive. If we avoid that reset, we still leave
      // some tracking frames around which is also bad. We need properly balanced
      // cleanup of tracking frames via finally blocks at each level in the stack.

      // Update 1/16: It looks like the unbalanced nature of the frames stems
      // from here:
      // https://github.com/glimmerjs/glimmer-vm/blob/5c0dd7b4514b7f5211f61be4eba2c5c0c237274d/packages/%40glimmer/runtime/lib/vm/append.ts#L388
      // Within the glimmer VM class there is a `beginCacheGroup` method that
      // pushes tracked frames without a finally to end the tracked frame.

      // this is the more public API
      // renderSync(_runtime.env, iterator);

      // this is a lower-level way to avoid the automatic catch and reset of
      // tracking state
      inTransaction(_runtime.env, () => iterator.vm._execute());
    } catch (err) {
      console.log(err);
    }
  }
}

export default class DoRender extends Component {
  <template>
    <div {{DoTheRender}}></div>
    {{this.counter}}
  </template>

  @tracked
  counter = 0;

  constructor(...args) {
    super(...args);
    setInterval(() => this.counter++, 1000);
  }
}