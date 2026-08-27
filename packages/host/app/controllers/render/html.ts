import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

// Query params for the render.html sub-route. `envelopeWidth`/`envelopeHeight`
// (CSS px) let a screenshot capture ask for a fixed-size parent box around the
// card — required by the fitted format, which lays out inside a
// parent-owned box rather than filling the viewport. Declared here (not just in
// the route's `queryParams` hash) so Ember registers them; the route pairs each
// with `refreshModel: true` so a batch capture can re-transition to a new
// envelope on the same hydrated card and re-render into the new box.
export default class RenderHtmlController extends Controller {
  queryParams = ['envelopeWidth', 'envelopeHeight'];
  @tracked envelopeWidth: string | null = null;
  @tracked envelopeHeight: string | null = null;
}
