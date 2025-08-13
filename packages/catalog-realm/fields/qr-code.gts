import { FieldDef } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import Modifier, { NamedArgs } from 'ember-modifier';
import QRCodeIcon from '@cardstack/boxel-icons/qr-code';
//@ts-ignore
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import ColorField from 'https://cardstack.com/base/color';
import NumberField from 'https://cardstack.com/base/number';

class QRConfigField extends FieldDef {
  @field foreground = contains(ColorField);
  @field background = contains(ColorField);
  @field margin = contains(NumberField);
}

export class QRField extends FieldDef {
  static displayName = 'QR Code';
  static icon = QRCodeIcon;

  @field data = contains(StringField);
  @field config = contains(QRConfigField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='qr-container'>
        <div
          data-test-qr-svg
          {{QRModifier data=@model.data config=@model.config}}
        >
        </div>
      </div>

      <style scoped>
        .qr-container {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          height: 100%;
        }
        .qr-container svg {
          max-width: 100%;
          max-height: 100%;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='qr-embedded'>
        <div
          data-test-qr-svg
          {{QRModifier data=@model.data config=@model.config}}
        >
        </div>
      </div>

      <style scoped>
        .qr-embedded {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          height: 100%;
        }
        .qr-embedded svg {
          width: 100%;
          height: 100%;
        }
      </style>
    </template>
  };
}

interface QRModifierSignature {
  Args: {
    Positional: [];
    Named: {
      data: string | undefined;
      config: QRConfigField | undefined;
    };
  };
}

class QRModifier extends Modifier<QRModifierSignature> {
  element: HTMLElement | null = null;

  modify(
    element: HTMLElement,
    [],
    { data, config }: NamedArgs<QRModifierSignature>,
  ) {
    if (!data) {
      element.textContent = 'No data provided for QR code';
      return;
    }
    const qrCodeOpts = {
      type: 'svg',
      color: {
        dark: config?.foreground ?? '#000000',
        light: config?.background ?? '#FFFFFF',
      },
      margin: config?.margin ?? 4,
    };
    QRCode.toString(data, qrCodeOpts, (error: any, svgString: string) => {
      if (error) {
        element.textContent = 'Error generating QR code';
      } else {
        // Remove width and height attributes to allow CSS sizing
        const modifiedSvg = svgString
          .replace(/width="[^"]*"/g, '')
          .replace(/height="[^"]*"/g, '')
          .replace('<svg', '<svg width="100%" height="100%"');
        element.innerHTML = modifiedSvg;
      }
    });
  }
}
