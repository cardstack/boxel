// Expected output for nested template structures
import { eq } from '@cardstack/boxel-ui/helpers';
import MyComponent from 'somewhere';

<template>
  <div>
    <MyComponent @flag={{eq 1 1}}>
      <div>
        <p>Nested content</p>
        <span>More content</span>
      </div>
    </MyComponent>
  </div>
</template>
