import { tracked } from '@glimmer/tracking';
import { Resource } from 'ember-resources';
// @ts-ignore
import { enqueueTask, restartableTask } from 'ember-concurrency';
// @ts-ignore
import { registerDestructor } from '@ember/destroyable';

declare global {
  interface Window {
    ethereum: any;
    FastBoot?: any;
  }
}

const METAMASK_ERROR_CODES = {
  user_rejected: 4001,
  unknown_chain: 4902,
};

class MetamaskResource extends Resource {
  @tracked connected = false;
  @tracked chainId: number | undefined; // the chain id of the metamask connection (not the card)

  constructor(owner: unknown) {
    super(owner);
    this.promptMetamaskInstallation();
    this.setup();
  }

  setup() {
    this.doInitialize.perform();
    if (this.isMetamaskInstalled()) {
      window.ethereum.on('chainChanged', this.handleChainChanged);
      registerDestructor(this, () => {
        window.ethereum.removeAllListeners();
        this.doInitialize.cancelAll();
      });
    }
  }

  promptMetamaskInstallation() {
    if (!window.FastBoot && !this.isMetamaskInstalled()) {
      // Only log this when inside the browser
      console.log(
        'Metamask is not installed. Please install it to use this resource',
      );
    }
  }

  isMetamaskInstalled() {
    return typeof window.ethereum !== 'undefined';
  }

  async isMetamaskConnected() {
    try {
      if (!this.isMetamaskInstalled()) {
        return false;
      }
      let accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });
      return accounts.length > 0;
    } catch (e: any) {
      if (e.code === METAMASK_ERROR_CODES.user_rejected) {
        return false;
      } else {
        throw e;
      }
    }
  }

  getChainId() {
    try {
      if (!this.isMetamaskInstalled()) {
        return;
      }
      let hexChainId = window.ethereum.chainId;
      return parseInt(hexChainId, 16);
    } catch (e) {
      return;
    }
  }

  isSameNetwork(chainId: number) {
    let metamaskChainId = this.getChainId();
    return metamaskChainId ? chainId == metamaskChainId : false;
  }

  handleChainChanged = (hexChainId: string) => {
    this.chainId = parseInt(hexChainId, 16);
  };

  private doInitialize = enqueueTask(async () => {
    if (this.isMetamaskInstalled()) {
      let connected = await this.isMetamaskConnected();
      this.chainId = this.getChainId();
      this.connected = connected;
    }
  });

  doConnectMetamask = restartableTask(async (chainId: number) => {
    // intentionally, didn't teardown this task because
    // it will be bad user experience if task is closed after chain id changed
    try {
      let isSameNetwork = this.isSameNetwork(chainId);
      if (!isSameNetwork) {
        let hexChainId = '0x' + chainId.toString(16);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
        this.chainId = chainId;
        this.connected = true;
        return;
      }
      this.connected = await this.isMetamaskConnected();
    } catch (e: any) {
      if (e.code === METAMASK_ERROR_CODES.user_rejected) {
        return;
      } else if (e.code === METAMASK_ERROR_CODES.unknown_chain) {
        throw new Error(
          `Unknown chain id ${chainId}. Need to add chain to metamask`,
        );
      } else {
        throw e;
      }
    }
  });
}

export function getMetamaskResource(parent: object, arrowFn: () => void) {
  return MetamaskResource.from(parent, arrowFn) as MetamaskResource;
}
