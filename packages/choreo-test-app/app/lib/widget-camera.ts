import type {
  Camera3DState,
  Camera3DWaypoint,
  Sprite,
} from '@cardstack/choreo';
import Changeset from '@cardstack/choreo/changeset';
import compile from '@cardstack/choreo/compile';
import { ChoreoRun } from '@cardstack/choreo/run';

import { bakeCameraChase } from './widget-camera-chase';

/** DOM host for the same Camera3D AST used by c.Camera3D. Choreo owns time. */
export function moveRoomCamera(
  host: HTMLElement,
  from: Camera3DState,
  to: Camera3DState,
  update: (pose: Camera3DState) => void,
  durationMs = 1450,
  through?: Camera3DWaypoint[],
  springPath = false
) {
  const node = {
    element: host,
    id: 'widget-camera',
    role: null,
    isPresent: true,
    layoutKey: 'widget-camera',
    release() {},
    exitComplete() {},
  };
  const sprite = {
    element: host,
    id: 'widget-camera',
    node,
    role: null,
    type: 'kept',
  } as Sprite;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chased = through && springPath && !reduced;
  const cameraPath = chased
    ? bakeCameraChase(from, through, durationMs)
    : through;
  const compiled = compile(
    [
      {
        kind: 'camera3d',
        of: { type: 'kept' },
        ...(reduced && through ? from : to),
        through: reduced ? undefined : cameraPath,
        tension: chased ? 0 : 0.6,
        settle: through && !chased ? 0.3 : undefined,
        ms: reduced && durationMs < 5000 ? 1 : durationMs,
        ease: through ? 'linear' : [0.4, 0, 0.2, 1],
      },
    ],
    new Changeset([], [], [sprite])
  );
  return new ChoreoRun(compiled, {
    camera3d: from,
    onCamera3D: update,
    onSpriteDone() {},
    removed: [],
  });
}
