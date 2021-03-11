import Controller from '@ember/controller';
import { assert } from '@ember/debug';
const PIA_MIDINA_PROFILE_IMG = '/images/Pia-Midina.jpg';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import Changeset from 'animations/models/changeset';
import { inject as service } from '@ember/service';
import AnimationsService from '../services/animations';

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

const ISOLATING_INTENT = 'isolating-card';
const UNISOLATING_INTENT = 'unisolating-card';
const SORTING_INTENT = 'sorting-cards';

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
  @service declare animations: AnimationsService;

  @action isolateCard(model: Participant): void {
    this.animations.setIntent(ISOLATING_INTENT);
    this.isolatedCard = model;
  }

  @action dismissIsolatedCard(): void {
    this.animations.setIntent(UNISOLATING_INTENT);
    this.isolatedCard = null;
  }

  @action reverseSort(): void {
    this.animations.setIntent(SORTING_INTENT);
    this.ascendingSort = !this.ascendingSort;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @action async cardSortingTransition(changeset: Changeset) {
    if (changeset.intent !== SORTING_INTENT) {
      return;
    }
    let translateAnimations = [];
    let cardSprites = changeset.spritesFor({ role: 'card' });
    for (let cardSprite of cardSprites) {
      let delta = cardSprite.boundsDelta;
      assert('cardSprite always has a boundsDelta', delta);

      let translationKeyFrames = [
        {
          transform: `translate(${-delta.x}px, ${-delta.y}px)`,
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

      let animation = cardSprite.element.animate(translationKeyFrames, {
        duration: TRANSLATE_DURATION,
        easing: 'ease-in-out',
      });
      translateAnimations.push(animation);
    }
    await Promise.all(translateAnimations.map((a) => a.finished));
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @action async isolatedCardTransition(changeset: Changeset) {
    let { context, intent } = changeset;
    if (intent === ISOLATING_INTENT) {
      let cardSprite = changeset.spriteFor({ role: 'card' });
      let moreSprite = changeset.spriteFor({ role: 'card-more' });
      assert('moreSprite and cardSprite are present', moreSprite && cardSprite);
      moreSprite.hide();

      let delta = cardSprite.boundsDelta;
      assert('cardSprite boundsDelta is defined', delta);

      let translationKeyFrames = [
        {
          transform: `translate(${-delta.x}px, ${-delta.y}px)`,
          width: `${cardSprite.initialWidth}px`,
          height: `${cardSprite.initialHeight}px`,
        },
        {
          transform: 'translate(0, 0)',
          width: `${cardSprite.finalWidth}px`,
          height: `${cardSprite.finalHeight}px`,
        },
      ];
      let cardAnimation = cardSprite.element.animate(translationKeyFrames, {
        duration: TRANSLATE_DURATION,
        easing: 'ease-in-out',
      });
      await cardAnimation.finished;

      moreSprite.unlockStyles();
      let fadeInAnimation = moreSprite.element.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: FADE_DURATION,
        }
      );
      await fadeInAnimation.finished;
    }
    if (intent === UNISOLATING_INTENT) {
      let cardSprite = changeset.spriteFor({ role: 'card' });
      let moreSprite = changeset.spriteFor({ role: 'card-more' });
      let placeholderSprite = changeset.spriteFor({ role: 'card-placeholder' });

      assert(
        'sprites are present',
        moreSprite && cardSprite && placeholderSprite
      );
      assert(
        'cardSprite always has initialBounds and finalBounds and counterpart',
        cardSprite.initialBounds &&
          cardSprite.finalBounds &&
          cardSprite.counterpart
      );
      cardSprite.hide();
      context.appendOrphan(cardSprite.counterpart);
      cardSprite.counterpart.lockStyles();
      cardSprite.counterpart.element.style.zIndex = '1';

      context.appendOrphan(placeholderSprite);
      placeholderSprite.lockStyles();
      placeholderSprite.element.style.opacity = '1';
      placeholderSprite.element.style.zIndex = '-1';

      moreSprite.hide();
      let moreSpriteAnimation = moreSprite.element.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        {
          duration: FADE_DURATION,
        }
      );

      await moreSpriteAnimation.finished;

      let delta = cardSprite.boundsDelta;
      assert('cardSprite boundsDelta is defined', delta);
      let translationKeyFrames = [
        {
          transform: 'translate(0, 0)',
          width: `${cardSprite.initialWidth}px`,
          height: `${cardSprite.initialHeight}px`,
        },
        {
          transform: `translate(${delta.x}px, ${delta.y}px)`,
          width: `${cardSprite.finalWidth}px`,
          height: `${cardSprite.finalHeight}px`,
        },
      ];
      let cardAnimation = cardSprite.counterpart.element.animate(
        translationKeyFrames,
        {
          duration: TRANSLATE_DURATION,
          easing: 'ease-in-out',
        }
      );
      await cardAnimation.finished;
      cardSprite.unlockStyles();
    }
  }
}

export default BoxelController;
