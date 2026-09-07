import Component from '@glimmer/component';
import { motion, scrollProgress } from 'glimmer-motion';
import { transformValue } from 'motion-dom';
import { tuneNumber } from 'test-app/lib/demo-tuning';

export class Parallax extends Component {
  scroll = scrollProgress();

  progress = () => this.scroll.scrollYProgress.get();

  back = {
    scale: transformValue(
      () =>
        1 + this.progress() * tuneNumber('parallax', 0.28, 'Background zoom')
    ),
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', -220, 'Background travel')
    ),
  };
  mid = {
    rotate: transformValue(
      () => this.progress() * tuneNumber('parallax', -12, 'Plate rotation')
    ),
    x: transformValue(
      () =>
        this.progress() * tuneNumber('parallax', 56, 'Plate horizontal travel')
    ),
    y: transformValue(
      () =>
        this.progress() * tuneNumber('parallax', -150, 'Plate vertical travel')
    ),
  };
  word = {
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', -110, 'Word travel')
    ),
  };
  type = {
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', -48, 'Heading travel')
    ),
  };
  card = {
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', 20, 'Card travel')
    ),
  };

  <template>
    <div class="ex">
      <div class="scroll-well" {{this.scroll.container}}>
        <div class="para-layer para-a" {{motion style=this.back}}></div>
        <div class="para-layer para-b" {{motion style=this.mid}}></div>
        <p class="para-word" {{motion style=this.word}}>DEPTH</p>
        <div class="scroll-pad para-pad">
          <p class="para-kicker" {{motion style=this.type}}>Issue 07</p>
          <h3 class="para-title" {{motion style=this.type}}>Depth from a single
            scroll value.</h3>
          <div class="para-card" {{motion style=this.card}}>
            <div class="story">
              <small>Three offsets. One progress.</small>
              <p>The wash leaves first. The plate holds. The type barely
                breathes.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
}
