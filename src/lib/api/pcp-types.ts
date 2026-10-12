/** Response shapes of the production-completion endpoints (payments config, OTP provider, staff, moderation, account lifecycle). */

export type GatewayKey = "RAZORPAY" | "PHONEPE";

export interface GatewayConfigView {
  key: GatewayKey;
  label: string;
  id: string;
  isActive: boolean;
  status: "ACTIVE" | "INACTIVE";
  configured: boolean;
  credentialSource: "admin" | "environment" | "none";
  mode: "test" | "live" | null;
  /** What the key itself declares (rzp_test_ / rzp_live_); null when none / PhonePe. */
  detectedMode?: "test" | "live" | "unknown" | null;
  /** Why the credentials are refused in this environment; null when usable. */
  problem?: string | null;
  /** Names of write-only fields that currently hold a stored value (never the values). */
  storedFields: string[];
  webhook: { configured: boolean; url: string };
}

export interface PaymentConfigView {
  activeGateway: GatewayKey | null;
  gateways: GatewayConfigView[];
  unsupportedActiveGateway: string | null;
  devGatewayInUse: boolean;
}

export type OtpProviderKey = "EMAIL" | "FAST2SMS_SMS";

export interface OtpProviderStatus {
  key: OtpProviderKey;
  label: string;
  method: string;
  active: boolean;
  configured: boolean;
  missing: string[];
}

export interface OtpProviderView {
  activeProvider: OtpProviderKey | null;
  unsupportedActiveMethod: string | null;
  enabled: boolean;
  devMode: boolean;
  providers: OtpProviderStatus[];
  updatedAt: string;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | string;
  mustChangePassword: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface StaffPage {
  items: StaffMember[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminRoleView {
  id: string;
  name: string;
  description: string | null;
  protected: boolean;
  permissions: string[];
  members: number;
}

export interface RolesResponse {
  roles: AdminRoleView[];
  permissions: Array<{ key: string; description: string | null }>;
}

export interface SuspensionRow {
  id: string;
  suspendedAt: string;
  liftedAt: string | null;
  reason: string | null;
}

export interface BanRow {
  id: string;
  bannedAt: string;
  liftedAt: string | null;
  reason: string | null;
}

export interface ModerationView {
  userId: string;
  name: string;
  status: string;
  activeSuspension: SuspensionRow | null;
  activeBan: BanRow | null;
  suspensions: SuspensionRow[];
  bans: BanRow[];
  warnings: Array<{ id: string; message: string; createdAt: string; acknowledgedAt: string | null }>;
}

export interface AccountDeletionRow {
  userId: string;
  name: string;
  email: string | null;
  state: "PENDING" | "FINALIZED";
  requestedAt: string | null;
  recoverUntil: string | null;
  daysLeft: number;
}

export interface AccountDeletionsPage {
  recoveryWindowDays: number;
  items: AccountDeletionRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface RefundRowView {
  id: string;
  paymentId: string;
  provider: string;
  amountInPaise: number;
  currency: string;
  status: "PENDING" | "PROCESSED" | "FAILED" | string;
  reason: string;
  failureReason: string | null;
  createdAt: string;
}

export interface RefundsResponse {
  refunds: RefundRowView[];
  refundableInPaise: number;
}

/** What the browser needs to finish paying at a real gateway (public values only). */
export type ClientCheckoutData =
  | { provider: "RAZORPAY"; keyId: string; orderId: string; amount: number; currency: string }
  | { provider: "PHONEPE"; redirectUrl: string };
