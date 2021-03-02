import Controller from '@ember/controller';
const PIA_MIDINA_PROFILE_IMG = '/images/Pia-Midina.jpg';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

const FADE_DURATION = 500;
const TRANSLATE_DURATION = 1000;

class Participant {
  @tracked isIsolated = false;
  id;
  type;
  title;
  description;
  imgURL;
  organization;
  ipi;
  pro;
  email;
  website;
  number_of_recordings;
  phone;
  date_of_birth;
  address;
  city;
  state;
  zipcode;
  country;
}
const piaMidina = new Participant();
piaMidina.id = 'pia-midina';
piaMidina.type = 'participant';
piaMidina.title = 'Pia Midina';
piaMidina.description = 'Recording artist & lyricist';
piaMidina.imgURL = PIA_MIDINA_PROFILE_IMG;
piaMidina.organization = 'verifi';
piaMidina.ipi = '00618723194';
piaMidina.pro = 'SOMOA';
piaMidina.email = 'pia.midina@gmail.com';
piaMidina.website = 'www.piamidina.com';
piaMidina.number_of_recordings = '17';
piaMidina.phone = '+1 215 612 2103';
piaMidina.date_of_birth = '1996-03-08';
piaMidina.address = '1201 Green St';
piaMidina.city = 'Philadelphia';
piaMidina.state = 'PA';
piaMidina.zipcode = '19111';
piaMidina.country = 'United States';

const luke = new Participant();
luke.id = 'luke-melia';
luke.type = 'participant';
luke.title = 'Luke Melia';
luke.description = 'Singapore resident';

const alex = new Participant();
alex.id = 'alex-speller';
alex.type = 'participant';
alex.title = 'Alex Speller';
alex.description = 'Portugal resident';

class BoxelController extends Controller {
  @tracked isCardIsolated = false;
  models = [piaMidina, luke, alex];
  get sortedCardModels() {
    let result = this.models.sortBy('title');
    if (!this.ascendingSort) {
      result = result.reverse();
    }
    return result;
  }
  @tracked isolatedCard = null;
  @tracked ascendingSort = true;

  @action isolateCard(model) {
    this.isolatedCard = model;
  }
  @action dismissIsolatedCard() {
    this.isolatedCard = null;
  }
  @action reverseSort() {
    this.ascendingSort = !this.ascendingSort;
  }
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @action async isolatedCardTransition({
    context,
    insertedSprites,
    receivedSprites,
    sentSprites,
    removedSprites,
  }) {
    // let sentSprite = sentSprites.size === 0 ? null : Array.from(sentSprites)[0];
    // if (sentSprite) {
    //   context.orphansElement.appendChild(sentSprite.element);
    //   sentSprite.counterpart.element.style.opacity = 0;
    // }
    // let fadeOutAnimations = [];
    // for (let removedSprite of Array.from(removedSprites)) {
    //   removedSprite.element.style.opacity = 0;
    //   let animation = removedSprite.element.animate(
    //     [{ opacity: 1 }, { opacity: 0 }],
    //     {
    //       duration: FADE_DURATION,
    //     }
    //   );
    //   fadeOutAnimations.push(animation);
    // }
    // await Promise.all(fadeOutAnimations.map((a) => a.finished));
    // let translateAnimations = [];
    // for (let receivedSprite of Array.from(receivedSprites)) {
    //   let initialBounds = receivedSprite.initialBounds.relativeToPosition(
    //     receivedSprite.finalBounds.parent
    //   );
    //   let finalBounds = receivedSprite.finalBounds.relativeToPosition(
    //     receivedSprite.finalBounds.parent
    //   );
    //   receivedSprite.element.style.opacity = 0;
    //   let deltaX = initialBounds.left - finalBounds.left;
    //   let deltaY = initialBounds.top - finalBounds.top;
    //   let translationKeyFrames = [
    //     {
    //       transform: `translate(${deltaX}px, ${deltaY}px)`,
    //       width: `${initialBounds.width}px`,
    //       height: `${initialBounds.height}px`,
    //     },
    //     {
    //       transform: 'translate(0, 0)',
    //       width: `${finalBounds.width}px`,
    //       height: `${finalBounds.height}px`,
    //     },
    //   ];
    //   context.orphansElement.appendChild(receivedSprite.counterpart.element);
    //   receivedSprite.counterpart.lockStyles(
    //     receivedSprite.finalBounds.relativeToPosition(
    //       receivedSprite.finalBounds.parent
    //     )
    //   );
    //   let animation = receivedSprite.counterpart.element.animate(
    //     translationKeyFrames,
    //     {
    //       duration: TRANSLATE_DURATION,
    //       easing: 'ease-in-out',
    //     }
    //   );
    //   translateAnimations.push(animation);
    // }
    // for (let sentSprite of Array.from(sentSprites)) {
    //   let initialBounds = sentSprite.initialBounds.relativeToPosition(
    //     sentSprite.initialBounds.parent
    //   );
    //   let finalBounds = sentSprite.finalBounds.relativeToPosition(
    //     sentSprite.initialBounds.parent
    //   );
    //   sentSprite.counterpart.element.style.opacity = 0;
    //   let deltaX = finalBounds.left - initialBounds.left;
    //   let deltaY = finalBounds.top - initialBounds.top;
    //   let translationKeyFrames = [
    //     {
    //       transform: 'translate(0, 0)',
    //       width: `${initialBounds.width}px`,
    //       height: `${initialBounds.height}px`,
    //     },
    //     {
    //       transform: `translate(${deltaX}px, ${deltaY}px)`,
    //       width: `${finalBounds.width}px`,
    //       height: `${finalBounds.height}px`,
    //     },
    //   ];
    //   sentSprite.lockStyles(
    //     sentSprite.counterpart.finalBounds.relativeToPosition(
    //       sentSprite.counterpart.finalBounds.parent
    //     )
    //   );
    //   let animation = sentSprite.element.animate(translationKeyFrames, {
    //     duration: TRANSLATE_DURATION,
    //     easing: 'ease-in-out',
    //   });
    //   translateAnimations.push(animation);
    // }
    // await Promise.all(translateAnimations.map((a) => a.finished));
    // if (sentSprite) {
    //   sentSprite.counterpart.element.style.opacity = 1;
    // }
    // let fadeInAnimations = [];
    // for (let receivedSprite of Array.from(receivedSprites)) {
    //   receivedSprite.element.style.opacity = null;
    // }
    // for (let insertedSprite of Array.from(insertedSprites)) {
    //   let animation = insertedSprite.element.animate(
    //     [{ opacity: 0 }, { opacity: 1 }],
    //     {
    //       duration: FADE_DURATION,
    //     }
    //   );
    //   fadeInAnimations.push(animation);
    // }
    // await Promise.all(fadeInAnimations.map((a) => a.finished));
    // context.clearOrphans();
  }
}

export default BoxelController;
