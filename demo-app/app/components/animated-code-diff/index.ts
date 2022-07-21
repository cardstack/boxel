import Component from '@glimmer/component';
// import { wait } from 'ember-animated';
// import move from 'ember-animated/motions/move';
// import { fadeIn, fadeOut } from 'ember-animated/motions/opacity';
import { highlightCode } from '../../utils/compile-markdown';
import { htmlSafe } from '@ember/template';
import { action } from '@ember/object';
import { Changeset } from 'animations-experiment/models/changeset';

interface AnimatedCodeDiffArgs {
  isShowingFinal: boolean;
  diff: string;
  label: string;
}

class LineObject {
  id: string | undefined;
  index: number;
  text: string;
  highlighted = false;

  constructor(index: number, text: string) {
    this.index = index;
    this.text = text;
  }
}

export default class AnimatedCodeDiff extends Component<AnimatedCodeDiffArgs> {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onAnimationChange(): void {}

  get originalLines(): LineObject[] {
    let lineObjects = getLineObjectsFromDiff(this.args.diff, 'before');
    let language = this.args.label.substr(this.args.label.lastIndexOf('.') + 1);
    return highlightLineObjects(lineObjects, language);
  }
  get finalLines(): LineObject[] {
    let lineObjects = getLineObjectsFromDiff(this.args.diff, 'after');
    let language = this.args.label.substr(this.args.label.lastIndexOf('.') + 1);
    return highlightLineObjects(lineObjects, language);
  }

  get activeLines(): LineObject[] {
    return this.args.isShowingFinal ? this.finalLines : this.originalLines;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  // eslint-disable-next-line no-empty-pattern
  @action async codeTransition({}: // insertedSprites,
  // removedSprites,
  // keptSprites,
  Changeset): Promise<void> {
    // this.incrementProperty('transitionsRunning');
    // this.set('isAnimatingInsertedLines', false);
    // if (this.isShowingFinal) {
    //   removedSprites.forEach(fadeOut);
    //   // Need to set inserted sprites to 0 opacity in case their animation is interrupted
    //   insertedSprites.forEach((sprite) => {
    //     sprite.applyStyles({
    //       opacity: '0',
    //     });
    //   });
    //   keptSprites.map((sprite) => {
    //     fadeIn(sprite);
    //     move(sprite);
    //   });
    //   await wait(duration);
    //   while (this.animationPaused) {
    //     await wait(100);
    //   }
    //   // this.set('isAnimatingInsertedLines', true);
    //   this.onAnimationChange(true);
    //   for (let sprite of insertedSprites) {
    //     sprite.moveToFinalPosition();
    //     sprite.applyStyles({
    //       overflow: 'hidden',
    //       opacity: '1',
    //       display: 'inline-block',
    //       width: 'auto',
    //     });
    //     let totalWidth = sprite.element.getBoundingClientRect().width;
    //     let chars = sprite.element.textContent;
    //     let characterWidth = totalWidth / chars.length;
    //     sprite.reveal();
    //     for (let i = 0; i < chars.length; i++) {
    //       sprite.applyStyles({
    //         width: `${characterWidth * (i + 1)}`,
    //       });
    //       if (chars[i] !== ' ') {
    //         await wait(15);
    //       }
    //     }
    //   }
    //   // this.set('isAnimatingInsertedLines', false);
    //   this.onAnimationChange(false);
    // } else {
    //   removedSprites.forEach(fadeOut);
    //   keptSprites.map((sprite) => {
    //     fadeIn(sprite);
    //     move(sprite);
    //   });
    //   insertedSprites.forEach(fadeIn);
    // }
    // this.decrementProperty('transitionsRunning');
  }
}

function highlightLineObjects(lineObjects: LineObject[], language: string) {
  let code = lineObjects.map((lineObject) => lineObject.text).join('\n');
  let highlightedCode = highlightCode(code, language);

  return highlightedCode.split('\n').map((text: string, index: number) => ({
    id: lineObjects[index]?.id,
    highlighted: lineObjects[index]?.highlighted,
    // htmlSafe is justified here because we generated the highlighting markup
    // ourself in highlightCode
    text: htmlSafe(text === '' ? '\n' : text),
  }));
}

function getLineObjectsFromDiff(
  diff: string,
  beforeOrAfter: string
): LineObject[] {
  let diffLines = diff.split('\n');
  let lineObjects = diffLines.map((diff, index) => {
    return new LineObject(index, diff);
  });

  let { keptLines, addedLines, removedLines } = groupedLines(lineObjects);
  let lines;

  if (beforeOrAfter === 'before') {
    lines = keptLines.concat(removedLines).sort((a, b) => a.index - b.index);
  } else if (beforeOrAfter === 'after') {
    lines = keptLines.concat(addedLines).sort((a, b) => a.index - b.index);
  }

  return lines || [];
}

class LineChangeset {
  keptLines: LineObject[] = [];
  removedLines: LineObject[] = [];
  addedLines: LineObject[] = [];
}

function groupedLines(lineObjects: LineObject[]): LineChangeset {
  let isAddedLine = (lineObject: LineObject) =>
    lineObject.text.indexOf('+') === 0;
  let isRemovedLine = (lineObject: LineObject) =>
    lineObject.text.indexOf('-') === 0;
  let isModifiedLine = (lineObject: LineObject) =>
    isAddedLine(lineObject) || isRemovedLine(lineObject);
  let hasAddedOrRemovedLines = lineObjects.filter(isModifiedLine).length > 0;

  return lineObjects
    .map((lineObject, index) => {
      if (isAddedLine(lineObject)) {
        lineObject.id = `added-${index}`;
        lineObject.text = lineObject.text.replace('+', ' ');
        lineObject.highlighted = true;
      } else if (isRemovedLine(lineObject)) {
        lineObject.id = `removed-${index}`;
        lineObject.text = lineObject.text.replace('-', ' ');
        // .replace(/^\s\s/, ""); // remove the 2-space indent
      } else {
        lineObject.id = `kept-${index}`;
      }

      return lineObject;
    })
    .map((lineObject) => {
      /*
      If we have either addded or removed lines, all text has a 2-space indent
      right now, so we remove it.

      If we don't, we don't need to dedent anything, because all space was
      dedented by the `dedent` function when the diff was originally passed in.
    */
      if (hasAddedOrRemovedLines) {
        lineObject.text = lineObject.text.replace(/^\s\s/, '');
      }

      return lineObject;
    })
    .reduce((groupedLines, lineObject) => {
      let type = lineObject.id ? lineObject.id.split('-')[0] : 'unknown';
      switch (type) {
        case 'kept':
          groupedLines.keptLines.push(lineObject);
          break;
        case 'removed':
          groupedLines.removedLines.push(lineObject);
          break;
        case 'added':
          groupedLines.addedLines.push(lineObject);
          break;
      }
      return groupedLines;
    }, new LineChangeset());
}
