import GlimmerComponent from '@glimmer/component';
import { ComponentLike } from '@glint/template';

export const primitive = Symbol('cardstack-primitive');

type FieldTypeFor<T> = T extends { [primitive]: infer F } ? F : T;
type CardInstanceType<T extends Constructable> = T extends { [primitive]: infer P } ? P : InstanceType<T>;

export type Format = 'isolated' | 'embedded' | 'edit';

export function contains<CardT extends Constructable>(card: CardT): FieldTypeFor<CardT> {
  if (primitive in card) {
    return {
      setupField() {
        let bucket = new WeakMap();
        return {
          get() {
            return bucket.get(this);
          },
          set(value: any) {
            bucket.set(this, value);
          }
        }
      }
    } as any;
  } else {
    return {
      setupField() {
       let instance = new card();
       return {
         get() {
           return instance;
         },
         set(value: any) {
           Object.assign(instance, value);
         }
       }
      }
    } as any
  }
}

// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function(_target: object, _key: string| symbol, { initializer }: { initializer(): any }) {
  return initializer().setupField();
} as unknown as PropertyDecorator;

export type Constructable = new(...args: any) => any;

type SignatureFor<CardT extends Constructable> = { Args: { model: CardInstanceType<CardT> } }

export class Component<CardT extends Constructable> extends GlimmerComponent<SignatureFor<CardT>> {

}

const defaultComponent = {
  isolated: <template></template>,
  embedded: <template></template>,
  edit: <template></template>
}

function getComponent<CardT extends Constructable>(card: CardT, format: Format): new() => Component<CardT> {
  let Implementation = (card as any)[format];  
  return Implementation ?? defaultComponent[format];
}

function getInitialData(card: Constructable): Record<string, any> | undefined {
  return (card as any).data;
}

export async function prepareToRender<CardT extends Constructable>(card: CardT, format: Format): Promise<{ component: ComponentLike<{ Args: never, Blocks: never }> }> {
  let Implementation = getComponent(card, format);
  let model = new card();
  let data = getInitialData(card);
  if (data) {
    Object.assign(model, data);
  }
  let component = <template>
    <Implementation @model={{model}} />
  </template>
  return { component };
}