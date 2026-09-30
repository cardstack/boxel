import type { TOC } from '@ember/component/template-only';
import { Documentation } from 'test-app/components/documentation';
import type { Guide } from 'test-app/lib/guides';

<template>
  <Documentation @guide={{@model.guide}} @isTopic={{true}} />
</template> satisfies TOC<{ Args: { model: { guide?: Guide } } }>;
