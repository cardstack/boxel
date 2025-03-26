import { schedule } from '@ember/runloop';

export function consumeContext(consume: () => void) {
  schedule('afterRender', consume);
}
