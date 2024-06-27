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
  BoxelInput,
  BoxelSelect,
  CardContainer,
  FieldContainer,
  IconButton,
  Modal,
} from '@cardstack/boxel-ui/components';
import MarkdownField from '../base/markdown';
import { CrmAccount, CrmAccountField } from './crm/account';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import {
  format as formatDate,
  isToday,
  isTomorrow,
  isThisMonth,
} from 'date-fns';
import { OpportunityFormField } from './opportunity-form';
import { LeadFormField } from './lead-form';
import { ContactFormField } from './contact-form';

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
    handleConvert: () => void;
  };
}

interface CategorySignature {
  name: string;
}

interface TaskSignature {
  taskId: string | null;
  subject: string | null;
  dueDate: Date | any;
  comments: string | null;
  isCompleted: boolean;
}

interface GroupedTasksSignature {
  month: any;
  taskId: string | null;
  subject: string | null;
  dueDate: Date | any;
  comments: string | null;
  isCompleted: boolean;
}

//*lead-form
// class IsolatedSecForLeadForm extends Component<typeof LeadForm> {
//   get getFormattedNoOfEmployees() {
//     if (!this.args.model.noOfEmployees) return null;
//     return Math.round(this.args.model.noOfEmployees);
//   }

//   <template>
//     <CardContainer @displayBoundaries={{false}} class='container'>
//       <section>
//         <div class='field-group-title'>About</div>
//         <div class='field-input-group'>
//           <div class='field-input'>
//             <label>Full Name: </label>
//             <@fields.name />
//           </div>
//           <div class='field-input'>
//             <label>Company: </label>
//             <@fields.company />
//           </div>
//           <div class='field-input'>
//             <label>Title: </label>
//             <@fields.title />
//           </div>
//           <div class='field-input'>
//             <label>Website: </label>
//             <@fields.website />
//           </div>
//           <div class='field-input'>
//             <label>Lead Status: </label>
//             <@fields.leadStatus />
//           </div>
//           <div class='field-input-column description'>
//             <label>Description: </label>
//             <@fields.description />
//           </div>
//         </div>
//       </section>

//       <section>
//         <div class='field-group-title'>Get In Touch</div>
//         <div class='field-input-group'>
//           <div class='field-input'>
//             <label>Phone Number: </label>
//             <@fields.phone />
//           </div>
//           <div class='field-input'>
//             <label>Email: </label>
//             <@fields.email />
//           </div>
//           <div class='field-input'>
//             <label>Address Info: </label>
//             <div class='address-info'>
//               <@fields.addressInfo />
//             </div>
//           </div>
//         </div>
//       </section>

//       <section>
//         <div class='field-group-title'>Segment</div>
//         <div class='field-input-group'>
//           <div class='field-input'>
//             <label>No. of Employees: </label>
//             {{this.getFormattedNoOfEmployees}}
//           </div>
//           <div class='field-input'>
//             <label>Annual Revenue: </label>
//             <@fields.annualRevenue />
//           </div>
//           <div class='field-input'>
//             <label>Lead Source: </label>
//             <@fields.leadSource />
//           </div>
//           <div class='field-input'>
//             <label>Industry: </label>
//             <@fields.industry />
//           </div>
//         </div>
//       </section>
//     </CardContainer>

//     <style>
//       .container {
//         padding: var(--boxel-sp-xl);
//         display: grid;
//         gap: var(--boxel-sp-lg);
//         overflow: hidden;
//       }
//       section {
//         overflow: hidden;
//       }
//       .description {
//         text-align: justify;
//       }
//       .field-group-title {
//         font-size: var(--boxel-font-size);
//         font-weight: 800;
//         margin-bottom: var(--boxel-sp-xs);
//       }
//       .field-input {
//         display: flex;
//         gap: var(--boxel-sp-sm);
//         font-size: var(--boxel-font-size-sm);
//         flex-wrap: wrap;
//       }
//       .field-input-group {
//         display: flex;
//         flex-direction: column;
//         justify-content: space-evenly;
//         gap: var(--boxel-sp);
//         background-color: #fbfbfb;
//         border: 1px solid var(--boxel-300);
//         border-radius: var(--boxel-border-radius);
//         padding: var(--boxel-sp);
//       }
//       .field-input-column {
//         display: flex;
//         flex-direction: column;
//         gap: var(--boxel-sp-xs);
//         font-size: var(--boxel-font-size-sm);
//         flex-wrap: wrap;
//       }
//       label {
//         font-weight: 700;
//       }
//       .address-info {
//         overflow: scroll;
//       }
//     </style>
//   </template>
// }

// class ViewSecForLeadForm extends Component<typeof LeadForm> {
//   <template>
//     <div class='container'>
//       <section>
//         <div class='field-group-title'>About</div>
//         <div class='field-input-group'>
//           <FieldContainer @tag='label' @label='User' @vertical={{true}}>
//             <@fields.name @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Company' @vertical={{true}}>
//             <@fields.company @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Title' @vertical={{true}}>
//             <@fields.title @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Website' @vertical={{true}}>
//             <@fields.website @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Description' @vertical={{true}}>
//             <@fields.description @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Lead Status' @vertical={{true}}>
//             <@fields.leadStatus @format='edit' />
//           </FieldContainer>
//         </div>
//       </section>

//       <section>
//         <div class='field-group-title'>Get In Touch</div>
//         <div class='field-input-group'>
//           <FieldContainer @tag='label' @label='Phone' @vertical={{true}}>
//             <@fields.phone @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Email' @vertical={{true}}>
//             <@fields.email @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Address' @vertical={{true}}>
//             <@fields.addressInfo @format='edit' />
//           </FieldContainer>
//         </div>
//       </section>

//       <section>
//         <div class='field-group-title'>Segment</div>
//         <div class='field-input-group'>
//           <FieldContainer
//             @tag='label'
//             @label='No. of Employees'
//             @vertical={{true}}
//           >
//             <@fields.noOfEmployees @format='edit' />
//           </FieldContainer>
//           <FieldContainer
//             @tag='label'
//             @label='Annual Revenue'
//             @vertical={{true}}
//           >
//             <@fields.annualRevenue @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Lead Source' @vertical={{true}}>
//             <@fields.leadSource @format='edit' />
//           </FieldContainer>
//           <FieldContainer @tag='label' @label='Industry' @vertical={{true}}>
//             <@fields.industry @format='edit' />
//           </FieldContainer>
//         </div>
//       </section>
//     </div>

//     <style>
//       .container {
//         display: grid;
//         gap: var(--boxel-sp-lg);
//         overflow: hidden;
//       }
//       section {
//         overflow: hidden;
//       }
//       .field-group-title {
//         font-size: var(--boxel-font-size);
//         font-weight: 800;
//         margin-bottom: var(--boxel-sp-xs);
//       }
//       .field-input-group {
//         display: flex;
//         flex-direction: column;
//         justify-content: space-evenly;
//         gap: var(--boxel-sp);
//         background-color: #fbfbfb;
//         border: 1px solid var(--boxel-300);
//         border-radius: var(--boxel-border-radius);
//         padding: var(--boxel-sp);
//       }
//     </style>
//   </template>
// }

// class EditSecFoLeadForm extends Component<typeof LeadForm> {
//   /* Lead Status Options */
//   get selectedLeadStatus() {
//     return { name: this.args.model.leadStatus || 'None' };
//   }

//   @tracked leadStatusOptions = [
//     { name: 'None' },
//     { name: 'New' },
//     { name: 'Working' },
//     { name: 'Nurturing' },
//     { name: 'Qualified' },
//     { name: 'Unqualified' },
//   ] as Array<CategorySignature>;

//   @action updateLeadStatus(type: { name: string }) {
//     this.args.model.leadStatus = type.name;
//   }

//   /* No Of Employees */
//   @action updateNoOfEmployees(val: number) {
//     this.args.model.noOfEmployees = val;
//   }

//   get getFormattedNoOfEmployees() {
//     if (!this.args.model.noOfEmployees) return null;
//     return Math.round(this.args.model.noOfEmployees);
//   }

//   /* Lead Source Options */
//   get selectedLeadSource() {
//     return { name: this.args.model.leadSource || 'None' };
//   }

//   @tracked leadSourceOptions = [
//     { name: 'None' },
//     { name: 'Advertisement' },
//     { name: 'Employee Referral' },
//     { name: 'External Referral' },
//     { name: 'Partner' },
//     { name: 'Public Relations' },
//     { name: 'Seminar - Internal' },
//     { name: 'Seminar - Partner' },
//     { name: 'Trade Show' },
//     { name: 'Web' },
//     { name: 'Word of mouth' },
//     { name: 'Other' },
//   ] as Array<CategorySignature>;

//   @action updateLeadSource(type: { name: string }) {
//     this.args.model.leadSource = type.name;
//   }

//   /* Industry Options */
//   get selectedIndustry() {
//     return { name: this.args.model.industry || 'None' };
//   }

//   @tracked industryOptions = [
//     { name: 'None' },
//     { name: 'Agriculture' },
//     { name: 'Apparel' },
//     { name: 'Banking' },
//     { name: 'Biotechnology' },
//     { name: 'Chemicals' },
//     { name: 'Communications' },
//     { name: 'Construction' },
//     { name: 'Consulting' },
//     { name: 'Education' },
//     { name: 'Electronics' },
//     { name: 'Energy' },
//     { name: 'Engineering' },
//     { name: 'Entertainment' },
//     { name: 'Environmental' },
//     { name: 'Finance' },
//     { name: 'Food & Beverage' },
//     { name: 'Government' },
//     { name: 'Healthcare' },
//     { name: 'Hospitality' },
//     { name: 'Insurance' },
//     { name: 'Machinery' },
//     { name: 'Manufacturing' },
//     { name: 'Media' },
//     { name: 'Not For Profit' },
//     { name: 'Recreation' },
//     { name: 'Retail' },
//     { name: 'Shipping' },
//     { name: 'Technology' },
//     { name: 'Telecommunications' },
//     { name: 'Transportation' },
//     { name: 'Utilities' },
//     { name: 'Others' },
//   ] as Array<CategorySignature>;

//   @action updateIndustry(type: { name: string }) {
//     this.args.model.industry = type.name;
//   }

//   <template>
//     <CardContainer @displayBoundaries={{false}} class='container'>
//       <FieldContainer @tag='label' @label='User' @vertical={{true}}>
//         <@fields.name />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Company Name' @vertical={{true}}>
//         <@fields.company />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Title' @vertical={{true}}>
//         <@fields.title />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Website' @vertical={{true}}>
//         <@fields.website />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Description' @vertical={{true}}>
//         <@fields.description />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Lead Status' @vertical={{true}}>
//         <BoxelSelect
//           @searchEnabled={{true}}
//           @searchField='name'
//           @selected={{this.selectedLeadStatus}}
//           @onChange={{this.updateLeadStatus}}
//           @options={{this.leadStatusOptions}}
//           class='select'
//           as |item|
//         >
//           <div>{{item.name}}</div>
//         </BoxelSelect>
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Phone' @vertical={{true}}>
//         <@fields.phone />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Email' @vertical={{true}}>
//         <@fields.email />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Address Info' @vertical={{true}}>
//         <@fields.addressInfo />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='No. of Employees' @vertical={{true}}>
//         <BoxelInput
//           @value={{this.args.model.noOfEmployees}}
//           @onInput={{this.updateNoOfEmployees}}
//         />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Annual Revenue' @vertical={{true}}>
//         <@fields.annualRevenue />
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Lead Source' @vertical={{true}}>
//         <BoxelSelect
//           @searchEnabled={{true}}
//           @searchField='name'
//           @selected={{this.selectedLeadSource}}
//           @onChange={{this.updateLeadSource}}
//           @options={{this.leadSourceOptions}}
//           class='select'
//           as |item|
//         >
//           <div>{{item.name}}</div>
//         </BoxelSelect>
//       </FieldContainer>

//       <FieldContainer @tag='label' @label='Industry' @vertical={{true}}>
//         <BoxelSelect
//           @searchEnabled={{true}}
//           @searchField='name'
//           @selected={{this.selectedIndustry}}
//           @onChange={{this.updateIndustry}}
//           @options={{this.industryOptions}}
//           class='select'
//           as |item|
//         >
//           <div>{{item.name}}</div>
//         </BoxelSelect>
//       </FieldContainer>

//     </CardContainer>

//     <style>
//       .container {
//         padding: var(--boxel-sp-lg);
//         display: grid;
//         gap: var(--boxel-sp);
//       }
//       .select {
//         padding: var(--boxel-sp-xs);
//         background-color: white;
//       }
//     </style>
//   </template>
// }

// class LeadForm extends FieldDef {
//   static displayName = 'Lead Form';

//   @field name = contains(UserName, {
//     description: `User's Full Name`,
//   });
//   @field company = contains(StringField, {
//     description: `User's Company Name`,
//   });
//   @field title = contains(StringField, {
//     description: `User's Title`,
//   });
//   @field website = contains(StringField, {
//     description: `User's Website`,
//   });
//   @field description = contains(MarkdownField, {
//     description: `User's Description`,
//   });
//   @field leadStatus = contains(StringField, {
//     description: `Lead Status`,
//   });
//   @field phone = contains(StringField, {
//     description: `User's phone number`,
//   });
//   @field email = contains(UserEmail, {
//     description: `User's Email`,
//   });
//   @field addressInfo = contains(AddressInfo, {
//     description: `User's AddressInfo`,
//   });
//   @field noOfEmployees = contains(NumberField, {
//     description: `No Of Employees`,
//   });
//   @field annualRevenue = contains(CurrencyAmount, {
//     description: `Annual Revenue`,
//   });
//   @field leadSource = contains(StringField, {
//     description: `Lead Source`,
//   });
//   @field industry = contains(StringField, {
//     description: `Industry`,
//   });

//   static isolated = IsolatedSecForLeadForm;
//   static atom = ViewSecForLeadForm;
//   static embedded = ViewSecForLeadForm;
//   static edit = EditSecFoLeadForm;
// }

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

//*steps
class Steps extends GlimmerComponent<StepsSignature> {
  @tracked steps = this.args.steps.map((step) => ({ ...step }));
  @tracked currentStepName = this.steps[0].name || '';
  @tracked currentStepIndex = this.steps[0].step || 0;

  get isStepCompleted() {
    return this.currentStepStatus === 'Step Completed';
  }

  get currentStepStatus() {
    if (this.currentStepIndex >= this.steps.length - 1) return 'Convert';
    if (this.steps[this.currentStepIndex].isCompleted) return 'Step Completed';
    return 'Mark Status as Complete';
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
        disabled={{this.isStepCompleted}}
        class='{{if this.isStepCompleted "button-disabled" "button"}}'
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
  }

  //task-form modal
  @tracked isTaskFormModalVisible = false;

  @action
  openTaskFormModal() {
    this.isTaskFormModalVisible = true;

    this.updateAccountFormAccountName();
    this.updateContactFormName();
    this.updateOpportunityAccountName();
  }

  @action
  closeTaskFormModal() {
    this.isTaskFormModalVisible = false;
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

      this.args.model.opportunityForm.opportunityName = `${firstName} ${company}`;
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

    if (!leadForm || !leadForm.name || !leadForm.company) return '';

    const { firstName } = leadForm.name;

    if (!firstName) return '';

    return `${firstName} ${leadForm.company}`;
  }

  //step
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
      option.isCompleted = index <= currentCompletedStep;
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
      if (a === 'Upcoming & Overdue') return -1;
      if (b === 'Upcoming & Overdue') return 1;
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
    if (date > todayDate || isToday(date))
      return formatDate(new Date(date), 'MMMM yyyy');
    return 'Upcoming & Overdue';
  }

  @action formatDay(date: Date) {
    const todayDate = new Date();
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
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

    <div class='sale-hub-container'>
      <aside class='left-panel'>
        <section class='leadForm-panel'>
          {{#if @model.leadForm}}
            <@fields.leadForm @format='edit' />
          {{/if}}

        </section>
      </aside>

      <main class='center-panel'>
        <section class='progress-tab-panel'>
          <Steps
            @steps={{this.stepOptions}}
            @updateLeadStatus={{this.updateLeadStatus}}
            @handleConvert={{this.handleConvert}}
          />
        </section>

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
        <section class='relationship-tab-panel'>

        </section>
      </aside>

    </div>

    <style>
      .container {
        padding: var(--boxel-sp);
      }
      .input-container {
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
      }
      .sale-hub-container {
        padding: var(--boxel-sp-xs);
        overflow: hidden;
        display: grid;
        grid-template-columns: 2fr 5fr 2fr;
        gap: var(--boxel-sp);
        background-color: #007272;
      }
      .left-panel {
        overflow-x: hidden;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
      }
      .center-panel {
        overflow-x: hidden;
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
      }
      .right-panel {
        overflow-x: hidden;
        display: grid;
        gap: var(--boxel-sp);
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
      .relationship-tab-panel {
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
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
        margin-top: 2rem;
      }
    </style>
  </template>
}

export class SaleHub extends CardDef {
  static displayName = 'sale hub';
  @field leadForm = contains(LeadFormField);
  @field accountForm = contains(CrmAccountField);
  @field contactForm = contains(ContactFormField);
  @field opportunityForm = contains(OpportunityFormField);
  @field scheduledTask = containsMany(ScheduledTask);
  static isolated = IsolatedSecForSaleHub;
}
