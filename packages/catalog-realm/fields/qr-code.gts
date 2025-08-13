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
        <canvas data-test-qr-canvas {{QRModifier data=@model.data}}>
        </canvas>
      </div>

      <style scoped>
        .qr-container {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          height: 100%;
          padding: 1rem;
        }
        .qr-container canvas {
          max-width: 100%;
          max-height: 100%;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='qr-embedded'>
        <canvas data-test-qr-canvas {{QRModifier data=@model.data}}>
        </canvas>
      </div>

      <style scoped>
        .qr-embedded {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          height: 100%;
          padding: 0.5rem;
        }
        .qr-embedded canvas {
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
      setCanvas?: (canvas: HTMLCanvasElement) => void;
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
    QRCode.toCanvas(
      element,
      data,
      {
        scale: 15,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      },
      (error: any) => {
        if (error) {
          element.textContent = 'Error generating QR code';
        }
      },
    );
  }
}
