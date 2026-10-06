import type { Camera3DState } from '@cardstack/choreo';

import score from './widget-quick-score.json';

export { score as quickScore };
type Tile = {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
  yaw: number;
  z: number;
};
/** Regular samples let Choreo's single spline keep velocity through every beat. */
export function quickCameraPath(
  tiles: Tile[],
  from: Camera3DState,
  width: number,
  height: number
) {
  const focal = height / (2 * Math.tan((24 * Math.PI) / 180));
  const anchors = [
    { at: 0, pose: from },
    ...score.actions.map((action, index) => {
      const tile = tiles.find((tile) => tile.id === action.demo)!;
      const scale = Math.min(
        0.62,
        width / (tile.width + 500),
        (height - 300) / (tile.height + 200)
      );
      return {
        at: action.at,
        pose: {
          look: {
            x: tile.x,
            y: tile.y - 55 / Math.max(0.15, scale),
            z: tile.z,
          },
          dolly: focal / Math.max(0.15, scale) / 5600,
          yaw: tile.yaw + Math.sin(index * 1.3) * 4,
          pitch: 1.5 + Math.cos(index) * 1.5,
          x: 0,
          y: 0,
        },
      };
    }),
  ];
  const last = anchors[anchors.length - 1]!.pose;
  anchors.push({
    at: score.duration,
    pose: { ...last, dolly: last.dolly * 1.15, yaw: last.yaw + 5 },
  });
  const count = Math.ceil(score.duration * 4);
  return Array.from({ length: count }, (_, index) => {
    const at = ((index + 1) / count) * score.duration;
    const right = anchors.findIndex((anchor) => anchor.at >= at);
    const b = anchors[right < 0 ? anchors.length - 1 : right]!;
    const a =
      anchors[Math.max(0, (right < 0 ? anchors.length - 1 : right) - 1)]!;
    const t = Math.min(
      1,
      Math.max(0, (at - a.at) / Math.max(0.001, b.at - a.at))
    );
    const mix = (a: number, b: number) => a + (b - a) * t;
    return {
      dolly: mix(a.pose.dolly, b.pose.dolly),
      yaw: mix(a.pose.yaw, b.pose.yaw),
      pitch: mix(a.pose.pitch, b.pose.pitch),
      x: 0,
      y: 0,
      look: {
        x: mix(a.pose.look!.x, b.pose.look!.x),
        y: mix(a.pose.look!.y, b.pose.look!.y),
        z: mix(a.pose.look!.z, b.pose.look!.z),
      },
    };
  });
}
