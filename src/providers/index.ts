import { PaymentProvider, ProviderName } from "../types";
import { MidtransProvider } from "./midtransProvider";
import { XenditProvider } from "./xenditProvider";
import { DokuProvider } from "./dokuProvider";
import { TripayProvider } from "./tripayProvider";
import { OrderKuotaProvider } from "./orderkuotaProvider";
import { settingsStore } from "../store/settingsStore";

const registry: Record<ProviderName, PaymentProvider> = {
  midtrans: new MidtransProvider(),
  xendit: new XenditProvider(),
  doku: new DokuProvider(),
  tripay: new TripayProvider(),
  orderkuota: new OrderKuotaProvider(),
};

/** Daftar semua provider yang tersedia (untuk dashboard, dokumentasi, dll.) */
export const ALL_PROVIDER_NAMES: ProviderName[] = [
  "midtrans",
  "xendit",
  "doku",
  "tripay",
  "orderkuota",
];

/**
 * Return provider list sesuai urutan prioritas dari settingsStore (runtime).
 * Provider pertama = primary, sisanya = fallback.
 */
export function getOrderedProviders(): PaymentProvider[] {
  const ordered: PaymentProvider[] = [];
  for (const name of settingsStore.providerOrder) {
    const p = registry[name];
    if (p) ordered.push(p);
  }
  if (ordered.length === 0) {
    return ALL_PROVIDER_NAMES.map((n) => registry[n]);
  }
  return ordered;
}

export function getProvider(name: ProviderName): PaymentProvider | undefined {
  return registry[name];
}
