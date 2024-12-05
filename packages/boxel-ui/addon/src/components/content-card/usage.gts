import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import ContentCard from './index.gts';
import PhotoIcon from '@cardstack/boxel-icons/photo';
import ArcheryArrow from '@cardstack/boxel-icons/archery-arrow';

interface Signature {
  Element: HTMLElement;
}

export default class ContentCardUsage extends Component<Signature> {
  <template>
    <FreestyleUsage @name='CardContentContainer'>
      <:description>
        A content card usage for CRM
      </:description>
      <:example>
        <div class='content-container'>
          <div class='content-grid'>
            <ContentCard>
              <:title>
                <h3 class='content-title'>Company Info</h3>
              </:title>
              <:icon>
                <PhotoIcon class='header-icon' />
              </:icon>
              <:content>
                <p class='description'><strong>technova.com</strong></p>
                <p class='description'>London, UK</p>
              </:content>
            </ContentCard>

            <ContentCard>
              <:title>
                <h3 class='content-title'>Contacts</h3>
              </:title>
              <:icon>
                <ArcheryArrow class='header-icon' />
              </:icon>
              <:content>
                Example Data
              </:content>
            </ContentCard>

            <ContentCard>
              <:title>
                <h3 class='content-title'>Lifetime Value</h3>
              </:title>
              <:icon>
                <PhotoIcon class='header-icon' />
              </:icon>
              <:content>
                <h3 class='content-highlight'>$792.1k</h3>
                <p class='description'>+92.5k in 2024</p>
              </:content>
            </ContentCard>

            <ContentCard>
              <:title>
                <h3 class='content-title'>Active Deals</h3>
              </:title>
              <:icon>
                <PhotoIcon class='header-icon' />
              </:icon>
              <:content>
                <h3 class='content-highlight'>2</h3>
                <p class='description'>$35.5k total value</p>
              </:content>
            </ContentCard>
          </div>
        </div>
      </:example>
    </FreestyleUsage>
    <style scoped>
      .content-container {
        container-type: inline-size;
        container-name: content-container;
      }
      .content-grid {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .content-title {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xxs);
        margin: 0;
      }
      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .content-highlight {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
      .description {
        margin: 0;
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      @container content-container (min-width: 768px) {
        .content-grid {
          grid-template-columns: repeat(4, 1fr);
        }
      }
      @container content-container (min-width: 480px) and (max-width: 767px) {
        .content-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @container content-container (max-width: 479px) {
        .content-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}
