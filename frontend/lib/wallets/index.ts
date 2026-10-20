import { FreighterAdapter } from "./FreighterAdapter";
import { WalletAdapter } from "./types";

export { FreighterAdapter };
export type { WalletAdapter };

export function getAvailableWallets(): WalletAdapter[] {
  const adapters = [new FreighterAdapter()];
  return adapters.filter((adapter) => adapter.isAvailable());
}

export function getWalletAdapter(id: string): WalletAdapter | null {
  const adapters = [new FreighterAdapter()];
  const adapter = adapters.find((a) => a.id === id);
  return adapter && adapter.isAvailable() ? adapter : null;
}
