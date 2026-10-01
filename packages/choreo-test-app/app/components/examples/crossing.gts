import { CrossingStress } from 'test-app/components/crossing-stress';

/**
 * The crossing, as a tile.
 *
 * The stage itself is the `/crossing-stress` rig — the same component, asked
 * to behave like a guest. Nothing is forked: a second copy of a 460-line
 * scene is how the old `/crossing-reel` came to be a stale duplicate of
 * `slides`, and one `@embedded` flag is cheaper than that debt.
 *
 * What the tile is FOR: `c.Crossing` is the only step whose argument cannot
 * be made in a still. Two skins cross inside one flying box while a <video>
 * plays, a pane scrolls, and a mark spins — none of them participants, all
 * of them running through the pass. A view transition snapshots, and a
 * snapshot freezes; this does not, and you can only tell by watching.
 */
export const Crossing = <template>
  <div class="ex">
    <CrossingStress @embedded={{true}} />
  </div>
</template>;
