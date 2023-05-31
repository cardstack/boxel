import { tracked } from '@glimmer/tracking';
import { Resource } from 'ember-resources/core';
import { enqueueTask, restartableTask } from 'ember-concurrency';

// window is a global object that is available in this resource
declare global {
  interface Window {
    ethereum: any;
  }
}

const METAMASK_ERROR_CODES = {
  user_rejected: 4001,
  unknown_chain: 4902,
};

class MetaMaskResource extends Resource {
  @tracked connected = false;
  @tracked chainId = -1; // the chain id of the metamask connection (not the card)

  setup() {
    this.doInitialize.perform();
    if (this.isMetamaskInstalled()) {
      window.ethereum.on('chainChanged', this.handleChainChanged.bind(this));
    }
    return this;
  }

  private doInitialize = enqueueTask(async () => {
    if (this.isMetamaskInstalled()) {
      let chainId = this.getChainId();
      let connected = await this.isMetamaskConnected();
      this.chainId = chainId;
      this.connected = connected;
    }
  });

  teardown() {
    this.doInitialize.cancelAll();
    this.doConnectMetamask.cancelAll();
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
    } catch (e) {
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
        return -1;
      }
      let hexChainId = window.ethereum.chainId;
      return parseInt(hexChainId, 16);
    } catch (e) {
      return -1;
    }
  }

  isSameNetwork(chainId: number) {
    let metamaskChainId = this.getChainId();
    return chainId == metamaskChainId;
  }

  handleChainChanged(hexChainId: string) {
    this.chainId = parseInt(hexChainId, 16);
  }

  doConnectMetamask = restartableTask(async (chainId: number) => {
    try {
      let isSameNetwork = this.isSameNetwork(chainId);
      if (!isSameNetwork) {
        let hexChainId = '0x' + chainId.toString(16);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
        this.chainId = chainId;
      }
      const isMetamaskConnected = await this.isMetamaskConnected();
      this.connected = isMetamaskConnected;
    } catch (e) {
      if (e.code === METAMASK_ERROR_CODES.user_rejected) {
        return;
      } else if (e.code === METAMASK_ERROR_CODES.unknown_chain) {
        console.log(
          `Unknown chain id ${chainId}. Need to add chain to metamask`
        );
      } else {
        console.log(e);
      }
    }
  });
}

export default MetaMaskResource;
