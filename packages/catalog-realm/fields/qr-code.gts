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

export class QRField extends FieldDef {
  static displayName = 'QR Code';
  static icon = QRCodeIcon;

  @field data = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='qr-container'>
        <div data-test-qr-svg {{QRModifier data=@model.data}}>
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
        <div data-test-qr-svg {{QRModifier data=@model.data}}>
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
    };
  };
}

class QRModifier extends Modifier<QRModifierSignature> {
  element: HTMLElement | null = null;

  modify(element: HTMLElement, [], { data }: NamedArgs<QRModifierSignature>) {
    if (!data) {
      element.textContent = 'No data provided for QR code';
      return;
    }
    QRCode.toString(
      data,
      {
        type: 'svg',
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      },
      (error: any, svgString: string) => {
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
      },
    );
  }
}
