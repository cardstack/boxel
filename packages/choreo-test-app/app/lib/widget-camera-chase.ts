import type { Camera3DState, Camera3DWaypoint } from 'glimmer-motion';
import { sampleThrough } from 'glimmer-motion/choreo/path';

/** Sylva's two-stage chase, baked once so film seeks never depend on history. */
export function bakeCameraChase(
  from: Camera3DState,
  through: Camera3DWaypoint[],
  durationMs: number
): Camera3DWaypoint[] {
  const frames = Math.ceil((durationMs / 1000) * 60);
  const steps = frames * 4;
  const dt = durationMs / 1000 / steps;
  const keys = [
    'dolly',
    'pitch',
    'x',
    'y',
    'yaw',
    'lookX',
    'lookY',
    'lookZ',
  ] as const;
  const values = (pose: Camera3DState) => [
    pose.dolly ?? 1,
    pose.pitch ?? 0,
    pose.x ?? 0,
    pose.y ?? 0,
    pose.yaw ?? 0,
    pose.look?.x ?? 0,
    pose.look?.y ?? 0,
    pose.look?.z ?? 0,
  ];
  const mid = values(from),
    lens = values(from);
  const midVelocity = keys.map(() => 0),
    velocity = keys.map(() => 0);
  const path: Camera3DWaypoint[] = [];
  for (let step = 1; step <= steps; step++) {
    const goal = values(sampleThrough(from, through, step / steps, 0.6));
    for (let axis = 0; axis < keys.length; axis++) {
      // The same faster framing / slower aim constants as Sylva.
      const w1 = axis < 5 ? 20 : 7,
        w2 = axis < 5 ? 13 : 4.5;
      midVelocity[axis]! +=
        (w1 * w1 * (goal[axis]! - mid[axis]!) - 2 * w1 * midVelocity[axis]!) *
        dt;
      mid[axis]! += midVelocity[axis]! * dt;
      velocity[axis]! +=
        (w2 * w2 * (mid[axis]! - lens[axis]!) - 2 * w2 * velocity[axis]!) * dt;
      lens[axis]! += velocity[axis]! * dt;
    }
    if (step % 4 === 0) {
      path.push({
        dolly: lens[0],
        pitch: lens[1],
        x: lens[2],
        y: lens[3],
        yaw: lens[4],
        look: { x: lens[5]!, y: lens[6]!, z: lens[7]! },
      });
    }
  }
  return path;
}
