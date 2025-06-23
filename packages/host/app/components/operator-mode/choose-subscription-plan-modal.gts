import { fn } from '@ember/helper';

import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import ModalContainer from '../modal-container';

interface Signature {
  Element: HTMLButtonElement;
}

export default class ChooseSubscriptionPlanModal extends Component<Signature> {
  <template>
    <style scoped>
      /* You may want to add a font import, e.g., from Google Fonts */
      /* @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap'); */

      .boxel-pricing-container {
        /* font-family: 'Poppins', sans-serif; */
        font-family:
          -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
          Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji',
          'Segoe UI Symbol';
        color: #111827; /* Darker gray for better readability than pure black */
        background-color: #fff;
        padding: 2rem 1rem;
        max-width: 1200px;
        margin: 0 auto;
      }

      .main-title {
        font-size: clamp(2.5rem, 5vw, 4rem);
        font-weight: 700;
        text-align: center;
        color: #000;
        margin-bottom: 2rem;
      }

      .early-preview-banner {
        background-color: #d9ff8a;
        border: 1.5px solid #000;
        border-radius: 8px;
        padding: 0.75rem 1.5rem;
        font-size: 1.125rem;
        font-weight: 500;
        text-align: center;
        max-width: 600px;
        margin: 0 auto 1.5rem auto;
      }

      .intro-text {
        text-align: center;
        max-width: 700px;
        margin: 0 auto 3rem auto;
        line-height: 1.6;
        font-size: 1rem;
      }

      .subscription-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .subscription-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }

      .subscription-title h2 {
        font-size: clamp(1.8rem, 4vw, 2.5rem);
        font-weight: 600;
        color: #000;
        margin: 0;
      }

      .subscription-header p {
        font-size: 1.125rem;
        color: #4b5563; /* Gray text */
        margin: 0;
      }

      /* --- Mobile First Layout (Stacked Cards) --- */
      .pricing-table {
        border-top: 1px solid #e5e7eb;
        padding-top: 2rem;
      }
      .feature-labels-column {
        display: none; /* Hide labels on mobile */
      }

      .plan-column {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        overflow: hidden;
        margin-bottom: 2rem;
        background-color: #fff;
      }
      .plan-column.plan-free {
        background-color: #f9fafb;
      }

      .plan-header {
        padding: 2rem;
        text-align: center;
      }
      .plan-column.plan-free .plan-header {
        background-color: #f9fafb;
      }
      .plan-header:not(.plan-free *) {
        background-color: #fff;
      }

      .plan-name {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
      }
      .plan-price {
        font-size: 3rem;
        font-weight: 700;
        color: #000;
        line-height: 1;
      }
      .plan-period {
        color: #6b7280;
        margin-bottom: 1.5rem;
      }

      .btn {
        display: inline-block;
        padding: 0.75rem 2rem;
        border-radius: 50px;
        text-decoration: none;
        font-weight: 600;
        transition: transform 0.2s ease;
      }
      .btn:hover {
        transform: scale(1.05);
      }
      .btn-teal {
        background-color: #00f0b5;
        color: #000;
      }
      .btn-dark {
        background-color: #000;
        color: #fff;
      }

      .feature-cell {
        padding: 1rem 1.5rem;
        font-weight: 500;
        text-align: center;
      }
      .feature-cell:not(:last-child) {
        border-bottom: 1px solid #e5e7eb;
      }

      /* Use data-attribute to show labels on mobile */
      .feature-cell::before {
        content: attr(data-label);
        display: block;
        font-weight: 500;
        color: #111827;
        margin-bottom: 0.5rem;
        text-align: center;
      }
      .feature-cell .credit-value {
        margin-top: 0.5rem;
      }

      .credit-value {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        font-size: 1.25rem;
        font-weight: 600;
      }
      .feature-note {
        color: #6b7280;
        font-size: 0.875rem;
        margin-top: 0.25rem;
      }

      /* --- Footer --- */
      .footer-notes {
        text-align: center;
        margin-top: 1rem;
        color: #6b7280;
        line-height: 1.6;
      }
      .footer-notes p {
        margin: 0.5rem 0;
      }
      .footer-notes .highlight {
        background-color: #d9ff8a;
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
        color: #1f2937;
        font-weight: 500;
      }

      /* --- Desktop Layout (min-width: 992px) --- */
      @media (min-width: 992px) {
        .pricing-table {
          display: flex;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding-top: 0;
          overflow: hidden;
        }

        .feature-labels-column {
          display: block; /* Show the labels column */
          flex: 1 1 25%;
          background-color: #fff;
        }

        .plan-column {
          flex: 1 1 25%;
          border: none;
          border-radius: 0;
          margin-bottom: 0;
        }
        .plan-column:not(:first-of-type) {
          border-left: 1px solid #e5e7eb;
        }

        .plan-header {
          background-color: #f9fafb;
          min-height: 255px; /* Align headers */
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        /* Hide the data-attribute labels on desktop */
        .feature-cell::before {
          display: none;
        }
        .feature-cell {
          min-height: 120px; /* Align rows */
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .label-cell {
          min-height: 120px; /* Match feature cell height */
          padding: 1.5rem;
          font-weight: 600;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .label-cell:not(.is-header) {
          border-top: 1px solid #e5e7eb;
        }
        .label-cell.is-header {
          min-height: 255px; /* Match plan header height */
        }
        .label-cell .sub-label {
          font-weight: 400;
          color: #6b7280;
        }

        .credit-value {
          font-size: 1.5rem;
        }
      }
    </style>

    <ModalContainer
      @title='Choose Subscription Plan'
      @size='large'
      @isOpen={{@isModalOpen}}
      @onClose={{@onClose}}
      @cardContainerClass='choose-subscription-plan'
      class='choose-subscription-plan-modal'
      data-test-choose-subscription-plan-modal
    >

      <:content>
        <div class='boxel-pricing-container'>
          <h1 class='main-title'>Boxel Pricing</h1>

          <p class='early-preview-banner'>
            Access to the Boxel Web App is free during early preview.
          </p>

          <p class='intro-text'>
            To use the included AI features, you need to have Boxel Credits in
            your account. Starter plan includes 1,000 credit per month. To get
            more credits, you can subscribe to a monthly plan or buy credit
            packs.
          </p>

          <div class='subscription-header'>
            <div class='subscription-title'>
              <!-- Calendar Icon SVG -->
              <svg
                width='40'
                height='40'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
                stroke='currentColor'
                stroke-width='1.5'
                stroke-linecap='round'
                stroke-linejoin='round'
              >
                <rect x='3' y='4' width='18' height='18' rx='2' ry='2'></rect>
                <line x1='16' y1='2' x2='16' y2='6'></line>
                <line x1='8' y1='2' x2='8' y2='6'></line>
                <line x1='3' y1='10' x2='21' y2='10'></line>
                <path d='M12 14v4m-2-2h4'></path>
              </svg>
              <h2>Monthly Subscription</h2>
            </div>
            <p>Subscribe to get your Boxel Credit account topped up at every
              month</p>
          </div>

          <div class='pricing-table'>
            <!-- Feature Labels Column (for desktop view) -->
            <div class='feature-labels-column'>
              <div class='label-cell is-header'></div>
              <!-- Spacer -->
              <div class='label-cell'>
                Boxel Credits
                <span class='sub-label'>(For AI Generation)</span>
              </div>
              <div class='label-cell'>Workspaces</div>
              <div class='label-cell'>Cloud Storage</div>
              <div class='label-cell'>Boxel Web App</div>
            </div>

            <div class='plan-column plan-free'>
              <div class='plan-header'>
                <h3 class='plan-name'>Starter</h3>
                <div class='plan-price'>$0</div>
                <div class='plan-period'>per month</div>
                <a href='#' class='btn btn-teal'>Get Started</a>
              </div>
              <div
                class='feature-cell'
                data-label='Boxel Credits (For AI Generation)'
              >
                <div class='credit-value'>
                  <svg
                    width='20'
                    height='20'
                    viewBox='0 0 24 24'
                    fill='#00F0B5'
                    xmlns='http://www.w3.org/2000/svg'
                  ><path
                      d='M21 8.66V15.34C21 16.22 20.22 17 19.34 17H13.17C12.59 17 12.04 16.71 11.72 16.22L8.6 11.07C8.28 10.58 8.28 9.92 8.6 9.43L11.72 4.28C12.04 3.79 12.59 3.5 13.17 3.5H19.34C20.22 3.5 21 4.28 21 5.16V8.66Z'
                    ></path><path
                      d='M3 8.66V15.34C3 16.22 3.78 17 4.66 17H10.83C11.41 17 11.96 16.71 12.28 16.22L15.4 11.07C15.72 10.58 15.72 9.92 15.4 9.43L12.28 4.28C11.96 3.79 11.41 3.5 10.83 3.5H4.66C3.78 3.5 3 4.28 3 5.16V8.66Z'
                    ></path></svg>
                  1,000
                </div>
                <div class='feature-note'>Monthly Boxel Credit</div>
              </div>
              <div class='feature-cell' data-label='Workspaces'>Up to 10</div>
              <div class='feature-cell' data-label='Cloud Storage'>500 MB</div>
              <div
                class='feature-cell'
                data-label='Boxel Web App'
              >Included</div>
            </div>

            <!-- Creator Plan Column -->
            <div class='plan-column plan-creator'>
              <div class='plan-header'>
                <h3 class='plan-name'>Creator</h3>
                <div class='plan-price'>$12</div>
                <div class='plan-period'>per month</div>
                <a href='#' class='btn btn-dark'>Get Started</a>
              </div>
              <div
                class='feature-cell'
                data-label='Boxel Credits (For AI Generation)'
              >
                <div class='credit-value'>
                  <svg
                    width='20'
                    height='20'
                    viewBox='0 0 24 24'
                    fill='#00F0B5'
                    xmlns='http://www.w3.org/2000/svg'
                  ><path
                      d='M21 8.66V15.34C21 16.22 20.22 17 19.34 17H13.17C12.59 17 12.04 16.71 11.72 16.22L8.6 11.07C8.28 10.58 8.28 9.92 8.6 9.43L11.72 4.28C12.04 3.79 12.59 3.5 13.17 3.5H19.34C20.22 3.5 21 4.28 21 5.16V8.66Z'
                    ></path><path
                      d='M3 8.66V15.34C3 16.22 3.78 17 4.66 17H10.83C11.41 17 11.96 16.71 12.28 16.22L15.4 11.07C15.72 10.58 15.72 9.92 15.4 9.43L12.28 4.28C11.96 3.79 11.41 3.5 10.83 3.5H4.66C3.78 3.5 3 4.28 3 5.16V8.66Z'
                    ></path></svg>
                  5,000
                </div>
                <div class='feature-note'>Monthly Boxel Credit</div>
              </div>
              <div class='feature-cell' data-label='Workspaces'>Up to 25</div>
              <div class='feature-cell' data-label='Cloud Storage'>5 GB</div>
              <div
                class='feature-cell'
                data-label='Boxel Web App'
              >Included</div>
            </div>

            <!-- Power User Plan Column -->
            <div class='plan-column plan-power'>
              <div class='plan-header'>
                <h3 class='plan-name'>Power User</h3>
                <div class='plan-price'>$49</div>
                <div class='plan-period'>per month</div>
                <a href='#' class='btn btn-dark'>Get Started</a>
              </div>
              <div
                class='feature-cell'
                data-label='Boxel Credits (For AI Generation)'
              >
                <div class='credit-value'>
                  <svg
                    width='20'
                    height='20'
                    viewBox='0 0 24 24'
                    fill='#00F0B5'
                    xmlns='http://www.w3.org/2000/svg'
                  ><path
                      d='M21 8.66V15.34C21 16.22 20.22 17 19.34 17H13.17C12.59 17 12.04 16.71 11.72 16.22L8.6 11.07C8.28 10.58 8.28 9.92 8.6 9.43L11.72 4.28C12.04 3.79 12.59 3.5 13.17 3.5H19.34C20.22 3.5 21 4.28 21 5.16V8.66Z'
                    ></path><path
                      d='M3 8.66V15.34C3 16.22 3.78 17 4.66 17H10.83C11.41 17 11.96 16.71 12.28 16.22L15.4 11.07C15.72 10.58 15.72 9.92 15.4 9.43L12.28 4.28C11.96 3.79 11.41 3.5 10.83 3.5H4.66C3.78 3.5 3 4.28 3 5.16V8.66Z'
                    ></path></svg>
                  25,000
                </div>
                <div class='feature-note'>Monthly Boxel Credit</div>
              </div>
              <div class='feature-cell' data-label='Workspaces'>Up to 150</div>
              <div class='feature-cell' data-label='Cloud Storage'>20 GB</div>
              <div
                class='feature-cell'
                data-label='Boxel Web App'
              >Included</div>
            </div>

          </div>

          <div class='footer-notes'>
            <p><span class='highlight'>You need to provide a valid credit card
                to register and obtain free Boxel Credits.</span></p>
            <p>Your card will not be charged unless you choose to upgrade or buy
              more credits.</p>
            <p>Unused monthly Boxel Credits do not roll over.</p>
          </div>
        </div>
      </:content>
    </ModalContainer>
  </template>
}
