import { concat } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';

interface StackedVerticalBarRendererSignature {
  Args: {
    bars: {
      aSeg: { x: number; y: number; h: number; fill: string };
      bSeg: { x: number; y: number; h: number; fill: string };
      labelX: number;
      labelY: number;
      barW: number;
      total: number;
    }[];
  };
}

// ² Stacked vertical bars renderer
export class StackedVerticalBarRenderer extends GlimmerComponent<StackedVerticalBarRendererSignature> {
  <template>
    {{#each @bars as |b|}}
      <!-- A segment -->
      <rect
        x={{b.aSeg.x}}
        y={{b.aSeg.y}}
        width={{b.barW}}
        height={{b.aSeg.h}}
        fill={{b.aSeg.fill}}
        rx='2'
      />
      <!-- B segment -->
      <rect
        x={{b.bSeg.x}}
        y={{b.bSeg.y}}
        width={{b.barW}}
        height={{b.bSeg.h}}
        fill={{b.bSeg.fill}}
        rx='2'
      />
    {{/each}}
  </template>
}

interface SingleVerticalBarRendererSignature {
  Args: {
    bars: {
      singleSeg: { x: number; y: number; h: number; fill: string };
      labelX: number;
      labelY: number;
      barW: number;
      total: number;
    }[];
  };
}

interface DonutRendererSignature {
  Args: {
    cx: number;
    cy: number;
    r: number;
    stroke: number;
    slices: {
      label: string;
      color: string;
      dash: number;
      gap: number;
      offset: number;
    }[];
  };
}

interface HorizontalBarRendererSignature {
  Args: {
    bars: {
      x: number;
      y: number;
      w: number;
      labelX: string;
      labelY: string;
      total: number;
      barH: number;
      fill: string;
    }[];
    labels: { x: number; y: number; text: string }[];
  };
}

interface LineRendererSignature {
  Args: {
    pointsString: string;
    points: { x: number; y: number }[];
    labels: { x: number; y: number; text: string }[];
  };
}

// ³ Single vertical bars renderer
export class SingleVerticalBarRenderer extends GlimmerComponent<SingleVerticalBarRendererSignature> {
  <template>
    {{#each @bars as |b|}}
      <rect
        x={{b.singleSeg.x}}
        y={{b.singleSeg.y}}
        width={{b.barW}}
        height={{b.singleSeg.h}}
        fill={{b.singleSeg.fill}}
        rx='2'
      />
      <text
        x={{b.labelX}}
        y={{b.labelY}}
        text-anchor='middle'
        class='total-label'
      >{{b.total}}</text>
    {{/each}}
  </template>
}

// ⁴ Horizontal bars renderer (bars + left labels)
export class HorizontalBarRenderer extends GlimmerComponent<HorizontalBarRendererSignature> {
  <template>
    {{#each @bars as |b|}}
      <rect
        x={{b.x}}
        y={{b.y}}
        width={{b.w}}
        height={{b.barH}}
        fill={{b.fill}}
        rx='2'
      />
      <text x={{b.labelX}} y={{b.labelY}} class='total-label'>{{b.total}}</text>
    {{/each}}

    {{#each @labels as |lbl|}}
      <text
        x={{lbl.x}}
        y={{lbl.y}}
        text-anchor='end'
        class='x-label'
      >{{lbl.text}}</text>
    {{/each}}
  </template>
}

// ⁵ Donut renderer (expects precomputed dash arrays/offsets)
export class DonutRenderer extends GlimmerComponent<DonutRendererSignature> {
  <template>
    <!-- Background ring -->
    <circle
      cx={{@cx}}
      cy={{@cy}}
      r={{@r}}
      stroke='#e5e7eb'
      stroke-width={{@stroke}}
      fill='none'
    />
    <!-- Slices -->
    {{#each @slices as |s|}}
      <circle
        cx={{@cx}}
        cy={{@cy}}
        r={{@r}}
        stroke={{s.color}}
        stroke-width={{@stroke}}
        stroke-dasharray={{concat s.dash ' ' s.gap}}
        stroke-dashoffset={{s.offset}}
        fill='none'
        transform={{concat 'rotate(-90 ' @cx ' ' @cy ')'}}
        stroke-linecap='butt'
      />
    {{/each}}
  </template>
}

// ⁶ Line renderer (expects polyline pointsString plus point markers/labels)
export class LineRenderer extends GlimmerComponent<LineRendererSignature> {
  <template>
    <polyline
      points={{@pointsString}}
      fill='none'
      stroke='#3b82f6'
      stroke-width='2'
    />
    {{#each @points as |p|}}
      <circle cx={{p.x}} cy={{p.y}} r='3' fill='#1d4ed8' />
    {{/each}}
    {{#each @labels as |lbl|}}
      <text
        x={{lbl.x}}
        y={{lbl.y}}
        text-anchor='end'
        transform={{concat 'rotate(-45 ' lbl.x ' ' lbl.y ')'}}
        class='x-label'
      >{{lbl.text}}</text>
    {{/each}}
  </template>
}
