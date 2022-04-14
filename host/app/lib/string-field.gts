import { Card, Signature, } from 'runtime-spike/lib/card-api';
import Component from '@glint/environment-ember-loose/glimmer-component';

export default function() {
  return new Card({
    isolated: class Isolated extends Component<Signature> {
      <template>{{@model}}</template>
    },
    embedded: class Embedded extends Component<Signature> {
      <template>{{@model}}</template>
    }
  });
}