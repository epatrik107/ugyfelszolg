import { beforeEach, describe, expect, it, vi } from "vitest";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  claimInvoiceProcessing: vi.fn(),
  getInvoiceRetryCandidates: vi.fn(),
  getOrderById: vi.fn(),
  markInvoiceAttemptFailed: vi.fn(),
  persistCreatedInvoice: vi.fn(),
  buildSzamlazzPayload: vi.fn(),
  issueSzamlazzInvoice: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  claimInvoiceProcessing: mocks.claimInvoiceProcessing,
  getInvoiceRetryCandidates: mocks.getInvoiceRetryCandidates,
  getOrderById: mocks.getOrderById,
  markInvoiceAttemptFailed: mocks.markInvoiceAttemptFailed,
  persistCreatedInvoice: mocks.persistCreatedInvoice,
}));
vi.mock("../src/lib/szamlazz", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/szamlazz")>();
  return {
    ...original,
    buildSzamlazzPayload: mocks.buildSzamlazzPayload,
    issueSzamlazzInvoice: mocks.issueSzamlazzInvoice,
  };
});

const { processInvoiceForOrder } = await import("../src/lib/invoice");
const { InvoiceProviderError } = await import("../src/lib/szamlazz");

describe("idempotent invoice processing pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const claimed = orderFixture({
      payment_status: "paid",
      paid_at: "2026-06-22T10:00:00.000Z",
      invoice_status: "processing",
      invoice_retry_count: 1,
    });
    mocks.claimInvoiceProcessing.mockResolvedValue(claimed);
    mocks.getOrderById.mockResolvedValue({ ...claimed, invoice_status: "created" });
    mocks.buildSzamlazzPayload.mockReturnValue({ externalId: "order_1" });
    mocks.issueSzamlazzInvoice.mockResolvedValue({
      invoiceNumber: "E-TST-2026-1",
      externalId: "order_1",
      pdfUrl: "https://www.szamlazz.hu/invoice/test",
      alreadyExisted: false,
    });
    mocks.persistCreatedInvoice.mockResolvedValue(undefined);
    mocks.markInvoiceAttemptFailed.mockResolvedValue("retry_required");
  });

  it("issues and persists exactly one invoice after an atomic claim", async () => {
    const status = await processInvoiceForOrder(
      { SZAMLAZZ_AGENT_KEY: "test-agent-key" } as never,
      "order_1",
    );
    expect(status).toBe("created");
    expect(mocks.issueSzamlazzInvoice).toHaveBeenCalledOnce();
    expect(mocks.persistCreatedInvoice).toHaveBeenCalledOnce();
    expect(mocks.persistCreatedInvoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "order_1" }),
      expect.objectContaining({
        invoiceNumber: "E-TST-2026-1",
        status: "created",
      }),
    );
  });

  it("does not call the provider when another webhook already owns or completed the claim", async () => {
    mocks.claimInvoiceProcessing.mockResolvedValue(null);
    mocks.getOrderById.mockResolvedValue(orderFixture({ invoice_status: "created" }));
    await expect(
      processInvoiceForOrder({ SZAMLAZZ_AGENT_KEY: "test-agent-key" } as never, "order_1"),
    ).resolves.toBe("created");
    expect(mocks.issueSzamlazzInvoice).not.toHaveBeenCalled();
    expect(mocks.persistCreatedInvoice).not.toHaveBeenCalled();
  });

  it("records a retry-required state on a transient provider failure", async () => {
    mocks.issueSzamlazzInvoice.mockRejectedValue(
      new InvoiceProviderError("HTTP_503", true, "Átmeneti számlázási hiba."),
    );
    await expect(
      processInvoiceForOrder({ SZAMLAZZ_AGENT_KEY: "test-agent-key" } as never, "order_1"),
    ).resolves.toBe("retry_required");
    expect(mocks.markInvoiceAttemptFailed).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      expect.objectContaining({
        retryable: true,
        errorCode: "HTTP_503",
        retryCount: 1,
      }),
    );
  });

  it("marks invalid billing as non-retryable and never persists an invoice", async () => {
    mocks.buildSzamlazzPayload.mockImplementation(() => {
      throw new InvoiceProviderError("INVALID_BILLING_DATA", false, "Hiányos számlázási adatok.");
    });
    mocks.markInvoiceAttemptFailed.mockResolvedValue("failed");
    await expect(
      processInvoiceForOrder({ SZAMLAZZ_AGENT_KEY: "test-agent-key" } as never, "order_1"),
    ).resolves.toBe("failed");
    expect(mocks.issueSzamlazzInvoice).not.toHaveBeenCalled();
    expect(mocks.persistCreatedInvoice).not.toHaveBeenCalled();
    expect(mocks.markInvoiceAttemptFailed).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      expect.objectContaining({ retryable: false, errorCode: "INVALID_BILLING_DATA" }),
    );
  });

  it("reconciles a retry by external id and stores already_created instead of issuing twice", async () => {
    const retryOrder = orderFixture({
      payment_status: "paid",
      paid_at: "2026-06-22T10:00:00.000Z",
      invoice_status: "processing",
      invoice_retry_count: 2,
    });
    mocks.claimInvoiceProcessing.mockResolvedValue(retryOrder);
    mocks.getOrderById.mockResolvedValue({ ...retryOrder, invoice_status: "already_created" });
    mocks.issueSzamlazzInvoice.mockResolvedValue({
      invoiceNumber: "E-TST-2026-1",
      externalId: "order_1",
      pdfUrl: null,
      alreadyExisted: true,
    });
    await expect(
      processInvoiceForOrder({ SZAMLAZZ_AGENT_KEY: "test-agent-key" } as never, "order_1"),
    ).resolves.toBe("already_created");
    expect(mocks.issueSzamlazzInvoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
    );
    expect(mocks.persistCreatedInvoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: "already_created" }),
    );
  });
});
