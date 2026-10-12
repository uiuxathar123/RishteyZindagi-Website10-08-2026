/**
 * Response shapes used only by the Admin Panel. They mirror the backend
 * DTOs (src/server/modules/**) field-for-field, including the parts the
 * shared `src/lib/api/types.ts` admin types leave out.
 */
import type { Page } from "@/lib/api/types";

export type { Page };

export interface AdminReportCategory {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdminWarningCategory {
  id: string;
  name: string;
  description: string | null;
}

export interface AdminReportRow {
  id: string;
  reporterUserId: string;
  reportedUserId: string;
  categoryId: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED" | string;
  description: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminUserDetailFull {
  account: {
    id: string;
    name: string;
    email: string;
    mobileNumber: string;
    countryCode: string;
    status: string;
    emailVerifiedAt: string | null;
    mobileVerifiedAt: string | null;
    country: string | null;
    city: string | null;
    lastActiveAt: string | null;
    createdAt: string;
    deletedAt: string | null;
  };
  profile: {
    id: string;
    gender: string;
    profileStatus: string;
    verificationStatus: string;
    verifiedAt: string | null;
    profileCompletionPercent: number;
    hasProfilePhoto: boolean;
  } | null;
  memberships: Array<{
    id: string;
    planId: string;
    status: string;
    startedAt: string | null;
    expiresAt: string | null;
    autoRenew: boolean;
    createdAt: string;
  }>;
  reports: {
    againstCount: number;
    filedCount: number;
    against: AdminReportRow[];
    filed: AdminReportRow[];
  };
  warnings: Array<{
    id: string;
    categoryId: string;
    status: string;
    message: string;
    createdAt: string;
    acknowledgedAt: string | null;
  }>;
  suspensions: Array<{ id: string; suspendedAt: string; liftedAt: string | null; reason: string | null }>;
  auditHistory: Array<{
    id: string;
    actorType: string;
    actorId: string | null;
    actorRole: string | null;
    action: string;
    entityType: string | null;
    entityId: string | null;
    createdAt: string;
  }>;
}

export interface AdminPaymentRow {
  id: string;
  membershipId: string | null;
  gatewayId: string;
  amountInPaise: number;
  currency: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED" | string;
  gatewayReference: string | null;
  verifiedAt: string | null;
  verificationMethod: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPaymentsResponse {
  payments: AdminPaymentRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AdminInvoiceRow {
  id: string;
  invoiceNumber: string;
  userId: string;
  amountInPaise: number;
  status: "ISSUED" | "PAID" | "VOID" | string;
  issuedAt: string;
  cancelledAt: string | null;
  paymentId: string | null;
  paymentStatus: string | null;
  currency: string | null;
  gatewayId: string | null;
  gatewayName: string | null;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  transactionRef: string | null;
  gatewayTransactionId: string | null;
}

export interface AdminMembershipRow {
  id: string;
  userId: string;
  planId: string;
  planCode: string | null;
  planName: string | null;
  status: string;
  startedAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  createdAt: string;
}

export interface AdminAuditEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

/** Matching-weight categories in the order the backend lists them. */
export const WEIGHT_CATEGORIES: Array<{ key: string; label: string; hint: string }> = [
  { key: "age", label: "Age", hint: "How close the ages are to the stated preference." },
  { key: "height", label: "Height", hint: "Height against the preferred range." },
  { key: "religion", label: "Religion", hint: "Religion match." },
  { key: "community", label: "Community", hint: "Community / caste match." },
  { key: "motherTongue", label: "Mother tongue", hint: "Shared language." },
  { key: "education", label: "Education", hint: "Education level match." },
  { key: "profession", label: "Profession", hint: "Profession match." },
  { key: "maritalStatus", label: "Marital status", hint: "Marital status match." },
  { key: "location", label: "Location", hint: "Country and city match." },
  { key: "income", label: "Income", hint: "Income range match." },
];

/** Human labels for the backend's permission keys (descriptions from the RBAC seed). */
export const PERMISSION_LABELS: Record<string, string> = {
  "admin.ping": "Reach the admin API",
  "users.view": "View member accounts",
  "users.suspend": "Suspend members and lift suspensions",
  "users.ban": "Ban or unban members",
  "profiles.verify": "Approve or reject profile verification",
  "reports.resolve": "Review and dismiss user reports",
  "reports.categories.manage": "Add, edit or disable report categories",
  "warnings.issue": "Issue warnings to members",
  "platform.settings.manage": "Change platform settings (OTP, matching weights, gateways)",
  "payments.review": "Review payments, memberships and invoices",
  "audit.view": "View the platform audit log",
  "staff.manage": "Manage staff accounts and roles",
  "plans.manage": "Create and edit membership plans and entitlements",
  "communities.manage": "Add, rename and retire community entries",
};
