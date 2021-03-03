import Controller from '@ember/controller';
import { assert } from '@ember/debug';
const PIA_MIDINA_PROFILE_IMG = '/images/Pia-Midina.jpg';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import Changeset from 'animations/models/changeset';

const FADE_DURATION = 500;
const TRANSLATE_DURATION = 1000;

class Participant {
  @tracked isIsolated = false;
  id: string | undefined;
  type: string | undefined;
  title: string | undefined;
  description: string | undefined;
  imgURL: string | undefined;
  organization: string | undefined;
  ipi: string | undefined;
  pro: string | undefined;
  email: string | undefined;
  website: string | undefined;
  number_of_recordings: string | undefined;
  phone: string | undefined;
  date_of_birth: string | undefined;
  address: string | undefined;
  city: string | undefined;
  state: string | undefined;
  zipcode: string | undefined;
  country: string | undefined;
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
  get sortedCardModels(): Participant[] {
    let result = this.models.sortBy('title');
    if (!this.ascendingSort) {
      result = result.reverse();
    }
    return result;
  }
  @tracked isolatedCard: Participant | null | undefined;
  @tracked ascendingSort = true;

  @action isolateCard(model: Participant): void {
    this.isolatedCard = model;
  }

  @action dismissIsolatedCard(): void {
    this.isolatedCard = null;
  }

  @action reverseSort(): void {
    this.ascendingSort = !this.ascendingSort;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @action async cardSortingTransition({ keptSprites }: Changeset) {
    let translateAnimations = [];
    for (let keptSprite of Array.from(keptSprites)) {
      assert(
        'keptSprite always has initialBounds and finalBounds',
        keptSprite.initialBounds && keptSprite.finalBounds
      );

      let initialBounds = keptSprite.initialBounds.relativeToContext;
      let finalBounds = keptSprite.finalBounds.relativeToContext;
      let deltaX = initialBounds.left - finalBounds.left;
      let deltaY = initialBounds.top - finalBounds.top;
      let translationKeyFrames = [
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
          boxShadow: '0 0 0',
        },
        {
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        },
        {
          transform: 'translate(0, 0)',
          boxShadow: '0 0 0',
        },
      ];
      let animation = keptSprite.element.animate(translationKeyFrames, {
        duration: TRANSLATE_DURATION,
        easing: 'ease-in-out',
      });
      translateAnimations.push(animation);
    }
    await Promise.all(translateAnimations.map((a) => a.finished));
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @action async isolatedCardTransition({
    insertedSprites,
    keptSprites,
    removedSprites,
  }: Changeset) {
    for (let insertedSprite of Array.from(insertedSprites)) {
      if (insertedSprite.id === 'card-more') {
        insertedSprite.element.style.opacity = '0';
      }
    }
    let fadeOutAnimations = [];
    for (let removedSprite of Array.from(removedSprites)) {
      removedSprite.element.style.opacity = '0';
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
    for (let keptSprite of Array.from(keptSprites)) {
      assert(
        'keptSprite always has initialBounds and finalBounds',
        keptSprite.initialBounds && keptSprite.finalBounds
      );

      let initialBounds = keptSprite.initialBounds.relativeToContext;
      let finalBounds = keptSprite.finalBounds.relativeToContext;
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
      let animation = keptSprite.element.animate(translationKeyFrames, {
        duration: TRANSLATE_DURATION,
        easing: 'ease-in-out',
      });
      translateAnimations.push(animation);
    }
    await Promise.all(translateAnimations.map((a) => a.finished));
    let fadeInAnimations = [];
    for (let insertedSprite of Array.from(insertedSprites)) {
      if (insertedSprite.id === 'card-more') {
        insertedSprite.element.style.removeProperty('opacity');
      }
      let animation = insertedSprite.element.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: FADE_DURATION,
        }
      );
      fadeInAnimations.push(animation);
    }
    await Promise.all(fadeInAnimations.map((a) => a.finished));
  }
}

export default BoxelController;
