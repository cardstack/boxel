import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { BoxelInput, Button, FieldContainer } from '@cardstack/boxel-ui';
import type MatrixService from '../services/matrix-service';

export default class MatrixRegister extends Component {
  <template>
    <fieldset>
      <legend>Register User</legend>
      <FieldContainer @label='Registration Token:' @tag='label'>
        <BoxelInput
          type='text'
          @value={{this.token}}
          @onInput={{this.setToken}}
        />
      </FieldContainer>
      <FieldContainer @label='Username:' @tag='label'>
        <BoxelInput
          type='text'
          @value={{this.username}}
          @onInput={{this.setUsername}}
        />
      </FieldContainer>
      <FieldContainer @label='Password:' @tag='label'>
        <BoxelInput
          type='text'
          @value={{this.password}}
          @onInput={{this.setPassword}}
        />
      </FieldContainer>
    </fieldset>
    <Button {{on 'click' this.register}}>Register User</Button>
  </template>

  private username: string | undefined;
  private password: string | undefined;
  private token: string | undefined;
  @service declare matrixService: MatrixService;

  @action
  setToken(token: string) {
    this.token = token;
  }

  @action
  setUsername(username: string) {
    // TODO the element UI app actually checks for a used username here....
    this.username = username;
  }

  @action
  setPassword(password: string) {
    this.password = password;
  }

  @action
  register() {
    this.doRegistration.perform();
  }

  private doRegistration = restartableTask(async () => {
    try {
      await this.matrixService.client.registerRequest({
        username: this.username,
        password: this.password,
      });
    } catch (e: any) {
      // This is how matrix works, it will return MatrixErrors that
      // guide us thru a particular multi-request "flow". Probably
      // wanna turn this into a state machine. in this step we are
      // looking for data structure like:
      // {
      //   "session": "jaxufjRrQnGcDstLeMtGjttq",
      //   "flows": [
      //     {
      //       "stages": [
      //         "m.login.dummy"
      //       ]
      //     }
      //   ],
      // }

      if (
        Array.isArray(e.data.flows) &&
        e.data.flows.length > 0 &&
        e.data.session
      ) {
        let auth = await this.matrixService.client.registerRequest({
          username: this.username,
          password: this.password,
          auth: {
            session: e.data.session,
            type: e.data.flows[0].stages[0],
          },
        });
        // auth will look like this:
        // {
        //   "user_id": "@hassan1:localhost",
        //   "home_server": "localhost",
        //   "access_token": "syt_aGFzc2FuMQ_gHIZAUUiHmeaFCHTuBeX_2idMSP",
        //   "device_id": "MFABSKDIMX"
        // }
        // at this point we need to use these auth details to update
        // the matrix service with a new MatrixClient
      } else {
        throw e;
      }
    }
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface MatrixRegister {
    MatrixRegister: typeof MatrixRegister;
  }
}
