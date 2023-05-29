import { tracked } from '@glimmer/tracking';
import { Resource } from 'ember-resources/core';
import { enqueueTask, restartableTask } from 'ember-concurrency';

// window is a global object that is available in this resource
declare global {
  interface Window {
    ethereum: any;
  }
}

interface CardArgs {
  named: {
    chainId: number | undefined;
  };
}

class MetaMaskResource extends Resource<CardArgs> {
  @tracked state = {
    connected: false,
    chainId: -1,
  };

  setup() {
    this.doInitialize.perform();
    return this;
  }

  private doInitialize = enqueueTask(async () => {
    if (this.isMetamaskInstalled()) {
      let chainId = this.getChainId();
      let connected = await this.isMetamaskConnected();
      this.state = { chainId, connected };
    }
  });

  teardown() {
    this.doInitialize.cancelAll();
  }

  ready(cardArgs: CardArgs) {
    return cardArgs.named.chainId == this.state.chainId && this.state.connected;
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
      return false;
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

  doConnectMetamask = restartableTask(async (chainId: number) => {
    try {
      let isSameNetwork = this.isSameNetwork(chainId);
      if (!isSameNetwork) {
        let hexChainId = '0x' + chainId.toString(16);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
        this.state.chainId = chainId;
      }
      const isMetamaskConnected = await this.isMetamaskConnected();
      this.state.connected = isMetamaskConnected;
    } catch (e) {
      console.log(e);
    }
  });
}

export default MetaMaskResource;
