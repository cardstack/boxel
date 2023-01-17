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


      // UPDATE 1/16 (Hassan): It looks like the unbalanced nature of the frames could
      // possibly stem from here:
      // https://github.com/glimmerjs/glimmer-vm/blob/5c0dd7b4514b7f5211f61be4eba2c5c0c237274d/packages/%40glimmer/runtime/lib/vm/append.ts#L388
      // Within the glimmer VM class there is a `beginCacheGroup` method that
      // pushes tracked frames without a finally to end the tracked frame. However,
      // it looks like all the frames are actually balanced in terms of adding and
      // removing as I debug this. Looking more closely at the error that we see in this case:
      //
      //   index.js:155 Uncaught Error: Assertion Failed: You attempted to update `counter` 
      //   on `DoRender`, but it had already been used previously in the same computation.  
      //   Attempting to update a value after using it in a computation can cause logical 
      //   errors, infinite revalidation bugs, and performance issues, and is not supported.
      //
      // Perhaps the issue is a little more subtle? Looking more carefully at this scenario
      // it explodes because the 'counter' tag in our control case below was already consumed
      // in this render and we trying to set it again. The validator actually uses a module
      // scoped WeakMap called CONSUMED_TAGS, with the tag impl as the key, to detect
      // consumption. so i'm not sure this is directly a stack balancing issue since a stack
      // is not going to change the presence of an object in the CONSUMED_TAGS weak map
      // (although maybe stack balancing does subtly effect this?--it's just not as cut and
      // dry as we first thought). CONSUMED_TAGS.set() is called when reading 'this.counter'
      // in the setInterval() callback to mark it as being consumed. The setter for
      // 'this.counter' is then called as part of the increment in the same setInterval
      // callback(), which requires that the tag not be consumed in the same render. When
      // there is no error thrown, the tag impl for counter in the getter is different than
      // in the setter. When there is an error thrown, its because the tag impl for the setter
      // and the getter of 'counter' is the same. so the next part of hunting down why this
      // error happens is to dive into when/how the tag impls are instantiated to nail down
      // why the instantiation of the 'counter' tag differs when the inner render blows up
      // vs it not blowing up.


      // UPDATE 1/17 (Hassan) OK, I think I have a handle on this. In the finally's that we
      // desire where there is a endTrackFrame(), within endTrackFrame() the CONSUMED_TAGS is
      // reset to null. When our error is thrown, the problem is not that the stack is 
      // unbalanced, the problem is that the CONSUMED_TAGS which would have otherwise been
      // reset by calling endTrackFrame() in a finally block is never being reset. This results
      // in tags being considered as consumed when in fact they are not, and hence the error
      // message about updating a tracked property when it has already been consumed because 
      // it was never able to reset the CONSUMED_TAGS as part of dealing with the error.


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