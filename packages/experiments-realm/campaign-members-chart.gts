import { ContactForm } from './contact-form';
import { LeadForm } from './lead-form';

import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
  StringField,
  linksTo,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import {
  FieldContainer,
  BoxelSelect,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';

// @ts-ignore
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

class ContactMembersFieldEdit extends Component<typeof ContactMembersField> {
  get selectedResponseStatus() {
    return {
      name: this.args.model.responseStatus,
    };
  }

  get responseStatusFieldStyle() {
    let css: string[] = [];
    css.push('margin-top:var(--boxel-sp-sm);');
    return htmlSafe(css.join(' '));
  }

  @action updateResponseStatus(type: { name: string }) {
    this.args.model.responseStatus = type.name;
  }

  private responseStatuses = [{ name: 'Sent' }, { name: 'Responded' }];

  <template>
    <FieldContainer
      @label='Contact Member'
      data-test-field='contact-member'
      @vertical={{true}}
    >
      <@fields.contactForm />
    </FieldContainer>
    <FieldContainer
      @label='Response Status'
      data-test-field='contact-form-response-status'
      style={{this.responseStatusFieldStyle}}
      @vertical={{true}}
    >
      <BoxelSelect
        @placeholder={{'Select Status'}}
        @selected={{this.selectedResponseStatus}}
        @onChange={{this.updateResponseStatus}}
        @options={{this.responseStatuses}}
        @dropdownClass='boxel-select-contact-form-response-status'
        as |item|
      >
        <div>{{item.name}}</div>
      </BoxelSelect>
    </FieldContainer>
  </template>
}

class ContactMembersField extends FieldDef {
  static displayName = 'ContactMember';
  @field contactForm = linksTo(ContactForm);
  @field responseStatus = contains(StringField);

  static edit = ContactMembersFieldEdit;
}

class LeadMembersFieldEdit extends Component<typeof LeadMembersField> {
  get selectedResponseStatus() {
    return {
      name: this.args.model.responseStatus,
    };
  }

  get responseStatusFieldStyle() {
    let css: string[] = [];
    css.push('margin-top:var(--boxel-sp-sm);');
    return htmlSafe(css.join(' '));
  }

  @action updateResponseStatus(type: { name: string }) {
    this.args.model.responseStatus = type.name;
  }

  private responseStatuses = [{ name: 'Sent' }, { name: 'Responded' }];

  <template>
    <FieldContainer
      @label='Lead Member'
      data-test-field='lead-member'
      @vertical={{true}}
    >
      <@fields.leadForm />
    </FieldContainer>
    <FieldContainer
      @label='Response Status'
      data-test-field='lead-form-response-status'
      style={{this.responseStatusFieldStyle}}
      @vertical={{true}}
    >
      <BoxelSelect
        @placeholder={{'Select Status'}}
        @selected={{this.selectedResponseStatus}}
        @onChange={{this.updateResponseStatus}}
        @options={{this.responseStatuses}}
        @dropdownClass='boxel-select-lead-form-response-status'
        as |item|
      >
        <div>{{item.name}}</div>
      </BoxelSelect>
    </FieldContainer>
  </template>
}

class LeadMembersField extends FieldDef {
  static displayName = 'LeadMember';
  @field leadForm = linksTo(LeadForm);
  @field responseStatus = contains(StringField);

  static edit = LeadMembersFieldEdit;
}

interface ChartSignature {
  Args: {
    numberSent: number;
    numberResponsed: number;
  };
  Element: HTMLElement;
}

class DonutChart extends GlimmerComponent<ChartSignature> {
  get displayDonut() {
    if (typeof document === 'undefined') {
      return;
    }

    const data = [
      { name: 'Sent', value: this.args.numberSent },
      { name: 'Responded', value: this.args.numberResponsed },
    ];

    const width = 200;
    const height = 200;
    const radius = Math.min(width, height) / 2;

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${width / 2}, ${height / 2})`);

    svg.appendChild(g);

    // Add middle text
    const middleText = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'text',
    );
    middleText.setAttribute('text-anchor', 'middle');
    middleText.setAttribute('dy', '.35em');
    middleText.setAttribute('font-size', '20px');
    middleText.textContent = (
      this.args.numberSent + this.args.numberResponsed
    ).toString();
    g.appendChild(middleText);

    const tooltip = d3
      .select('.donut-chart')
      .append('div')
      .attr('class', 'tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('background-color', '#ffffff')
      .style('border', 'solid')
      .style('border-width', '1px')
      .style('border-radius', '8px')
      .style('padding', '0.5rem')
      .style('color', 'black')
      .style('width', '160px')
      .style('pointer-events', 'none');

    const arc = d3
      .arc()
      .innerRadius(radius - 50)
      .outerRadius(radius);

    const pie = d3.pie().value((d: { value: any }) => d.value);

    const arcs = d3
      .select(g)
      .selectAll('.arc')
      .data(pie(data))
      .enter()
      .append('g')
      .attr('class', 'arc');

    arcs
      .append('path')
      .attr('d', arc)
      .style('fill', (d: any) => color(d.data.name))
      .on('mouseover', function (event, d) {
        d3.select(this).style('opacity', 0.7);
        tooltip
          .style('opacity', 1)
          .html(
            `<div><strong>Status</strong><br>${d.data.name}<hr>Number of members: ${d.data.value}</div>`,
          )
          .style('left', event.layerX + 10 + 'px')
          .style('top', event.layerY + 10 + 'px');
      })
      .on('mouseout', function (event, d) {
        d3.select(this).style('opacity', 1);
        tooltip.style('opacity', 0);
      });

    arcs
      .append('text')
      .attr('transform', (d: any) => 'translate(' + arc.centroid(d) + ')')
      .attr('dy', '.35em')
      .style('text-anchor', 'middle')
      .text((d: any) => d.data.value);

    return svg;
  }

  <template>
    <div class='donut-chart-container'>
      <h4>Number of Members</h4>
      <div class='donut-chart'>
        {{this.displayDonut}}
      </div>
    </div>
    <style>
      .donut-chart-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .donut-chart {
        position: relative;
      }
    </style>
  </template>
}

class HorizontalBarChart extends GlimmerComponent<ChartSignature> {
  get displayHorizontalBar() {
    if (typeof document === 'undefined') {
      return;
    }

    const data = [
      { name: 'Sent', value: this.args.numberSent },
      { name: 'Responded', value: this.args.numberResponsed },
    ];

    const width = 400;
    const height = 250;
    const marginTop = 40;
    const marginRight = 20;
    const marginBottom = 40;
    const marginLeft = 100;

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());

    // create horizontal bar chart with category/value axis label and value axis text
    const x = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.value)])
      .range([0, width - marginLeft - marginRight]);

    const y = d3
      .scaleBand()
      .domain(data.map((d) => d.name))
      .range([0, height - marginTop - marginBottom])
      .padding(0.1);

    const g = d3
      .select(svg)
      .append('g')
      .attr('transform', `translate(${marginLeft}, ${marginTop})`);

    g.append('g')
      .selectAll('rect')
      .data(data)
      .enter()
      .append('rect')
      .attr('y', (d) => y(d.name))
      .attr('width', (d) => x(d.value))
      .attr('height', y.bandwidth())
      .attr('fill', (d) => color(d.name));

    g.append('g')
      .selectAll('text')
      .data(data)
      .enter()
      .append('text')
      .attr('x', (d) => x(d.value) - 20)
      .attr('y', (d) => y(d.name) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text((d) => d.value);

    g.append('g')
      .attr('transform', `translate(0, ${height - marginTop - marginBottom})`)
      .call(d3.axisBottom(x));

    g.append('g').call(d3.axisLeft(y));

    return svg;
  }

  <template>
    <div class='horizontal-bar-chart-container'>
      <h4>Number of Members</h4>
      <div class='horizontal-bar-chart'>
        {{this.displayHorizontalBar}}
      </div>
    </div>
    <style>
      .horizontal-bar-chart-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .horizontal-bar-chart {
        position: relative;
      }
    </style>
  </template>
}

class VerticalBarChart extends GlimmerComponent<ChartSignature> {
  get displayVerticalBar() {
    if (typeof document === 'undefined') {
      return;
    }

    const data = [
      { name: 'Sent', value: this.args.numberSent },
      { name: 'Responded', value: this.args.numberResponsed },
    ];

    const width = 400;
    const height = 250;
    const marginTop = 40;
    const marginRight = 20;
    const marginBottom = 40;
    const marginLeft = 100;

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());

    // create vertical bar chart with category/value axis label and value axis text
    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.name))
      .range([0, width - marginLeft - marginRight])
      .padding(0.1);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.value)])
      .range([height - marginTop - marginBottom, 0]);

    const g = d3
      .select(svg)
      .append('g')
      .attr('transform', `translate(${marginLeft}, ${marginTop})`);

    g.append('g')
      .selectAll('rect')
      .data(data)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.name))
      .attr('y', (d) => y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - marginTop - marginBottom - y(d.value))
      .attr('fill', (d) => color(d.name));

    g.append('g')
      .selectAll('text')
      .data(data)
      .enter()
      .append('text')
      .attr('x', (d) => x(d.name) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.value) + 15)
      .attr('dy', '0.35em')
      .text((d) => d.value);

    g.append('g').call(d3.axisLeft(y));

    g.append('g')
      .attr('transform', `translate(0, ${height - marginTop - marginBottom})`)
      .call(d3.axisBottom(x));

    return svg;
  }

  <template>
    <div class='vertical-bar-chart-container'>
      <h4>Number of Members</h4>
      <div class='vertical-bar-chart'>
        {{this.displayVerticalBar}}
      </div>
    </div>
    <style>
      .vertical-bar-chart-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .vertical-bar-chart {
        position: relative;
      }
    </style>
  </template>
}

class Isolated extends Component<typeof CampaignMembersChart> {
  get numberSent() {
    let { model } = this.args;
    const contactMembers =
      model.contactMembers?.filter(
        (contactMember) => contactMember.responseStatus === 'Sent',
      ) || [];
    const leadMembers =
      model.leadMembers?.filter(
        (leadMember) => leadMember.responseStatus === 'Sent',
      ) || [];
    return contactMembers.length + leadMembers.length;
  }

  get numberResponsed() {
    let { model } = this.args;
    const contactMembers =
      model.contactMembers?.filter(
        (contactMember) => contactMember.responseStatus === 'Responded',
      ) || [];
    const leadMembers =
      model.leadMembers?.filter(
        (leadMember) => leadMember.responseStatus === 'Responded',
      ) || [];
    return contactMembers.length + leadMembers.length;
  }

  get chartType() {
    return this.args.model.chartType;
  }

  get isChartTypeDonut() {
    return this.chartType === 'Donut';
  }

  get isChartTypeHorizontalBar() {
    return this.chartType === 'Horizontal Bar';
  }

  get isChartTypeVerticalBar() {
    return this.chartType === 'Vertical Bar';
  }

  <template>
    <div class='campaign-members-chart-isolated'>
      <FieldContainer @label='Campaign Name' class='field'>
        {{@model.name}}
      </FieldContainer>
      {{#if this.isChartTypeDonut}}
        <DonutChart
          @numberSent={{this.numberSent}}
          @numberResponsed={{this.numberResponsed}}
        />
      {{/if}}
      {{#if this.isChartTypeHorizontalBar}}
        <HorizontalBarChart
          @numberSent={{this.numberSent}}
          @numberResponsed={{this.numberResponsed}}
        />
      {{/if}}
      {{#if this.isChartTypeVerticalBar}}
        <VerticalBarChart
          @numberSent={{this.numberSent}}
          @numberResponsed={{this.numberResponsed}}
        />
      {{/if}}
    </div>
    <style>
      .campaign-members-chart-isolated {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class Embedded extends Component<typeof CampaignMembersChart> {
  <template>
    {{@model.name}}
  </template>
}

class Edit extends Component<typeof CampaignMembersChart> {
  get selectedChartType() {
    return {
      name: this.args.model.chartType,
    };
  }

  @action updateName(inputText: string) {
    this.args.model.name = inputText;
  }

  @action updateChartType(type: { name: string }) {
    this.args.model.chartType = type.name;
  }

  private campaignChartTypes = [
    { name: 'Donut' },
    { name: 'Vertical Bar' },
    { name: 'Horizontal Bar' },
  ];

  <template>
    <div class='campaign-members-chart-edit'>
      <FieldContainer
        @label='Campaign Name'
        data-test-field='name'
        @tag='label'
        class='field'
      >
        <BoxelInput
          @value={{this.args.model.name}}
          @onInput={{this.updateName}}
          maxlength='255'
        />
      </FieldContainer>

      <FieldContainer
        @label='Chart Type'
        data-test-field='chart-type'
        class='field'
      >
        <BoxelSelect
          @placeholder={{'Select Type'}}
          @selected={{this.selectedChartType}}
          @onChange={{this.updateChartType}}
          @options={{this.campaignChartTypes}}
          @dropdownClass='boxel-select-campaign-chart-type'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>
      <FieldContainer
        @label='Contact Members'
        data-test-field='contact-members'
        class='field'
      >
        <@fields.contactMembers />
      </FieldContainer>
      <FieldContainer
        @label='Lead Members'
        data-test-field='lead-members'
        class='field'
      >
        <@fields.leadMembers />
      </FieldContainer>
    </div>
    <style>
      .campaign-members-chart-edit {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

export class CampaignMembersChart extends CardDef {
  static displayName = 'CampaignMembersChart';

  @field name = contains(StringField, {
    description: 'The campaign name',
  });
  @field chartType = contains(StringField, {
    description:
      'Chart type that will be displayed for showing sent and responded members',
  });
  @field contactMembers = containsMany(ContactMembersField, {
    description: 'Contact members of the campaign, each with response status',
  });
  @field leadMembers = containsMany(LeadMembersField, {
    description: 'Lead members of the campaign, each with response status',
  });

  static isolated = Isolated;
  static embedded = Embedded;
  static atom = Embedded;
  static edit = Edit;
}
