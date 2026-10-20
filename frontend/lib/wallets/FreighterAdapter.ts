import { WalletAdapter, FreighterError } from "./types";
import { t } from "@/lib/i18n";

interface Freighter {
  connect(): Promise<{ publicKey: string }>;
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  signTransaction(
    transaction: string
  ): Promise<{ signedTransaction: string }>;
  disconnect(): Promise<void>;
}

declare global {
  interface Window {
    freighter?: Freighter;
  }
}

export class FreighterAdapter implements WalletAdapter {
  id = "freighter";
  name = "Freighter";

  isAvailable(): boolean {
    return typeof window !== "undefined" && !!window.freighter;
  }

  async isConnected(): Promise<boolean> {
    const freighter = window.freighter;
    if (!freighter) return false;
    try {
      return await freighter.isConnected();
    } catch {
      return false;
    }
  }

  async connect(): Promise<string> {
    const freighter = window.freighter;
    if (!freighter) {
      throw new Error(t("nav.noWallet"));
    }
    try {
      const { publicKey } = await freighter.connect();
      return publicKey;
    } catch (cause) {
      if (cause instanceof Error) {
        throw new Error(cause.message);
      }
      throw new Error(t("nav.refused"));
    }
  }

  disconnect(): void {
    const freighter = window.freighter;
    if (freighter && typeof freighter.disconnect === "function") {
      freighter.disconnect().catch(() => {});
    }
  }

  async signTransaction(transaction: string): Promise<string> {
    const freighter = window.freighter;
    if (!freighter) {
      throw new Error(t("nav.noWallet"));
    }
    try {
      const { signedTransaction } = await freighter.signTransaction(
        transaction
      );
      return signedTransaction;
    } catch (cause) {
      if (cause instanceof Error) {
        throw new Error(cause.message);
      }
      throw new Error(t("nav.refused"));
    }
  }
}
