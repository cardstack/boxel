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
      bottom: var(--boxel-sp-xs);
      left: 50%;
      transform: translateX(-50%);
      width: 700px;
      text-align: center;
      color: var(--boxel-light);
      z-index: var(--host-disclaimer-z-index);
    }

    .disclaimer > p {
      margin-block: 0;
      font: var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xxs);
      line-height: 1.25;
    }

    @media screen and (max-width: 1445px) {
      .disclaimer {
        width: 450px;
        bottom: var(--boxel-sp-xxxs);
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
