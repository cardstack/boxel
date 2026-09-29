import type { TOC } from '@ember/component/template-only';
import { DemoPage } from 'test-app/components/demo-page';
import type { DemoEntry } from 'test-app/lib/catalog';

interface Signature {
  Args: { model?: DemoEntry };
}

<template><DemoPage @model={{@model}} /></template> satisfies TOC<Signature>;
