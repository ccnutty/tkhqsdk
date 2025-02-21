import type { WalletInterface } from "@turnkey/wallet-stamper";

import { type TurnkeyWalletClientConfig, AuthClient } from "@types";
import { TurnkeyBrowserClient } from "@browser-client";

export class TurnkeyWalletClient extends TurnkeyBrowserClient {
  private wallet: WalletInterface;

  constructor(config: TurnkeyWalletClientConfig) {
    super(config, AuthClient.Wallet);
    this.wallet = config.wallet;
  }

  async getPublicKey(): Promise<string> {
    return this.wallet.getPublicKey();
  }

  getWalletInterface(): WalletInterface {
    return this.wallet;
  }
}
