import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './components/AppShell';
import { PublicOnly, RequireAuth } from './components/RouteGuards';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AuditLogPage } from './pages/AuditLogPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { PlatformAuditPage } from './pages/platform/PlatformAuditPage';
import { PlatformFlagsPage } from './pages/platform/PlatformFlagsPage';
import { PlatformLayout } from './pages/platform/PlatformLayout';
import { PlatformLoginPage } from './pages/platform/PlatformLoginPage';
import { PlatformOverviewPage } from './pages/platform/PlatformOverviewPage';
import { PlatformPlansPage } from './pages/platform/PlatformPlansPage';
import { PlatformTenantPage } from './pages/platform/PlatformTenantPage';
import { PlatformTenantsPage } from './pages/platform/PlatformTenantsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AdjustStockPage } from './pages/inventory/AdjustStockPage';
import { CountDetailPage, CountsPage } from './pages/inventory/CountsPage';
import { ReceiveStockPage } from './pages/inventory/ReceiveStockPage';
import { StockPage } from './pages/inventory/StockPage';
import { TransfersPage } from './pages/inventory/TransfersPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { CheckoutPage } from './pages/pos/CheckoutPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { ShiftReportPage } from './pages/reports/ShiftReportPage';
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { MessagesPage } from './pages/customers/MessagesPage';
import { UnsubscribePage } from './pages/UnsubscribePage';
import { ReviewPage } from './pages/sales/ReviewPage';
import { SaleDetailPage } from './pages/sales/SaleDetailPage';
import { SalesPage } from './pages/sales/SalesPage';
import { CheckoutSettingsPage } from './pages/settings/CheckoutSettingsPage';
import { PurchaseOrderPage, PurchaseOrdersPage } from './pages/purchasing/PurchaseOrdersPage';
import { SuppliersPage } from './pages/purchasing/SuppliersPage';
import { CategoriesPage } from './pages/products/CategoriesPage';
import { ImportProductsPage } from './pages/products/ImportProductsPage';
import { ProductEditorPage } from './pages/products/ProductEditorPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { BillingPage } from './pages/settings/BillingPage';
import { BusinessSettingsPage } from './pages/settings/BusinessSettingsPage';
import { DevicesPage } from './pages/settings/DevicesPage';
import { LocalizationSettingsPage } from './pages/settings/LocalizationSettingsPage';
import { LocationsPage } from './pages/settings/LocationsPage';
import { ProfileSettingsPage } from './pages/settings/ProfileSettingsPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { StaffPage } from './pages/settings/StaffPage';

export const routes = [
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Reachable whether or not the browser has a session; a reset signs everyone out.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  // Joining a business signs in as the invited person, whoever was signed in before.
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/u/:code', element: <UnsubscribePage /> },
  // Platform console: separate sign-in and session, independent of any shop session.
  { path: '/platform/login', element: <PlatformLoginPage /> },
  {
    path: '/platform',
    element: <PlatformLayout />,
    children: [
      { index: true, element: <PlatformOverviewPage /> },
      { path: 'tenants', element: <PlatformTenantsPage /> },
      { path: 'tenants/:id', element: <PlatformTenantPage /> },
      { path: 'plans', element: <PlatformPlansPage /> },
      { path: 'flags', element: <PlatformFlagsPage /> },
      { path: 'audit', element: <PlatformAuditPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/activity', element: <AuditLogPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/pos', element: <CheckoutPage /> },
          { path: '/sales', element: <SalesPage /> },
          { path: '/customers', element: <CustomersPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/reports/shifts/:id', element: <ShiftReportPage /> },
          { path: '/customers/messages', element: <MessagesPage /> },
          { path: '/customers/:id', element: <CustomerDetailPage /> },
          { path: '/sales/review', element: <ReviewPage /> },
          { path: '/sales/number/:number', element: <SaleDetailPage /> },
          { path: '/sales/:id', element: <SaleDetailPage /> },
          { path: '/products', element: <ProductsPage /> },
          { path: '/products/new', element: <ProductEditorPage /> },
          { path: '/products/categories', element: <CategoriesPage /> },
          { path: '/products/import', element: <ImportProductsPage /> },
          { path: '/products/:id', element: <ProductEditorPage /> },
          { path: '/inventory', element: <StockPage /> },
          { path: '/inventory/receive', element: <ReceiveStockPage /> },
          { path: '/inventory/adjust', element: <AdjustStockPage /> },
          { path: '/inventory/transfers', element: <TransfersPage /> },
          { path: '/inventory/counts', element: <CountsPage /> },
          { path: '/inventory/counts/:id', element: <CountDetailPage /> },
          { path: '/purchasing/orders', element: <PurchaseOrdersPage /> },
          { path: '/purchasing/orders/new', element: <PurchaseOrderPage /> },
          { path: '/purchasing/orders/:id', element: <PurchaseOrderPage /> },
          { path: '/purchasing/suppliers', element: <SuppliersPage /> },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="/settings/business" replace /> },
              { path: 'business', element: <BusinessSettingsPage /> },
              { path: 'localization', element: <LocalizationSettingsPage /> },
              { path: 'profile', element: <ProfileSettingsPage /> },
              { path: 'locations', element: <LocationsPage /> },
              { path: 'checkout', element: <CheckoutSettingsPage /> },
              { path: 'staff', element: <StaffPage /> },
              { path: 'devices', element: <DevicesPage /> },
              { path: 'billing', element: <BillingPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
