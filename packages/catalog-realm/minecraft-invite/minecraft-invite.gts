import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { dayjsFormat } from '@cardstack/boxel-ui/helpers';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import TextAreaField from 'https://cardstack.com/base/text-area';
import UrlField from 'https://cardstack.com/base/url';

export class MinecraftInvite extends CardDef {
  static displayName = 'Minecraft Invite';

  @field celebrantName = contains(StringField);
  @field age = contains(StringField);
  @field date = contains(DateField);
  @field time = contains(StringField);
  @field location = contains(StringField);
  @field details = contains(TextAreaField);
  @field rsvpContact = contains(StringField);
  @field backgroundImage = contains(UrlField);

  static isolated = class Isolated extends Component<typeof MinecraftInvite> {
    <template>
      <div
        class='minecraft-invite'
        style={{htmlSafe
          (concat "background-image: url('" @model.backgroundImage "')")
        }}
        data-test-minecraft-invite
      >
        <div class='invite-content'>
          <div class='pixel-border'>
            <div class='header'>
              <h1 class='game-font'>LET'S MINE & CRAFT!</h1>
            </div>

            <div class='celebrate-section'>
              <span class='game-font'>YOU'RE INVITED TO</span>
              <h2 class='celebrant game-font'>{{@model.celebrantName}}'s</h2>
              <div class='age-block'>
                <span class='age game-font'>{{@model.age}}</span>
                <span class='birthday game-font'>BIRTHDAY PARTY!</span>
              </div>
            </div>

            <div class='details-section'>
              <div class='detail-row'>
                <div class='detail-icon date-icon'></div>
                <div class='detail-text'>
                  <span class='game-font'>Date:</span>
                  <span class='game-font'>{{dayjsFormat
                      @model.date
                      'MMMM D, YYYY'
                    }}</span>
                </div>
              </div>

              <div class='detail-row'>
                <div class='detail-icon time-icon'></div>
                <div class='detail-text'>
                  <span class='game-font'>Time:</span>
                  <span class='game-font'>{{@model.time}}</span>
                </div>
              </div>

              <div class='detail-row'>
                <div class='detail-icon location-icon'></div>
                <div class='detail-text'>
                  <span class='game-font'>Location:</span>
                  <span class='game-font'>{{@model.location}}</span>
                </div>
              </div>
            </div>

            <div class='message-section'>
              <p class='game-font'>{{@model.details}}</p>
            </div>

            <div class='rsvp-section'>
              <h3 class='game-font'>RSVP</h3>
              <p class='game-font'>{{@model.rsvpContact}}</p>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        @import url('https://fonts.googleapis.com/css2?family=VT323&family=Press+Start+2P&family=Silkscreen:wght@400;700&display=swap');

        .minecraft-invite {
          position: relative;
          font-family: 'VT323', monospace;
          font-size: 18px; /* Increased base font size */
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          min-height: 600px;
          color: #fff;
          text-align: center;
          padding: 20px;
        }

        .invite-content {
          padding: 20px;
          max-width: 600px;
          margin: 0 auto;
        }

        .pixel-border {
          border: 8px solid #000;
          box-shadow:
            0 0 0 4px #555,
            0 0 0 8px #000;
          background: rgba(74, 74, 74, 0.8);
          padding: 24px;
          position: relative;
        }

        .game-font {
          font-family: 'Silkscreen', 'VT323', 'Press Start 2P', monospace;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 1px;
          line-height: 1.2;
          text-shadow: 2px 2px 0 #000;
        }

        /* Import pixel fonts via @import */
        @import url('https://fonts.googleapis.com/css2?family=VT323&family=Press+Start+2P&display=swap');

        .header {
          margin-bottom: 25px;
        }

        h1 {
          font-size: 32px;
          color: #55dd55;
          margin: 0;
        }

        .celebrate-section {
          margin-bottom: 30px;
        }

        .celebrant {
          font-size: 42px;
          color: #ffff55;
          margin: 10px 0;
        }

        .age-block {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          margin: 15px 0;
        }

        .age {
          font-size: 42px;
          color: #ff5555;
          background: #222;
          padding: 5px 15px;
          border: 4px solid #333;
        }

        .birthday {
          font-size: 28px;
          color: #55ffff;
        }

        .details-section {
          border: 4px solid #333;
          background: rgba(0, 0, 0, 0.5);
          padding: 15px;
          margin-bottom: 25px;
          text-align: left;
        }

        .detail-row {
          display: flex;
          align-items: center;
          margin: 10px 0;
        }

        .detail-icon {
          width: 32px;
          height: 32px;
          margin-right: 15px;
          background-color: #55dd55;
        }

        .detail-text {
          display: flex;
          flex-direction: column;
        }

        .message-section {
          margin-bottom: 25px;
          background: rgba(0, 0, 0, 0.3);
          padding: 15px;
          border: 2px solid #444;
        }

        .rsvp-section {
          background: rgba(0, 0, 0, 0.5);
          padding: 15px;
          border-top: 4px solid #555;
        }

        h3 {
          color: #5555ff;
          margin-top: 0;
        }

        .date-icon {
          background-color: #ffff55;
        }

        .time-icon {
          background-color: #55ffff;
        }

        .location-icon {
          background-color: #ff5555;
        }

        @media (max-width: 600px) {
          .pixel-border {
            padding: 15px;
          }
          h1 {
            font-size: 28px;
          }
          .celebrant {
            font-size: 32px;
          }
          .age {
            font-size: 32px;
          }
          .birthday {
            font-size: 22px;
          }
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof MinecraftInvite> {
    <template>
      <div class='minecraft-edit'>
        <div class='edit-field'>
          <label class='game-font'>Celebrant's Name</label>
          <@fields.celebrantName />
        </div>

        <div class='edit-field'>
          <label class='game-font'>Age</label>
          <@fields.age />
        </div>

        <div class='edit-field'>
          <label class='game-font'>Date</label>
          <@fields.date />
        </div>

        <div class='edit-field'>
          <label class='game-font'>Time</label>
          <@fields.time />
        </div>

        <div class='edit-field'>
          <label class='game-font'>Location</label>
          <@fields.location />
        </div>

        <div class='edit-field'>
          <label class='game-font'>Party Details</label>
          <@fields.details />
        </div>

        <div class='edit-field'>
          <label class='game-font'>RSVP Contact</label>
          <@fields.rsvpContact />
        </div>

        <div class='edit-field'>
          <label class='game-font'>Background Image URL (Optional)</label>
          <@fields.backgroundImage />
        </div>
      </div>

      <style scoped>
        .minecraft-edit {
          padding: 20px;
          background: #333;
          color: white;
          font-family: sans-serif;
        }

        .edit-field {
          margin-bottom: 20px;
        }

        label {
          display: block;
          margin-bottom: 5px;
          color: #55dd55;
        }

        .game-font {
          font-family: monospace;
          font-weight: bold;
          letter-spacing: 1px;
        }
      </style>
    </template>
  };
}
