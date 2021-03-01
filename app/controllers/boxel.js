import Controller from '@ember/controller';
const PIA_MIDINA_PROFILE_IMG = '/images/Pia-Midina.jpg';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

const FADE_DURATION = 500;
const TRANSLATE_DURATION = 1000;

class BoxelController extends Controller {
  @tracked isCardIsolated = false;
  piaMidina = {
    id: 'pia-midina',
    type: 'participant',
    title: 'Pia Midina',
    description: 'Recording artist & lyricist',
    imgURL: PIA_MIDINA_PROFILE_IMG,
    organization: 'verifi',
    ipi: '00618723194',
    pro: 'SOMOA',
    email: 'pia.midina@gmail.com',
    website: 'www.piamidina.com',
    number_of_recordings: '17',
    phone: '+1 215 612 2103',
    date_of_birth: '1996-03-08',
    address: '1201 Green St',
    city: 'Philadelphia',
    state: 'PA',
    zipcode: '19111',
    country: 'United States',
  };
  @action isolatePiaMidinaCard() {
    this.isCardIsolated = true;
  }
  @action dismissPiaMidinaCard() {
    this.isCardIsolated = false;
  }
  @action async isolatedCardTransition({
    context,
    insertedSprites,
    receivedSprites,
    sentSprites,
    removedSprites,
  }) {
    let sentSprite = sentSprites.size === 0 ? null : Array.from(sentSprites)[0];
    if (sentSprite) {
      context.orphansElement.appendChild(sentSprite.element);
      sentSprite.counterpart.element.style.opacity = 0;
    }

    let fadeOutAnimations = [];
    for (let removedSprite of Array.from(removedSprites)) {
      removedSprite.element.style.opacity = 0;
      let animation = removedSprite.element.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        {
          duration: FADE_DURATION,
        }
      );
      fadeOutAnimations.push(animation);
    }
    await Promise.all(fadeOutAnimations.map((a) => a.finished));

    let translateAnimations = [];
    for (let receivedSprite of Array.from(receivedSprites)) {
      let initialBounds = receivedSprite.initialBounds.relativeToPosition(
        receivedSprite.finalBounds.parent
      );
      let finalBounds = receivedSprite.finalBounds.relativeToPosition(
        receivedSprite.finalBounds.parent
      );
      receivedSprite.element.style.opacity = 0;

      let deltaX = initialBounds.left - finalBounds.left;
      let deltaY = initialBounds.top - finalBounds.top;

      let translationKeyFrames = [
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
          width: `${initialBounds.width}px`,
          height: `${initialBounds.height}px`,
        },
        {
          transform: 'translate(0, 0)',
          width: `${finalBounds.width}px`,
          height: `${finalBounds.height}px`,
        },
      ];
      context.orphansElement.appendChild(receivedSprite.counterpart.element);
      receivedSprite.counterpart.lockStyles(
        receivedSprite.finalBounds.relativeToPosition(
          receivedSprite.finalBounds.parent
        )
      );
      let animation = receivedSprite.counterpart.element.animate(
        translationKeyFrames,
        {
          duration: TRANSLATE_DURATION,
          easing: 'ease-in-out',
        }
      );
      translateAnimations.push(animation);
    }
    for (let sentSprite of Array.from(sentSprites)) {
      let initialBounds = sentSprite.initialBounds.relativeToPosition(
        sentSprite.initialBounds.parent
      );
      let finalBounds = sentSprite.finalBounds.relativeToPosition(
        sentSprite.initialBounds.parent
      );
      sentSprite.counterpart.element.style.opacity = 0;

      let deltaX = finalBounds.left - initialBounds.left;
      let deltaY = finalBounds.top - initialBounds.top;

      let translationKeyFrames = [
        {
          transform: 'translate(0, 0)',
          width: `${initialBounds.width}px`,
          height: `${initialBounds.height}px`,
        },
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
          width: `${finalBounds.width}px`,
          height: `${finalBounds.height}px`,
        },
      ];
      sentSprite.lockStyles(
        sentSprite.counterpart.finalBounds.relativeToPosition(
          sentSprite.counterpart.finalBounds.parent
        )
      );
      let animation = sentSprite.element.animate(translationKeyFrames, {
        duration: TRANSLATE_DURATION,
        easing: 'ease-in-out',
      });
      translateAnimations.push(animation);
    }
    await Promise.all(translateAnimations.map((a) => a.finished));
    if (sentSprite) {
      sentSprite.counterpart.element.style.opacity = 1;
    }

    let fadeInAnimations = [];
    for (let receivedSprite of Array.from(receivedSprites)) {
      receivedSprite.element.style.opacity = null;
    }
    for (let insertedSprite of Array.from(insertedSprites)) {
      let animation = insertedSprite.element.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: FADE_DURATION,
        }
      );
      fadeInAnimations.push(animation);
    }
    await Promise.all(fadeInAnimations.map((a) => a.finished));
    context.clearOrphans();
  }
}

export default BoxelController;
