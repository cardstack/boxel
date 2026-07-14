import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

// 🧩 PATTERN: CSS-only 3D flip primitive.
//
// One @tracked boolean drives a class toggle; CSS does the rest:
//   - `.flip-container { perspective: 1200px; }` puts the camera
//   - `.flip-inner   { transform-style: preserve-3d; }` keeps the
//      two faces in 3D space relative to each other
//   - `.face         { backface-visibility: hidden; }` hides the
//      reverse side of each face during the rotation
//   - the back face starts pre-rotated by 180deg; flipping the
//      whole inner element by 180deg brings the back into view
//
// No animation logic on the JS side. No timers, no requestAnimationFrame.

export class Flashcard extends CardDef {
  static displayName = 'Flashcard';

  @field front = contains(StringField);
  @field back = contains(StringField);

  static isolated = class Isolated extends Component<typeof Flashcard> {
    @tracked isFlipped = false;

    flip = () => {
      this.isFlipped = !this.isFlipped;
    };

    <template>
      <div class='flashcard'>
        <div
          class='flip-container {{if this.isFlipped "is-flipped"}}'
          role='button'
          tabindex='0'
          {{on 'click' this.flip}}
          {{on 'keydown' this.flip}}
        >
          <div class='flip-inner'>
            <div class='face front'>
              <p>{{if @model.front @model.front 'Front'}}</p>
            </div>
            <div class='face back'>
              <p>{{if @model.back @model.back 'Back'}}</p>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .flashcard {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }

        .flip-container {
          width: 100%;
          max-width: 32rem;
          min-height: 20rem;
          /* Camera distance — smaller = more dramatic perspective. */
          perspective: 1200px;
          cursor: pointer;
          outline: none;
        }

        .flip-inner {
          position: relative;
          width: 100%;
          min-height: 20rem;
          /* Children render in 3D space rather than flattened. */
          transform-style: preserve-3d;
          transition: transform 0.55s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .is-flipped .flip-inner {
          transform: rotateY(180deg);
        }

        .face {
          position: absolute;
          inset: 0;
          min-height: 20rem;
          /* Hide the reverse side of each face during the rotation. */
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          box-sizing: border-box;
          border-radius: var(--radius, 1rem);
          background: var(--card, white);
          color: var(--card-foreground, currentColor);
          box-shadow: var(--shadow-md, 0 4px 16px rgba(0, 0, 0, 0.1));
        }

        /* The back is pre-rotated so it sits behind the front in
           3D space. When the inner rotates 180deg, the back lands
           facing the camera. */
        .back {
          transform: rotateY(180deg);
          background: var(--secondary, #f5f5f5);
        }
      </style>
    </template>
  };
}

// --- Gotchas ---
//
// - `transform-style: preserve-3d` does NOT inherit. Every layer
//   between the perspective ancestor and the rotated element must
//   declare it, or children flatten to 2D.
//
// - Without `backface-visibility: hidden` you see mirrored text
//   bleeding through the front face mid-rotation.
//
// - The back face needs to be pre-rotated 180deg so when the
//   container rotates, it lands facing the camera. Forgetting this
//   produces a "flip to a blank wall" effect.
//
// - Pointer / keyboard parity — make the container `role='button'`
//   + `tabindex='0'` + listen for both `click` and `keydown` so the
//   card is accessible.
