import type { Join } from '@cardstack/choreo/film';
import { registerDestructor } from '@ember/destroyable';
import Component from '@glimmer/component';

/**
 * The message a page holding this document in a frame posts to play a join
 * over the film: `{ type: PREVIEW_JOIN, join }`. The gallery's `FilmLink`
 * sends it from the film's wall plate.
 */
export const PREVIEW_JOIN = 'choreo-film:preview-join';

/* every join the film can exhibit; a Record so a join added to the
   vocabulary is a type error here until it is listed */
const JOINS: Record<Join, true> = {
  blend: true,
  blur: true,
  cut: true,
  defocus: true,
  dip: true,
  flash: true,
  iris: true,
  luma: true,
  melt: true,
  sweep: true,
  whip: true,
  wipe: true,
};

function isJoin(value: unknown): value is Join {
  return typeof value === 'string' && Object.hasOwn(JOINS, value);
}

/**
 * The film's join previews, opened to the page that frames it. The wall
 * plate under a film lives in that page, outside this document, so its
 * triggers arrive as messages; each one plays through the film's own
 * `preview`. Only the framing page is heard. Renders nothing.
 */
export class JoinPreviews extends Component<{
  Args: { preview: (join: Join) => void };
}> {
  constructor(owner: unknown, args: { preview: (join: Join) => void }) {
    super(owner as never, args);
    const hear = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return;
      }
      const data = event.data as { join?: unknown; type?: unknown } | null;
      if (data?.type === PREVIEW_JOIN && isJoin(data.join)) {
        this.args.preview(data.join);
      }
    };
    window.addEventListener('message', hear);
    registerDestructor(this, () => window.removeEventListener('message', hear));
  }

  <template></template>
}
