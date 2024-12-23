import { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLElement;
  Args: {};
}

let component: TemplateOnlyComponent<Signature> = <template>
  <div class='disclaimer'>
    <p>
      <span class='disclaimer-title'>Early Access Notice:</span>
      This app is in its early access phase—explore and have fun, but please
      avoid entering or sharing sensitive information, including confidential
      data or keys. Note that your data may not be stored permanently, so don’t
      use this app for long-term or critical purposes just yet.
    </p>
  </div>
  <style scoped>
    .disclaimer {
      position: fixed;
      bottom: 2px;
      left: 50%;
      transform: translateX(-50%);
      width: 996px;
      text-align: center;
      color: white;
      z-index: var(--host-disclaimer-z-index);
      font-size: 0.7rem;
    }

    @media screen and (max-width: 1445px) {
      .disclaimer {
        width: 658px;
        bottom: -8px;
      }
    }

    @media screen and (max-width: 1115px) {
      .disclaimer {
        display: none;
      }
    }

    .disclaimer-title {
      font-weight: 600;
    }
  </style>
</template>;

export default component;
