import { z } from 'zod';
import {
  loyaltyHistorySchema,
  type AdjustLoyaltyRequest,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationSchema,
  platformFeatureFlagListSchema,
  tenantFeatureSchema,
  unreadCountSchema,
  type ListNotificationsQuery,
  type NotificationPreferences,
  type SetTenantFeatureRequest,
  type UpdateFeatureFlagRequest,
  platformAuditPageSchema,
  platformOverviewSchema,
  platformPlanListSchema,
  platformPlanSchema,
  platformSessionSchema,
  platformTenantDetailSchema,
  platformTenantPageSchema,
  platformTenantSummarySchema,
  platformUserSchema,
  type ChangePlanRequest,
  type CloseTenantRequest,
  type CreatePlanRequest,
  type ExtendSubscriptionRequest,
  type ListPlatformTenantsQuery,
  type ManualPaymentRequest,
  type PlatformAuditQuery,
  type PlatformLoginRequest,
  type TenantActionRequest,
  type UpdatePlanRequest,
  billingOverviewSchema,
  checkoutResponseSchema,
  subscriptionSchema,
  type CheckoutRequest,
  deviceListSchema,
  deviceSchema,
  invitationPreviewSchema,
  invitationSchema,
  staffListSchema,
  staffMemberSchema,
  type AcceptInvitationRequest,
  type CreateInvitationRequest,
  type RegisterDeviceRequest,
  type UpdateStaffRequest,
} from '@pos/contracts';
import {
  acceptedResponseSchema,
  auditLogPageSchema,
  branchListSchema,
  goodsReceiptPageSchema,
  goodsReceiptSchema,
  purchaseOrderPageSchema,
  purchaseOrderSchema,
  stockAdjustmentPageSchema,
  stockAdjustmentSchema,
  stockCountPageSchema,
  stockCountSchema,
  stockMovementPageSchema,
  stockPageSchema,
  stockTransferPageSchema,
  stockTransferSchema,
  supplierPageSchema,
  supplierSchema,
  type CreateGoodsReceiptRequest,
  type CreatePurchaseOrderRequest,
  type CreateStockAdjustmentRequest,
  type CreateStockCountRequest,
  type CreateStockTransferRequest,
  type CreateSupplierRequest,
  type ListDocumentsQuery,
  type ListMovementsQuery,
  type ListStockQuery,
  type UpdatePurchaseOrderRequest,
  type UpdateStockCountRequest,
  type UpdateSupplierRequest,
  categoryListSchema,
  categorySchema,
  productImportResultSchema,
  productPageSchema,
  productSchema,
  variantLookupSchema,
  type CreateCategoryRequest,
  type CreateProductRequest,
  type CreateVariantRequest,
  type ListProductsQuery,
  type ProductImportRequest,
  type UpdateCategoryRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
  branchSchema,
  businessProfilePresetsSchema,
  registerSchema,
  tenantSettingsSchema,
  type CreateBranchRequest,
  type CreateRegisterRequest,
  type UpdateBranchRequest,
  type UpdateRegisterRequest,
  type UpdateTenantSettingsRequest,
  authContextSchema,
  authSessionResponseSchema,
  CSRF_HEADER,
  errorResponseSchema,
  loginResponseSchema,
  tenantSummarySchema,
  type ClientType,
  type CompleteOnboardingRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type CloseShiftRequest,
  type CreateSaleRequest,
  type CreateTaxRateRequest,
  currentShiftResponseSchema,
  type ListSalesQuery,
  type ListShiftsQuery,
  type OpenShiftRequest,
  receiptSchema,
  salePageSchema,
  saleSchema,
  shiftPageSchema,
  shiftSchema,
  taxRateListSchema,
  taxRateSchema,
  type UpdateTaxRateRequest,
  approvalPinStatusSchema,
  approverListSchema,
  type CreateCashMovementRequest,
  type CreateReturnRequest,
  type ListReturnsQuery,
  saleReturnPageSchema,
  saleReturnSchema,
  type SetApprovalPinRequest,
  type VoidSaleRequest,
  type CatalogSyncQuery,
  catalogSyncPageSchema,
  type ListConflictsQuery,
  type ResolveConflictRequest,
  saleConflictPageSchema,
  saleConflictSchema,
  type CreateCustomerPaymentRequest,
  type CreateCustomerRequest,
  customerPageSchema,
  customerPaymentSchema,
  campaignPageSchema,
  campaignSchema,
  consentHistorySchema,
  type CreateCampaignRequest,
  messagingStatusSchema,
  unsubscribeInfoSchema,
  customerSchema,
  type ListCustomersQuery,
  type StatementQuery,
  statementSchema,
  type UpdateCustomerRequest,
  dashboardSchema,
  type ProfitReportQuery,
  profitReportSchema,
  receivablesReportSchema,
  type ReportRangeQuery,
  type SalesReportQuery,
  salesReportSchema,
  stockValuationSchema,
  taxReportSchema,
} from '@pos/contracts';
import { ApiError } from './api-error';

export interface ApiClientOptions {
  /** Base URL including the version prefix, e.g. `/api/v1` or `https://api.example.com/api/v1`. */
  baseUrl: string;
  clientType: ClientType;
  getAccessToken: () => string | null;
  /**
   * Obtains a new access token after a 401 (e.g. by calling `auth.refresh`).
   * Return null when the session cannot be renewed; the original error is then thrown.
   */
  renewAccessToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions<S extends z.ZodType> {
  schema: S;
  body?: unknown;
  query?: Query;
  /** Attach the bearer token and retry once after renewal. Default true. */
  authenticated?: boolean;
}

export function createApiClient(options: ApiClientOptions) {
  // Resolved per call so polyfills or test stubs installed after creation are honoured.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  let renewal: Promise<string | null> | null = null;

  // Concurrent 401s share one renewal so a rotated refresh token is never replayed.
  function renewOnce(): Promise<string | null> {
    if (!options.renewAccessToken) return Promise.resolve(null);
    renewal ??= options.renewAccessToken().finally(() => {
      renewal = null;
    });
    return renewal;
  }

  async function send(
    method: string,
    path: string,
    body: unknown,
    query: Query | undefined,
    token: string | null,
  ) {
    const url = new URL(options.baseUrl + path, 'http://placeholder.invalid');
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const isAbsolute = /^https?:\/\//.test(options.baseUrl);
    const target = isAbsolute ? url.toString() : url.pathname + url.search;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      [CSRF_HEADER]: options.clientType.toLowerCase(),
    };
    // Multipart uploads: the runtime sets the Content-Type with its boundary.
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      return await doFetch(target, {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
        credentials: options.clientType === 'WEB' ? 'include' : 'omit',
      });
    } catch (_error) {
      throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
    }
  }

  async function toError(response: Response): Promise<ApiError> {
    const payload: unknown = await response.json().catch(() => null);
    const parsed = errorResponseSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, issues, requestId } = parsed.data.error;
      return new ApiError(response.status, code, message, issues ?? [], requestId);
    }
    return new ApiError(
      response.status,
      response.status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_RESPONSE',
      `Unexpected response (${response.status})`,
    );
  }

  /** Sends with the access token, renews once on 401, and throws the error envelope on failure. */
  async function sendChecked(
    method: string,
    path: string,
    body: unknown,
    query: Query | undefined,
    authenticated: boolean,
  ): Promise<Response> {
    let response = await send(
      method,
      path,
      body,
      query,
      authenticated ? options.getAccessToken() : null,
    );
    if (response.status === 401 && authenticated) {
      const renewed = await renewOnce();
      if (renewed) response = await send(method, path, body, query, renewed);
    }
    if (!response.ok) throw await toError(response);
    return response;
  }

  async function request<S extends z.ZodType>(
    method: string,
    path: string,
    { schema, body, query, authenticated = true }: RequestOptions<S>,
  ): Promise<z.output<S>> {
    const response = await sendChecked(method, path, body, query, authenticated);
    const payload: unknown = response.status === 204 ? undefined : await response.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        'Response did not match the API contract',
      );
    }
    return parsed.data;
  }

  /** For non-JSON downloads such as CSV exports. */
  async function requestText(path: string): Promise<string> {
    return (await sendChecked('GET', path, undefined, undefined, true)).text();
  }

  return {
    auth: {
      register: (body: RegisterRequest) =>
        request('POST', '/auth/register', {
          schema: authSessionResponseSchema,
          body: { ...body, clientType: options.clientType },
          authenticated: false,
        }),
      login: (body: LoginRequest) =>
        request('POST', '/auth/login', {
          schema: loginResponseSchema,
          body: { ...body, clientType: options.clientType },
          authenticated: false,
        }),
      /** Web relies on the httpOnly cookie; mobile passes its stored refresh token. */
      refresh: (refreshToken?: string) =>
        request('POST', '/auth/refresh', {
          schema: authSessionResponseSchema,
          body: refreshToken ? { refreshToken } : {},
          authenticated: false,
        }),
      logout: (refreshToken?: string) =>
        request('POST', '/auth/logout', {
          schema: acceptedResponseSchema,
          body: refreshToken ? { refreshToken } : {},
          authenticated: false,
        }),
      logoutAll: () =>
        request('POST', '/auth/logout-all', { schema: acceptedResponseSchema, body: {} }),
      me: () => request('GET', '/auth/me', { schema: authContextSchema }),
      forgotPassword: (body: ForgotPasswordRequest) =>
        request('POST', '/auth/password/forgot', {
          schema: acceptedResponseSchema,
          body,
          authenticated: false,
        }),
      resetPassword: (body: ResetPasswordRequest) =>
        request('POST', '/auth/password/reset', {
          schema: acceptedResponseSchema,
          body,
          authenticated: false,
        }),
      /** The invitation token goes in a body so it never lands in URLs or logs. */
      previewInvitation: (token: string) =>
        request('POST', '/auth/invitations/preview', {
          schema: invitationPreviewSchema,
          body: { token },
          authenticated: false,
        }),
      verifyEmail: (token: string) =>
        request('POST', '/auth/email/verify', {
          schema: acceptedResponseSchema,
          body: { token },
          authenticated: false,
        }),
      resendVerification: () =>
        request('POST', '/auth/email/verification', { schema: acceptedResponseSchema, body: {} }),
      acceptInvitation: (body: Omit<AcceptInvitationRequest, 'clientType'>) =>
        request('POST', '/auth/invitations/accept', {
          schema: authSessionResponseSchema,
          body: { ...body, clientType: options.clientType },
          authenticated: false,
        }),
    },
    tenant: {
      current: () => request('GET', '/tenant', { schema: tenantSummarySchema }),
      completeOnboarding: (body: CompleteOnboardingRequest) =>
        request('POST', '/tenant/onboarding', { schema: tenantSummarySchema, body }),
    },
    settings: {
      get: () => request('GET', '/settings', { schema: tenantSettingsSchema }),
      update: (body: UpdateTenantSettingsRequest) =>
        request('PATCH', '/settings', { schema: tenantSettingsSchema, body }),
      presets: () =>
        request('GET', '/settings/profile-presets', { schema: businessProfilePresetsSchema }),
    },
    branches: {
      list: (options: { includeArchived?: boolean } = {}) =>
        request('GET', '/branches', {
          schema: branchListSchema,
          query: { includeArchived: options.includeArchived ?? false },
        }),
      create: (body: CreateBranchRequest) =>
        request('POST', '/branches', { schema: branchSchema, body }),
      update: (id: string, body: UpdateBranchRequest) =>
        request('PATCH', `/branches/${encodeURIComponent(id)}`, { schema: branchSchema, body }),
    },
    registers: {
      create: (body: CreateRegisterRequest) =>
        request('POST', '/registers', { schema: registerSchema, body }),
      update: (id: string, body: UpdateRegisterRequest) =>
        request('PATCH', `/registers/${encodeURIComponent(id)}`, { schema: registerSchema, body }),
    },
    categories: {
      list: () => request('GET', '/categories', { schema: categoryListSchema }),
      create: (body: CreateCategoryRequest) =>
        request('POST', '/categories', { schema: categorySchema, body }),
      update: (id: string, body: UpdateCategoryRequest) =>
        request('PATCH', `/categories/${encodeURIComponent(id)}`, { schema: categorySchema, body }),
    },
    products: {
      list: (query: Omit<ListProductsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/products', { schema: productPageSchema, query }),
      get: (id: string) =>
        request('GET', `/products/${encodeURIComponent(id)}`, { schema: productSchema }),
      create: (body: CreateProductRequest) =>
        request('POST', '/products', { schema: productSchema, body }),
      update: (id: string, body: UpdateProductRequest) =>
        request('PATCH', `/products/${encodeURIComponent(id)}`, { schema: productSchema, body }),
      lookup: (code: string) =>
        request('GET', '/products/lookup', { schema: variantLookupSchema, query: { code } }),
      import: (body: ProductImportRequest) =>
        request('POST', '/products/import', { schema: productImportResultSchema, body }),
      exportCsv: () => requestText('/products/export'),
      /** `form` holds one `file` field (a File/Blob, or { uri, name, type } on React Native). */
      addImage: (id: string, form: FormData) =>
        request('POST', `/products/${encodeURIComponent(id)}/images`, {
          schema: productSchema,
          body: form,
        }),
      reorderImages: (id: string, imageIds: string[]) =>
        request('PUT', `/products/${encodeURIComponent(id)}/images/order`, {
          schema: productSchema,
          body: { imageIds },
        }),
      removeImage: (id: string, imageId: string) =>
        request(
          'DELETE',
          `/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
          { schema: productSchema },
        ),
    },
    variants: {
      create: (body: CreateVariantRequest) =>
        request('POST', '/variants', { schema: productSchema, body }),
      update: (id: string, body: UpdateVariantRequest) =>
        request('PATCH', `/variants/${encodeURIComponent(id)}`, { schema: productSchema, body }),
    },
    suppliers: {
      list: (
        query: {
          q?: string;
          status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';
          cursor?: string;
          limit?: number;
        } = {},
      ) => request('GET', '/suppliers', { schema: supplierPageSchema, query }),
      create: (body: CreateSupplierRequest) =>
        request('POST', '/suppliers', { schema: supplierSchema, body }),
      update: (id: string, body: UpdateSupplierRequest) =>
        request('PATCH', `/suppliers/${encodeURIComponent(id)}`, { schema: supplierSchema, body }),
    },
    purchaseOrders: {
      list: (
        query: { status?: string; supplierId?: string; cursor?: string; limit?: number } = {},
      ) => request('GET', '/purchase-orders', { schema: purchaseOrderPageSchema, query }),
      get: (id: string) =>
        request('GET', `/purchase-orders/${encodeURIComponent(id)}`, {
          schema: purchaseOrderSchema,
        }),
      create: (body: CreatePurchaseOrderRequest) =>
        request('POST', '/purchase-orders', { schema: purchaseOrderSchema, body }),
      update: (id: string, body: UpdatePurchaseOrderRequest) =>
        request('PATCH', `/purchase-orders/${encodeURIComponent(id)}`, {
          schema: purchaseOrderSchema,
          body,
        }),
      placeOrder: (id: string, version: number) =>
        request('POST', `/purchase-orders/${encodeURIComponent(id)}/order`, {
          schema: purchaseOrderSchema,
          body: { version },
        }),
      cancel: (id: string, version: number) =>
        request('POST', `/purchase-orders/${encodeURIComponent(id)}/cancel`, {
          schema: purchaseOrderSchema,
          body: { version },
        }),
    },
    goodsReceipts: {
      list: (query: Omit<ListDocumentsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/goods-receipts', { schema: goodsReceiptPageSchema, query }),
      get: (id: string) =>
        request('GET', `/goods-receipts/${encodeURIComponent(id)}`, { schema: goodsReceiptSchema }),
      /** Idempotent: pass a client-generated id and retry freely. */
      create: (body: CreateGoodsReceiptRequest) =>
        request('POST', '/goods-receipts', { schema: goodsReceiptSchema, body }),
    },
    stock: {
      list: (query: Omit<ListStockQuery, 'limit' | 'days'> & { limit?: number; days?: number }) =>
        request('GET', '/stock', { schema: stockPageSchema, query }),
      movements: (query: Omit<ListMovementsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/stock/movements', { schema: stockMovementPageSchema, query }),
    },
    stockAdjustments: {
      list: (query: Omit<ListDocumentsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/stock-adjustments', { schema: stockAdjustmentPageSchema, query }),
      create: (body: CreateStockAdjustmentRequest) =>
        request('POST', '/stock-adjustments', { schema: stockAdjustmentSchema, body }),
    },
    stockTransfers: {
      list: (query: Omit<ListDocumentsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/stock-transfers', { schema: stockTransferPageSchema, query }),
      create: (body: CreateStockTransferRequest) =>
        request('POST', '/stock-transfers', { schema: stockTransferSchema, body }),
      receive: (id: string, version: number) =>
        request('POST', `/stock-transfers/${encodeURIComponent(id)}/receive`, {
          schema: stockTransferSchema,
          body: { version },
        }),
      cancel: (id: string, version: number) =>
        request('POST', `/stock-transfers/${encodeURIComponent(id)}/cancel`, {
          schema: stockTransferSchema,
          body: { version },
        }),
    },
    stockCounts: {
      list: (query: Omit<ListDocumentsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/stock-counts', { schema: stockCountPageSchema, query }),
      get: (id: string) =>
        request('GET', `/stock-counts/${encodeURIComponent(id)}`, { schema: stockCountSchema }),
      start: (body: CreateStockCountRequest) =>
        request('POST', '/stock-counts', { schema: stockCountSchema, body }),
      update: (id: string, body: UpdateStockCountRequest) =>
        request('PATCH', `/stock-counts/${encodeURIComponent(id)}`, {
          schema: stockCountSchema,
          body,
        }),
      complete: (id: string, version: number) =>
        request('POST', `/stock-counts/${encodeURIComponent(id)}/complete`, {
          schema: stockCountSchema,
          body: { version },
        }),
      cancel: (id: string, version: number) =>
        request('POST', `/stock-counts/${encodeURIComponent(id)}/cancel`, {
          schema: stockCountSchema,
          body: { version },
        }),
    },
    taxRates: {
      list: () => request('GET', '/tax-rates', { schema: taxRateListSchema }),
      create: (body: CreateTaxRateRequest) =>
        request('POST', '/tax-rates', { schema: taxRateSchema, body }),
      update: (id: string, body: UpdateTaxRateRequest) =>
        request('PATCH', `/tax-rates/${encodeURIComponent(id)}`, { schema: taxRateSchema, body }),
    },
    shifts: {
      current: (registerId: string) =>
        request('GET', '/shifts/current', {
          schema: currentShiftResponseSchema,
          query: { registerId },
        }),
      list: (query: Omit<ListShiftsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/shifts', { schema: shiftPageSchema, query }),
      get: (id: string) =>
        request('GET', `/shifts/${encodeURIComponent(id)}`, { schema: shiftSchema }),
      open: (body: OpenShiftRequest) => request('POST', '/shifts', { schema: shiftSchema, body }),
      close: (id: string, body: CloseShiftRequest) =>
        request('POST', `/shifts/${encodeURIComponent(id)}/close`, { schema: shiftSchema, body }),
      /** Pay-in or pay-out; safe to retry with the same id. */
      cashMovement: (id: string, body: CreateCashMovementRequest) =>
        request('POST', `/shifts/${encodeURIComponent(id)}/cash-movements`, {
          schema: shiftSchema,
          body,
        }),
    },
    sales: {
      /** Safe to retry with the same body: the API returns the original sale. */
      create: (body: CreateSaleRequest) => request('POST', '/sales', { schema: saleSchema, body }),
      list: (query: Omit<ListSalesQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/sales', { schema: salePageSchema, query }),
      get: (id: string) =>
        request('GET', `/sales/${encodeURIComponent(id)}`, { schema: saleSchema }),
      receipt: (id: string) =>
        request('GET', `/sales/${encodeURIComponent(id)}/receipt`, { schema: receiptSchema }),
      byNumber: (number: string) =>
        request('GET', `/sales/by-number/${encodeURIComponent(number)}`, { schema: saleSchema }),
      /** Safe to retry with the same body. */
      createReturn: (saleId: string, body: CreateReturnRequest) =>
        request('POST', `/sales/${encodeURIComponent(saleId)}/returns`, {
          schema: saleReturnSchema,
          body,
        }),
      void: (saleId: string, body: VoidSaleRequest) =>
        request('POST', `/sales/${encodeURIComponent(saleId)}/void`, {
          schema: saleReturnSchema,
          body,
        }),
    },
    returns: {
      list: (query: Omit<ListReturnsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/returns', { schema: saleReturnPageSchema, query }),
      get: (id: string) =>
        request('GET', `/returns/${encodeURIComponent(id)}`, { schema: saleReturnSchema }),
    },
    customers: {
      list: (query: Omit<ListCustomersQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/customers', { schema: customerPageSchema, query }),
      get: (id: string) =>
        request('GET', `/customers/${encodeURIComponent(id)}`, { schema: customerSchema }),
      create: (body: CreateCustomerRequest) =>
        request('POST', '/customers', { schema: customerSchema, body }),
      update: (id: string, body: UpdateCustomerRequest) =>
        request('PATCH', `/customers/${encodeURIComponent(id)}`, { schema: customerSchema, body }),
      statement: (id: string, query: StatementQuery = {}) =>
        request('GET', `/customers/${encodeURIComponent(id)}/statement`, {
          schema: statementSchema,
          query,
        }),
      loyalty: (id: string, query: { cursor?: string; limit?: number } = {}) =>
        request('GET', `/customers/${encodeURIComponent(id)}/loyalty`, {
          schema: loyaltyHistorySchema,
          query,
        }),
      /** Safe to retry with the same body (the id makes it idempotent). */
      adjustLoyalty: (id: string, body: AdjustLoyaltyRequest) =>
        request('POST', `/customers/${encodeURIComponent(id)}/loyalty/adjust`, {
          schema: loyaltyHistorySchema,
          body,
        }),
      /** Safe to retry with the same body. */
      collect: (id: string, body: CreateCustomerPaymentRequest) =>
        request('POST', `/customers/${encodeURIComponent(id)}/payments`, {
          schema: customerPaymentSchema,
          body,
        }),
      consents: (id: string) =>
        request('GET', `/customers/${encodeURIComponent(id)}/consents`, {
          schema: consentHistorySchema,
        }),
    },
    messaging: {
      status: () => request('GET', '/messaging/status', { schema: messagingStatusSchema }),
      campaigns: (query: { cursor?: string; limit?: number } = {}) =>
        request('GET', '/messaging/campaigns', { schema: campaignPageSchema, query }),
      /** Safe to retry with the same body (the id makes it idempotent). */
      send: (body: CreateCampaignRequest) =>
        request('POST', '/messaging/campaigns', { schema: campaignSchema, body }),
      /** The customer's own opt-out link; no sign-in. */
      unsubscribeInfo: (code: string) =>
        request('GET', `/public/unsubscribe/${encodeURIComponent(code)}`, {
          schema: unsubscribeInfoSchema,
          authenticated: false,
        }),
      unsubscribe: (code: string) =>
        request('POST', '/public/unsubscribe', {
          schema: unsubscribeInfoSchema,
          body: { code },
          authenticated: false,
        }),
    },
    reports: {
      dashboard: (query: { branchId?: string } = {}) =>
        request('GET', '/reports/dashboard', { schema: dashboardSchema, query }),
      sales: (query: Omit<SalesReportQuery, 'format'> = {}) =>
        request('GET', '/reports/sales', { schema: salesReportSchema, query }),
      tax: (query: Omit<ReportRangeQuery, 'format'> = {}) =>
        request('GET', '/reports/tax', { schema: taxReportSchema, query }),
      profit: (query: Omit<ProfitReportQuery, 'format'> = {}) =>
        request('GET', '/reports/profit', { schema: profitReportSchema, query }),
      stockValuation: (query: { branchId?: string } = {}) =>
        request('GET', '/reports/stock-valuation', { schema: stockValuationSchema, query }),
      receivables: () =>
        request('GET', '/reports/receivables', { schema: receivablesReportSchema }),
      /** Any report as CSV text, e.g. csv('sales', { groupBy: 'product' }). */
      csv: (
        report: 'sales' | 'tax' | 'profit' | 'stock-valuation' | 'receivables',
        query: Record<string, string | undefined> = {},
      ) => {
        const params = new URLSearchParams({ format: 'csv' });
        for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
        return requestText(`/reports/${report}?${params.toString()}`);
      },
    },
    sync: {
      /** Catalogue changes since the cursor; repeat while `hasMore`. */
      catalog: (query: Omit<CatalogSyncQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/sync/catalog', { schema: catalogSyncPageSchema, query }),
      conflicts: (query: Omit<ListConflictsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/sale-conflicts', { schema: saleConflictPageSchema, query }),
      resolveConflict: (id: string, body: ResolveConflictRequest) =>
        request('POST', `/sale-conflicts/${encodeURIComponent(id)}/resolve`, {
          schema: saleConflictSchema,
          body,
        }),
    },
    approvals: {
      approvers: () => request('GET', '/approvers', { schema: approverListSchema }),
      pinStatus: () => request('GET', '/me/approval-pin', { schema: approvalPinStatusSchema }),
      setPin: (body: SetApprovalPinRequest) =>
        request('PUT', '/me/approval-pin', { schema: z.undefined(), body }),
    },
    /**
     * Platform console (operator staff). Use a separate client whose
     * getAccessToken returns the platform token; tenant tokens are refused.
     */
    platform: {
      login: (body: PlatformLoginRequest) =>
        request('POST', '/platform/auth/login', {
          schema: platformSessionSchema,
          body,
          authenticated: false,
        }),
      logout: () => request('POST', '/platform/auth/logout', { schema: z.undefined(), body: {} }),
      me: () => request('GET', '/platform/auth/me', { schema: platformUserSchema }),
      overview: () => request('GET', '/platform/overview', { schema: platformOverviewSchema }),
      tenants: (query: Omit<ListPlatformTenantsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/platform/tenants', { schema: platformTenantPageSchema, query }),
      tenant: (id: string) =>
        request('GET', `/platform/tenants/${encodeURIComponent(id)}`, {
          schema: platformTenantDetailSchema,
        }),
      suspend: (id: string, body: TenantActionRequest) =>
        request('POST', `/platform/tenants/${encodeURIComponent(id)}/suspend`, {
          schema: platformTenantSummarySchema,
          body,
        }),
      reinstate: (id: string, body: TenantActionRequest) =>
        request('POST', `/platform/tenants/${encodeURIComponent(id)}/reinstate`, {
          schema: platformTenantSummarySchema,
          body,
        }),
      close: (id: string, body: CloseTenantRequest) =>
        request('POST', `/platform/tenants/${encodeURIComponent(id)}/close`, {
          schema: platformTenantSummarySchema,
          body,
        }),
      extend: (id: string, body: ExtendSubscriptionRequest) =>
        request('POST', `/platform/tenants/${encodeURIComponent(id)}/subscription/extend`, {
          schema: platformTenantSummarySchema,
          body,
        }),
      changePlan: (id: string, body: ChangePlanRequest) =>
        request('POST', `/platform/tenants/${encodeURIComponent(id)}/subscription/plan`, {
          schema: platformTenantSummarySchema,
          body,
        }),
      recordPayment: (id: string, body: ManualPaymentRequest) =>
        request('POST', `/platform/tenants/${encodeURIComponent(id)}/payments`, {
          schema: platformTenantDetailSchema,
          body,
        }),
      plans: () => request('GET', '/platform/plans', { schema: platformPlanListSchema }),
      createPlan: (body: CreatePlanRequest) =>
        request('POST', '/platform/plans', { schema: platformPlanSchema, body }),
      updatePlan: (code: string, body: UpdatePlanRequest) =>
        request('PATCH', `/platform/plans/${encodeURIComponent(code)}`, {
          schema: platformPlanSchema,
          body,
        }),
      audit: (query: Omit<PlatformAuditQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/platform/audit', { schema: platformAuditPageSchema, query }),
      flags: () => request('GET', '/platform/flags', { schema: platformFeatureFlagListSchema }),
      updateFlag: (key: string, body: UpdateFeatureFlagRequest) =>
        request('PATCH', `/platform/flags/${encodeURIComponent(key)}`, {
          schema: platformFeatureFlagListSchema,
          body,
        }),
      setTenantFlag: (tenantId: string, key: string, body: SetTenantFeatureRequest) =>
        request(
          'PUT',
          `/platform/tenants/${encodeURIComponent(tenantId)}/flags/${encodeURIComponent(key)}`,
          { schema: z.array(tenantFeatureSchema), body },
        ),
    },
    notifications: {
      list: (query: Omit<ListNotificationsQuery, 'limit'> & { limit?: number } = {}) =>
        request('GET', '/notifications', { schema: notificationPageSchema, query }),
      unreadCount: () =>
        request('GET', '/notifications/unread-count', { schema: unreadCountSchema }),
      markRead: (id: string) =>
        request('POST', `/notifications/${encodeURIComponent(id)}/read`, {
          schema: notificationSchema,
          body: {},
        }),
      markAllRead: () =>
        request('POST', '/notifications/read-all', { schema: unreadCountSchema, body: {} }),
      preferences: () =>
        request('GET', '/me/notification-preferences', { schema: notificationPreferencesSchema }),
      setPreferences: (body: NotificationPreferences) =>
        request('PUT', '/me/notification-preferences', {
          schema: notificationPreferencesSchema,
          body,
        }),
    },
    billing: {
      overview: () => request('GET', '/billing', { schema: billingOverviewSchema }),
      /** Opens an invoice; send the browser to `redirect` (a form POST) to pay. */
      checkout: (body: CheckoutRequest) =>
        request('POST', '/billing/checkout', { schema: checkoutResponseSchema, body }),
      cancel: (version: number) =>
        request('POST', '/billing/cancel', { schema: subscriptionSchema, body: { version } }),
      resume: (version: number) =>
        request('POST', '/billing/resume', { schema: subscriptionSchema, body: { version } }),
    },
    staff: {
      list: () => request('GET', '/staff', { schema: staffListSchema }),
      invite: (body: CreateInvitationRequest) =>
        request('POST', '/staff/invitations', { schema: invitationSchema, body }),
      revokeInvitation: (id: string) =>
        request('POST', `/staff/invitations/${encodeURIComponent(id)}/revoke`, {
          schema: z.undefined(),
          body: {},
        }),
      update: (membershipId: string, body: UpdateStaffRequest) =>
        request('PATCH', `/staff/${encodeURIComponent(membershipId)}`, {
          schema: staffMemberSchema,
          body,
        }),
    },
    devices: {
      list: () => request('GET', '/devices', { schema: deviceListSchema }),
      /** Registers this till (by its install id) to a register; safe to repeat. */
      register: (id: string, body: RegisterDeviceRequest) =>
        request('PUT', `/devices/${encodeURIComponent(id)}`, { schema: deviceSchema, body }),
      revoke: (id: string) =>
        request('POST', `/devices/${encodeURIComponent(id)}/revoke`, {
          schema: deviceSchema,
          body: {},
        }),
      restore: (id: string) =>
        request('POST', `/devices/${encodeURIComponent(id)}/restore`, {
          schema: deviceSchema,
          body: {},
        }),
    },
    audit: {
      list: (query: { cursor?: string; limit?: number } = {}) =>
        request('GET', '/audit-logs', { schema: auditLogPageSchema, query }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
