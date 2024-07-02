import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import DateCard from 'https://cardstack.com/base/date';
import { Component } from 'https://cardstack.com/base/card-api';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { IconX } from '@cardstack/boxel-ui/icons';
import GlimmerComponent from '@glimmer/component';
import {
  BoxelSelect,
  Button,
  CardContainer,
  FieldContainer,
  GridContainer,
  IconButton,
  Modal,
} from '@cardstack/boxel-ui/components';
import MarkdownField from '../base/markdown';
import { CrmAccount } from './crm/account';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import {
  format as formatDate,
  isToday,
  isTomorrow,
  isThisMonth,
} from 'date-fns';
import { OpportunityForm } from './opportunity-form';
import { LeadForm } from './lead-form';
import { ContactForm } from './contact-form';
import { MatrixUser } from './matrix-user';
import { eq } from '@cardstack/boxel-ui/helpers';
import { AccountForm } from './account-form';
import type Owner from '@ember/owner';

interface TargetPageLinkSingnature {
  name: string;
  isActive: boolean;
  shouldShowFormData: boolean;
}

interface TargetPageLinksSignature {
  Element: HTMLElement;
  Args: {
    targetPageLinks: TargetPageLinkSingnature[];
    targetPage: string | undefined;
    onSelectPage: (val: string) => void;
  };
}

interface StepSignature {
  step: number;
  name: string;
  isActive: boolean;
  isCompleted: boolean;
  isProceedToNextStep: boolean;
}

interface StepsSignature {
  Element: HTMLElement;
  Args: {
    steps: StepSignature[];
    updateLeadStatus: (arg0: string) => void;
    isLeadFormConverted: boolean | undefined;
    handleConvert: () => void;
  };
}

interface CategorySignature {
  name: string;
}

// interface TaskSignature {
//   taskId: string | null;
//   subject: string | null;
//   dueDate: Date | any;
//   comments: string | null;
//   isCompleted: boolean;
// }

interface GroupedTasksSignature {
  month: any;
  taskId: string | null;
  subject: string | null;
  dueDate: Date | any;
  comments: string | null;
  isCompleted: boolean;
}

//*task-form
class TaskForm extends FieldDef {
  static displayName = 'Task Form';

  @field taskId = contains(StringField, {
    description: `Task Id`,
  });
  @field subject = contains(StringField, {
    description: `Subject`,
  });
  @field dueDate = contains(DateCard, {
    description: `Due Date`,
  });
  @field comments = contains(MarkdownField, {
    description: `Comments`,
  });
  @field relatedTo = linksTo(CrmAccount, {
    description: `Related to Crm Account`,
  });
  @field isCompleted = contains(BooleanField, {
    description: `Is Task Completed`,
  });
}

//*Target Page Links
class TargetPageLinks extends GlimmerComponent<TargetPageLinksSignature> {
  <template>
    <div class='targetPageLinks'>
      {{#each this.args.targetPageLinks as |pageLink|}}
        <div
          class={{concat (if pageLink.isActive 'active ') 'pageLink'}}
          {{on 'click' (fn this.args.onSelectPage pageLink.name)}}
        >
          {{pageLink.name}}</div>
      {{/each}}
    </div>
    <style>
      .targetPageLinks {
        display: flex;
        gap: var(--boxel-sp);
        overflow-x: auto;
      }
      .pageLink {
        color: var(--boxel-200);
        cursor: pointer;
        margin-bottom: 0.5rem;
        white-space: nowrap;
      }
      .pageLink.active {
        color: white;
        font-weight: bold;
        text-decoration: underline;
      }
    </style>
  </template>
}

//*steps
class Steps extends GlimmerComponent<StepsSignature> {
  @tracked steps = this.args.steps.map((step) => {
    return { ...step, isCompleted: this.args.isLeadFormConverted };
  });
  @tracked currentStepName = this.steps[0].name || '';
  @tracked currentStepIndex = this.steps[0].step || 0;

  get isStepCompleted() {
    return this.currentStepStatus === 'Step Completed';
  }

  get currentStepStatus() {
    if (this.currentStepIndex >= this.steps.length - 1) {
      if (this.args.isLeadFormConverted) return 'Converted';
      return 'Convert';
    }
    if (this.steps[this.currentStepIndex].isCompleted) return 'Step Completed';
    return 'Mark Status as Complete';
  }

  get shouldDisableClick() {
    return this.isStepCompleted || this.args.isLeadFormConverted;
  }

  @action
  handleOnStepClick(clickedStep: number) {
    this.currentStepIndex = clickedStep;
    this.currentStepName = this.steps[this.currentStepIndex].name;

    this.steps = this.steps.map((step, index) => {
      return { ...step, isActive: index === clickedStep };
    });
  }

  @action handleCompleteStep() {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.steps = this.steps.map((step, index) => {
        return {
          ...step,
          isCompleted: index <= this.currentStepIndex,
          isProceedToNextStep: index === this.currentStepIndex + 1,
        };
      });
    }

    this.args.updateLeadStatus(this.currentStepName);
  }

  @action
  handleButtonClick() {
    if (this.currentStepStatus === 'Convert') {
      this.args.handleConvert();
    } else {
      this.handleCompleteStep();
    }
  }

  <template>
    <div class='steps'>
      {{#each this.steps as |step|}}
        <div
          class={{concat
            (if step.isCompleted 'completed ')
            (if step.isActive 'active ')
            (if step.isProceedToNextStep 'proceedToNextStep ')
            'step'
          }}
          {{on 'click' (fn this.handleOnStepClick step.step)}}
        >
          {{step.name}}</div>
      {{/each}}
    </div>
    <div class='step-panel'>
      <div class='step-status'>
        Status:
        {{this.currentStepName}}
      </div>

      <button
        {{on 'click' this.handleButtonClick}}
        disabled={{this.shouldDisableClick}}
        class='{{if this.shouldDisableClick "button-disabled" "button"}}'
      >
        {{this.currentStepStatus}}
      </button>

    </div>
    <style>
      .steps {
        display: flex;
        overflow-x: auto;
        gap: var(--boxel-sp-xxs);
        text-align: center;
      }
      .steps > .step {
        display: flex;
        flex: 0 0 auto;
        width: auto;
        min-width: 120px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-sm);
        cursor: pointer;
        font-weight: 600;
        position: relative;
        background-color: var(--boxel-100);
        border: 2px solid var(--boxel-200);
      }
      .steps > .step:hover {
        background-color: var(--boxel-dark-teal);
      }
      .steps > .step > .label-index {
        border-radius: 100%;
        width: 30px;
        height: 30px;
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: var(--boxel-200);
      }
      .steps > .step.active {
        background-color: var(--boxel-dark-teal);
        color: var(--boxel-light);
      }

      .steps > .step.completed {
        background-color: var(--boxel-dark-teal);
        color: var(--boxel-light);
      }
      .steps > .step.proceedToNextStep {
        border-color: #0a7a77;
      }

      .steps > .step.active > .label-index {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
      }
      .step-panel {
        background-color: var(--boxel-light);
        margin-top: var(--boxel-sp-sm);
      }
      .step-panel > * + * {
        margin-top: var(--boxel-sp-sm);
      }
      .step-status {
        background-color: var(--boxel-100);
        border: 1px solid #eeeeee;
        text-align: center;
        padding: var(--boxel-sp-lg) var(--boxel-sp-sm);
      }
      .button {
        display: table;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.25rem;
        font-weight: 500;
        padding: var(--boxel-sp-xxs) var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        border: 1px solid white;
        box-shadow: none;
        background-color: var(--boxel-blue);
        color: white;
        margin-inline: auto;
      }
      .button-disabled {
        display: table;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.25rem;
        font-weight: 500;
        padding: var(--boxel-sp-xxs) var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        border: 1px solid white;
        box-shadow: none;
        background-color: var(--boxel-400);
        color: white;
        margin-inline: auto;
      }
    </style>
  </template>
}

//*scheduled task
class ScheduledTask extends FieldDef {
  static displayName = 'Scheduled Task';
  @field taskForm = contains(TaskForm);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.taskForm @format='edit' />
    </template>
  };
}

class IsolatedSecForSaleHub extends Component<typeof SaleHub> {
  //convert lead-form Modal
  @tracked isModalVisible = false;

  @action
  toggleModal() {
    this.isModalVisible = !this.isModalVisible;
  }

  @action
  openModal() {
    this.isModalVisible = true;
  }

  @action
  closeModal() {
    this.isModalVisible = false;
  }

  @action
  handleConvert() {
    this.openModal();
    this.updateAccountFormAccountName();
    this.updateContactFormName();
    this.updateOpportunityAccountName();
  }

  //task-form modal
  @tracked isTaskFormModalVisible = false;

  @action
  openTaskFormModal() {
    this.isTaskFormModalVisible = true;
  }

  @action
  closeTaskFormModal() {
    this.isTaskFormModalVisible = false;
  }

  //account-form
  constructor(owner: Owner, args: any) {
    super(owner, args);
    if (!this.args.model.leadForm || !this.args.model.isLeadFormConverted)
      return;

    const { salutation, firstName, lastName } = this.args.model.leadForm.name;

    if (this.args.model.accountForm) {
      this.args.model.accountForm.accountName = `${salutation} ${firstName} ${lastName}`;
    }

    if (this.args.model.contactForm) {
      this.args.model.contactForm.name.salutation = salutation;
      this.args.model.contactForm.name.firstName = firstName;
      this.args.model.contactForm.name.lastName = lastName;
    }

    if (this.args.model.opportunityForm) {
      const company = this.args.model.leadForm.company;
      this.args.model.opportunityForm.companyName = `${firstName} ${company}`;
    }
  }

  //auto bind form
  @action
  updateAccountFormAccountName() {
    if (
      this.args.model &&
      this.args.model.accountForm &&
      this.args.model.leadForm
    ) {
      const { salutation, firstName, lastName } = this.args.model.leadForm.name;

      this.args.model.accountForm.accountName = `${salutation} ${firstName} ${lastName}`;
    }
  }

  @action
  updateContactFormName() {
    if (
      this.args.model &&
      this.args.model.contactForm &&
      this.args.model.leadForm
    ) {
      const salutation = this.args.model.leadForm.name.salutation;
      const firstName = this.args.model.leadForm.name.firstName;
      const lastName = this.args.model.leadForm.name.lastName;

      this.args.model.contactForm.name.salutation = salutation;
      this.args.model.contactForm.name.firstName = firstName;
      this.args.model.contactForm.name.lastName = lastName;
    }
  }

  @action
  updateOpportunityAccountName() {
    if (
      this.args.model &&
      this.args.model.opportunityForm &&
      this.args.model.leadForm
    ) {
      const firstName = this.args.model.leadForm.name.firstName;
      const company = this.args.model.leadForm.company;

      this.args.model.opportunityForm.companyName = `${firstName} ${company}`;
    }
  }

  get accountFormAccountName() {
    const { leadForm } = this.args.model;
    if (!leadForm || !leadForm.name) return '';
    const { salutation, firstName, lastName } = leadForm.name;

    if (!salutation || !firstName || !lastName) return '';
    return `${salutation} ${firstName} ${lastName}`;
  }

  get contactFormAccountName() {
    const { leadForm } = this.args.model;
    if (!leadForm || !leadForm.name) return '';
    const { salutation, firstName, lastName } = leadForm.name;

    if (!salutation || !firstName || !lastName) return '';
    return `${salutation} ${firstName} ${lastName}`;
  }

  get opportunityFormName() {
    const { leadForm } = this.args.model;
    if (!leadForm || !leadForm.company) return '';
    const { firstName } = leadForm.name;

    if (!firstName) return '';
    return `${firstName} ${leadForm.company}`;
  }

  //targetPageLinks
  @tracked initTargetPageLinks = [
    {
      name: 'Lead Form',
      isActive: true,
      shouldShowFormData: true,
    },
    {
      name: 'Account Form',
      isActive: false,
      shouldShowFormData: false,
    },
    {
      name: 'Contact Form',
      isActive: false,
      shouldShowFormData: false,
    },
    {
      name: 'Opportunity Form',
      isActive: false,
      shouldShowFormData: false,
    },
  ] as Array<TargetPageLinkSingnature>;

  get targetPageLinks() {
    return this.initTargetPageLinks.map((page) => {
      return { ...page, isActive: page.name === this.targetPage };
    });
  }

  get targetPage() {
    console.log(this.args.model.contactForm);
    return this.args.model.targetPage;
  }

  @action onSelectPage(name: string) {
    this.args.model.targetPage = name;

    this.initTargetPageLinks = this.initTargetPageLinks.map((page) => {
      return {
        ...page,
        isActive: page.name === name,
      };
    });
  }

  //steps
  @tracked initStepOptions = [
    {
      step: 0,
      name: 'New',
      isActive: true,
      isCompleted: false,
      isProceedToNextStep: false,
    },
    {
      step: 1,
      name: 'Working',
      isActive: false,
      isCompleted: false,
      isProceedToNextStep: false,
    },
    {
      step: 2,
      name: 'Nurturing',
      isActive: false,
      isCompleted: false,
      isProceedToNextStep: false,
    },
    {
      step: 3,
      name: 'Unqualified',
      isActive: false,
      isCompleted: false,
      isProceedToNextStep: false,
    },
    {
      step: 4,
      name: 'Converted',
      isActive: false,
      isCompleted: false,
      isProceedToNextStep: false,
    },
  ] as Array<StepSignature>;

  get stepOptions() {
    let currentCompletedStep = this.initStepOptions.findIndex(
      (option) => option.name === this.args.model.leadForm?.leadStatus,
    );

    this.initStepOptions.forEach((option, index) => {
      option.isCompleted =
        index <= currentCompletedStep ||
        this.args.model.leadForm?.leadStatus === 'Qualified';
      option.isProceedToNextStep = index === currentCompletedStep + 1;
    });

    return this.initStepOptions;
  }

  @action updateLeadStatus(status: string) {
    if (!(this.args.model.leadForm && this.args.model.leadForm.leadStatus))
      return;

    this.args.model.leadForm.leadStatus = status;
  }

  //upcoming task list
  get tasks() {
    if (!this.args.model.scheduledTask) return [];

    const mapTasks = this.args.model.scheduledTask.map((task) => {
      return {
        month: task.taskForm.dueDate
          ? this.formatDueDate(task.taskForm.dueDate)
          : null,
        taskId: task.taskForm.taskId,
        subject: task.taskForm.subject,
        dueDate: task.taskForm.dueDate,
        comments: task.taskForm.comments,
        isCompleted: task.taskForm.isCompleted,
      };
    });
    return mapTasks;
  }

  get groupedTasks() {
    if (!this.tasks) return;

    const groupedTasks: { [key: string]: GroupedTasksSignature[] } =
      this.tasks.reduce((acc: any, task: GroupedTasksSignature) => {
        if (!acc[task.month]) {
          acc[task.month] = [];
        }
        acc[task.month].push(task);
        return acc;
      }, {});

    const sortedMonths = Object.keys(groupedTasks).sort((a, b) => {
      if (a === 'Upcoming') return -1;
      if (b === 'Overdue') return 1;
      return new Date(a).getTime() - new Date(b).getTime();
    });

    const sortedGroupedTasks: any = sortedMonths.reduce(
      (acc: any, month: string) => {
        acc[month] = groupedTasks[month].sort(
          (a, b) =>
            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
        );
        return acc;
      },
      {},
    );

    return sortedGroupedTasks;
  }

  @action formatDueDate(date: Date) {
    const todayDate = new Date();

    if (isToday(date)) return formatDate(new Date(date), 'MMMM yyyy');
    if (date > todayDate) return 'Upcoming';
    return 'Overdue';
  }

  @action formatDay(date: Date) {
    const todayDate = new Date();
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    if (date > todayDate || isTomorrow(date))
      return formatDate(new Date(date), 'dd/MM/yyyy');
    if (date < todayDate) return null;
    if (isThisMonth(date)) return 'This Month';
    return null;
  }

  @action toggleOnCheckTask(taskIdChecked: string) {
    this.args.model.scheduledTask = this.args.model.scheduledTask?.map(
      (task) => {
        task.taskForm.taskId === taskIdChecked
          ? (task.taskForm.isCompleted = !task.taskForm.isCompleted)
          : task.taskForm.isCompleted;

        return task;
      },
    );

    return this.args.model.scheduledTask;
  }

  /* Converted Status Options */
  get selectedConvertedStatus() {
    return {
      name:
        this.args.model.convertedStatus ||
        this.convertedStatusOptions[0].name ||
        'None',
    };
  }

  @tracked convertedStatusOptions = [
    { name: 'Qualified' },
    { name: 'Unqualified' },
  ] as Array<CategorySignature>;

  @action updateConvertedStatus(type: { name: string }) {
    this.args.model.convertedStatus = type.name;

    if (this.args.model.leadForm) {
      this.args.model.leadForm.leadStatus = type.name;
    }
  }

  @action cancel() {
    this.args.model.isLeadFormConverted =
      this.args.model.isLeadFormConverted || false;

    this.closeModal();
  }

  @action convert() {
    this.args.model.isLeadFormConverted = true;
    this.closeModal();
  }

  //if else condition
  get shouldShowLeadForm() {
    return !!this.args.model.leadForm ? true : false;
  }

  get shouldShowAccountForm() {
    return !!this.args.model.accountForm ? true : false;
  }

  get shouldShowContactForm() {
    return !!this.args.model.contactForm ? true : false;
  }

  get shouldShowOpportunityForm() {
    return !!this.args.model.opportunityForm ? true : false;
  }

  <template>
    <Modal
      @size={{'large'}}
      @isOpen={{this.isModalVisible}}
      @onClose={{this.closeModal}}
      class='dialog-box'
    >
      <CardContainer class='container'>
        <IconButton
          @icon={{IconX}}
          @width='12'
          @height='12'
          {{on 'click' this.closeModal}}
          class='dialog-box__close'
          aria-label='close modal'
        />
        <h1>Convert Lead Form</h1>

        <div class='formInputGroup'>
          <FieldContainer
            @tag='label'
            @label='Account Form'
            @vertical={{true}}
            class='input-container'
          >
            {{this.accountFormAccountName}}
          </FieldContainer>

          <FieldContainer
            @tag='label'
            @label='Contact Form'
            @vertical={{true}}
            class='input-container'
          >
            {{this.contactFormAccountName}}
          </FieldContainer>

          <FieldContainer
            @tag='label'
            @label='Opportunity Form'
            @vertical={{true}}
            class='input-container'
          >
            {{this.opportunityFormName}}
          </FieldContainer>

          <FieldContainer
            @tag='label'
            @label='*Record Owner'
            @vertical={{true}}
          >
            <@fields.recordOwner @format='edit' />
          </FieldContainer>

          <FieldContainer @tag='label' @label='Lead Status' @vertical={{true}}>
            <BoxelSelect
              @searchEnabled={{true}}
              @searchField='name'
              @selected={{this.selectedConvertedStatus}}
              @onChange={{this.updateConvertedStatus}}
              @options={{this.convertedStatusOptions}}
              class='select'
              as |item|
            >
              <div>{{item.name}}</div>
            </BoxelSelect>
          </FieldContainer>

          <GridContainer class='footer'>
            <Button
              data-test-cancel
              {{on 'click' this.cancel}}
              @kind='secondary'
              @size='tall'
            >cancel</Button>

            <Button
              data-test-convert
              {{on 'click' this.convert}}
              @kind='primary'
              @size='tall'
            >convert</Button>
          </GridContainer>
        </div>

      </CardContainer>
    </Modal>
    <Modal
      @size={{'large'}}
      @isOpen={{this.isTaskFormModalVisible}}
      @onClose={{this.closeTaskFormModal}}
      class='dialog'
    >
      <CardContainer class='container'>
        <IconButton
          @icon={{IconX}}
          @width='12'
          @height='12'
          {{on 'click' this.closeTaskFormModal}}
          class='dialog-box__close'
          aria-label='close modal'
        />
        <div class='dialog-box'>
          <@fields.scheduledTask @format='edit' />
        </div>
      </CardContainer>
    </Modal>

    <div class='sale-hub'>
      <section>
        <TargetPageLinks
          @targetPageLinks={{this.targetPageLinks}}
          @targetPage={{this.args.model.targetPage}}
          @onSelectPage={{this.onSelectPage}}
        />
      </section>

      <section class='sale-hub-container'>
        <aside class='left-panel'>

          {{#if (eq this.args.model.targetPage 'Lead Form')}}
            {{#if this.shouldShowLeadForm}}
              <section>
                {{! *this have bug, if linkTo in isolated mode is empty, the page will cause error }}
                <@fields.leadForm />
              </section>
            {{else}}
              <section>
                <p>Lead form data is missing or invalid.</p>
              </section>
            {{/if}}
          {{/if}}

          {{#if (eq this.args.model.targetPage 'Account Form')}}
            {{#if this.shouldShowAccountForm}}
              <section>
                <@fields.accountForm />
              </section>
            {{else}}
              <section>
                <p>Account form data is missing or invalid.</p>
              </section>
            {{/if}}
          {{/if}}

          {{#if (eq this.args.model.targetPage 'Contact Form')}}
            {{#if this.shouldShowContactForm}}
              <section>
                <@fields.contactForm />
              </section>
            {{else}}
              <section>
                <p>Contact form data is missing or invalid.</p>
              </section>
            {{/if}}
          {{/if}}

          {{#if (eq this.args.model.targetPage 'Opportunity Form')}}
            {{#if this.shouldShowOpportunityForm}}
              <section>
                <@fields.opportunityForm />
              </section>
            {{else}}
              <section>
                <p>Opportunity form data is missing or invalid.</p>
              </section>
            {{/if}}
          {{/if}}

        </aside>

        <main class='center-panel'>

          {{#if (eq this.args.model.targetPage 'Lead Form')}}
            {{#if this.shouldShowLeadForm}}
              <section class='progress-tab-panel'>
                <Steps
                  @steps={{this.stepOptions}}
                  @isLeadFormConverted={{this.args.model.isLeadFormConverted}}
                  @updateLeadStatus={{this.updateLeadStatus}}
                  @handleConvert={{this.handleConvert}}
                />
              </section>
            {{/if}}
          {{/if}}

          <section class='activity-panel'>
            <div class='activity-button-group'>
              <button class='button'>
                New Event
              </button>
              <button class='button' {{on 'click' this.openTaskFormModal}}>
                New Task
              </button>
            </div>

            <hr style='border: 1px dashed #eeeeee; margin: 1rem 0px;' />
            <div class='activity-lists'>

              {{#if this.args.model.scheduledTask}}
                {{#each-in this.groupedTasks as |month tasks|}}
                  <div class='sub-heading'>
                    <span>{{month}}</span>
                  </div>

                  <div>
                    {{#each tasks as |task|}}
                      <div class='checkbox-card'>
                        <label class='checkbox-label'>
                          <input
                            type='checkbox'
                            checked={{task.isCompleted}}
                            {{on
                              'change'
                              (fn this.toggleOnCheckTask task.taskId)
                            }}
                          />
                          <span class={{if task.isCompleted 'line-through'}}>You
                            had an event/a task -
                            {{task.subject}}</span>
                        </label>

                        <span class='dueDate'>{{this.formatDay
                            task.dueDate
                          }}</span>
                      </div>
                    {{/each}}
                  </div>
                {{/each-in}}

              {{else}}
                <div class='sub-heading'>
                  Upcoming & Overdue
                </div>
                <div style='text-align:center;'>
                  No activites to show.<br />
                  Get started by sending an email, scheduling a task, and more.
                </div>
              {{/if}}

            </div>

          </section>
        </main>

        <aside class='right-panel'>
          <section>
            {{#if (eq this.args.model.targetPage 'Account Form')}}
              {{#if this.shouldShowAccountForm}}
                {{#if this.shouldShowContactForm}}
                  <section>
                    {{! only show required field on contactform embedded mode}}
                    <h3>Contact Form</h3>
                    <@fields.contactForm />
                  </section>
                {{/if}}

                {{#if this.shouldShowOpportunityForm}}
                  <section>
                    {{! only show required field on opportunityForm embedded mode}}
                    <h3>Opportunity Form</h3>
                    <@fields.opportunityForm />
                  </section>
                {{/if}}
              {{/if}}
            {{/if}}

            {{#if (eq this.args.model.targetPage 'Contact Form')}}
              {{#if this.shouldShowContactForm}}
                {{#if this.shouldShowOpportunityForm}}
                  <section>
                    {{! only show required field on opportunityForm embedded mode}}
                    <h3>Opportunity Form</h3>
                    <@fields.opportunityForm />
                  </section>
                {{/if}}
              {{/if}}
            {{/if}}

            {{#if (eq this.args.model.targetPage 'Opportunity Form')}}
              {{#if this.shouldShowContactForm}}
                <section>
                  {{! only show required field on contactform embedded mode}}
                  <h3>Contact Form</h3>
                  <@fields.contactForm />
                </section>
              {{/if}}
            {{/if}}
          </section>
        </aside>
      </section>
    </div>

    <style>
      .container {
        padding: var(--boxel-sp);
      }
      .input-container {
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
      }
      .sale-hub {
        padding: var(--boxel-sp-xs);
        background-color: #007272;
        height: 100vh;
        overflow: scroll;
      }
      .target-pages-tab {
        display: flex;
        gap: var(--boxel-sp-xxs);
        overflow-x: auto;
      }
      .sale-hub-container {
        overflow: hidden;
        display: grid;
        grid-template-columns: 2fr 4fr 2fr;
        gap: var(--boxel-sp);
        background-color: #007272;
      }
      .left-panel {
        overflow: auto;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
      }
      .center-panel {
        overflow: hidden;
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
      }
      .right-panel {
        overflow: auto;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
      }
      .progress-tab-panel {
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
      }
      .activity-panel {
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
        overflow-x: hidden;
      }
      .activity-button-group {
        display: flex;
        gap: var(--boxel-sp-xxs);
        overflow-x: auto;
      }
      .activity-lists {
        margin-top: 1rem;
      }
      .activity-lists > * + * {
        margin-top: 1rem;
      }
      .activity-list {
        padding: var(--boxel-sp-xs);
      }
      .sub-heading {
        display: flex;
        align-items: start;
        justify-content: space-between;

        font-weight: bold;
        padding: var(--boxel-sp-xxs);
        background-color: var(--boxel-200);
      }

      .button {
        display: flex;
        flex: 0 0 auto;
        width: auto;
        min-width: 120px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-sm);
        cursor: pointer;
        font-weight: 600;
        position: relative;
        background-color: var(--boxel-100);
        border: 2px solid var(--boxel-200);
      }
      .button:hover {
        background-color: var(--boxel-200);
      }
      .button-save {
        width: 100%;
        background-color: var(--boxel-dark-teal);
        border: 2px solid var(--boxel-200);
        color: white;
        padding: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        cursor: pointer;
      }
      .dialog-box {
        max-height: 80vh;
        overflow: overlay;
      }
      .line-through {
        text-decoration: line-through;
      }
      .checkbox-card {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .dueDate {
        color: var(--boxel-red);
      }
      .formInputGroup > * + * {
        margin-top: 1.5rem;
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: end;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

export class SaleHub extends CardDef {
  static displayName = 'sale hub';

  @field targetPage = contains(StringField, {
    description: `Show which page is clicked`,
  });
  @field leadForm = linksTo(LeadForm, {
    description: `Lead form`,
  });
  @field accountForm = linksTo(AccountForm, {
    description: `Account Form`,
  });
  @field contactForm = linksTo(ContactForm, {
    description: `Contact Form`,
  });
  @field opportunityForm = linksTo(OpportunityForm, {
    description: `Opportunity Form`,
  });
  @field scheduledTask = containsMany(ScheduledTask, {
    description: `Upcoming & overdue tasks`,
  });
  @field recordOwner = linksTo(MatrixUser, {
    description: `Record owner`,
  });
  @field convertedStatus = contains(StringField, {
    description: `Converted Status`,
  });
  @field isLeadFormConverted = contains(BooleanField, {
    description: `Check if leadForm is converted`,
  });

  static isolated = IsolatedSecForSaleHub;
}
