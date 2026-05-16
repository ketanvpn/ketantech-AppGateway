import {
  startOrderKuotaWorker,
  stopOrderKuotaWorker,
} from "../src/services/orderkuotaWorker";
import { OrderKuotaProvider } from "../src/providers/orderkuotaProvider";
import { transactionStore } from "../src/store/transactionStore";
import { settingsStore } from "../src/store/settingsStore";
import { resetDbForTests } from "../src/store/db";

describe("OrderKuota worker", () => {
  beforeEach(() => {
    resetDbForTests();
    jest.useFakeTimers();
    process.env.ORDERKUOTA_WORKER_DISABLED = "false";
    process.env.ORDERKUOTA_WORKER_INTERVAL_MS = "1000";
    jest.spyOn(OrderKuotaProvider, "fetchMutasi").mockResolvedValue({
      success: true,
      qris_history: { results: [] },
    });
  });

  afterEach(() => {
    stopOrderKuotaWorker();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.ORDERKUOTA_WORKER_DISABLED;
    delete process.env.ORDERKUOTA_WORKER_INTERVAL_MS;
  });

  it("does not call fetchMutasi when credentials are missing", async () => {
    settingsStore.setCredential("orderkuota", "username", "");
    settingsStore.setCredential("orderkuota", "authToken", "");

    startOrderKuotaWorker();
    // First tick scheduled at +1s via setTimeout
    await jest.advanceTimersByTimeAsync(1500);

    expect(OrderKuotaProvider.fetchMutasi).not.toHaveBeenCalled();
  });

  it("does not call fetchMutasi when no pending OrderKuota tx exists", async () => {
    settingsStore.setCredential("orderkuota", "username", "user");
    settingsStore.setCredential("orderkuota", "authToken", "1:tok");

    startOrderKuotaWorker();
    await jest.advanceTimersByTimeAsync(1500);

    expect(OrderKuotaProvider.fetchMutasi).not.toHaveBeenCalled();
  });

  it("calls fetchMutasi when credentials set and pending tx exists", async () => {
    settingsStore.setCredential("orderkuota", "username", "user");
    settingsStore.setCredential("orderkuota", "authToken", "1:tok");

    const now = new Date().toISOString();
    transactionStore.save({
      id: "tx-w-1",
      orderId: "ORDER-W-1",
      amount: 1000,
      currency: "IDR",
      method: "qris",
      status: "pending",
      providerName: "orderkuota",
      providerTransactionId: "OK-w-1",
      attempts: [],
      createdAt: now,
      updatedAt: now,
    });

    startOrderKuotaWorker();
    await jest.advanceTimersByTimeAsync(1500);

    expect(OrderKuotaProvider.fetchMutasi).toHaveBeenCalled();
  });

  it("respects ORDERKUOTA_WORKER_DISABLED=true", async () => {
    process.env.ORDERKUOTA_WORKER_DISABLED = "true";
    settingsStore.setCredential("orderkuota", "username", "user");
    settingsStore.setCredential("orderkuota", "authToken", "1:tok");

    const now = new Date().toISOString();
    transactionStore.save({
      id: "tx-w-2",
      orderId: "ORDER-W-2",
      amount: 1000,
      currency: "IDR",
      method: "qris",
      status: "pending",
      providerName: "orderkuota",
      providerTransactionId: "OK-w-2",
      attempts: [],
      createdAt: now,
      updatedAt: now,
    });

    startOrderKuotaWorker();
    await jest.advanceTimersByTimeAsync(2000);

    expect(OrderKuotaProvider.fetchMutasi).not.toHaveBeenCalled();
  });

  it("survives errors in tick (does not crash worker)", async () => {
    settingsStore.setCredential("orderkuota", "username", "user");
    settingsStore.setCredential("orderkuota", "authToken", "1:tok");

    const now = new Date().toISOString();
    transactionStore.save({
      id: "tx-w-3",
      orderId: "ORDER-W-3",
      amount: 1000,
      currency: "IDR",
      method: "qris",
      status: "pending",
      providerName: "orderkuota",
      providerTransactionId: "OK-w-3",
      attempts: [],
      createdAt: now,
      updatedAt: now,
    });

    // Tick selalu reject — yang kita verify: worker tidak melempar unhandled
    // rejection (kalau melempar, jest akan auto-fail).
    (OrderKuotaProvider.fetchMutasi as jest.Mock).mockRejectedValue(
      new Error("network down"),
    );

    startOrderKuotaWorker();
    // Cukup advance time supaya tick pertama jalan & error ter-catch
    await jest.advanceTimersByTimeAsync(1500);
    // Flush microtask queue supaya promise rejection handler beneran jalan
    await Promise.resolve();
    await Promise.resolve();

    // Worker kalau crash akan throw unhandled rejection di sini.
    // Sampai sini berarti error sudah berhasil ditangkap di try/catch.
    expect(OrderKuotaProvider.fetchMutasi).toHaveBeenCalled();
  });


});
