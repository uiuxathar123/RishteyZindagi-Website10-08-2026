/**
 * B9: response shaping for the admin user search/list/detail endpoints —
 * explicit DTOs (never a raw Drizzle row) so `passwordHash` can never
 * leak, matching the discipline `payments.dto.ts`/`invoices.dto.ts`
 * already established in B8.
 */
import type { UserRow, ProfileRow, ReportRow } from "./users-admin.repository";
import type { WarningRow } from "@/server/modules/warnings/warnings.repository";
import type { MembershipRow } from "@/server/modules/memberships/memberships.repository";
import type { AccountSuspensionRow } from "@/server/modules/reports/reports.repository";
import type { AuditLogRow } from "./audit-logs.repository";

export interface AdminUserSummaryView {
  id: string;
  name: string;
  email: string;
  mobileNumber: string;
  countryCode: string;
  status: string;
  country: string | null;
  city: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  profileStatus: string | null;
  verificationStatus: string | null;
  hasProfilePhoto: boolean | null;
}

export function toSummaryView(user: UserRow, profile: ProfileRow | null): AdminUserSummaryView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mobileNumber: user.mobileNumber,
    countryCode: user.countryCode,
    status: user.status,
    country: user.country,
    city: user.city,
    lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    profileStatus: profile?.profileStatus ?? null,
    verificationStatus: profile?.verificationStatus ?? null,
    hasProfilePhoto: profile?.hasProfilePhoto ?? null,
  };
}

function toReportView(row: ReportRow) {
  return {
    id: row.id,
    reporterUserId: row.reporterUserId,
    reportedUserId: row.reportedUserId,
    categoryId: row.categoryId,
    status: row.status,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

function toWarningView(row: WarningRow) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    status: row.status,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
  };
}

function toMembershipView(row: MembershipRow) {
  return {
    id: row.id,
    planId: row.planId,
    status: row.status,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    autoRenew: row.autoRenew,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSuspensionView(row: AccountSuspensionRow) {
  return {
    id: row.id,
    suspendedAt: row.suspendedAt.toISOString(),
    liftedAt: row.liftedAt ? row.liftedAt.toISOString() : null,
    reason: row.reason,
  };
}

function toAuditView(row: AuditLogRow) {
  return {
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AdminUserDetailInput {
  user: UserRow;
  profile: ProfileRow | null;
  memberships: MembershipRow[];
  reportsAgainst: ReportRow[];
  reportsFiled: ReportRow[];
  warnings: WarningRow[];
  suspensions: AccountSuspensionRow[];
  auditHistory: AuditLogRow[];
}

/**
 * Full admin detail view. `account.status` is the raw enum value
 * (including the dormant DELETED_PENDING/DELETED states no code path
 * writes yet — see this module's service-layer doc comment and
 * BACKEND.md's B9 §"account-deletion/recovery gap" for why this is a
 * read-only, honest passthrough and not a fabricated recovery flow).
 * Never includes `passwordHash`.
 */
export function toDetailView(input: AdminUserDetailInput) {
  const { user, profile } = input;
  return {
    account: {
      id: user.id,
      name: user.name,
      email: user.email,
      mobileNumber: user.mobileNumber,
      countryCode: user.countryCode,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      mobileVerifiedAt: user.mobileVerifiedAt ? user.mobileVerifiedAt.toISOString() : null,
      country: user.country,
      city: user.city,
      lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
    },
    profile: profile
      ? {
          id: profile.id,
          gender: profile.gender,
          profileStatus: profile.profileStatus,
          verificationStatus: profile.verificationStatus,
          verifiedAt: profile.verifiedAt ? profile.verifiedAt.toISOString() : null,
          profileCompletionPercent: profile.profileCompletionPercent,
          hasProfilePhoto: profile.hasProfilePhoto,
        }
      : null,
    memberships: input.memberships.map(toMembershipView),
    reports: {
      againstCount: input.reportsAgainst.length,
      filedCount: input.reportsFiled.length,
      against: input.reportsAgainst.map(toReportView),
      filed: input.reportsFiled.map(toReportView),
    },
    warnings: input.warnings.map(toWarningView),
    suspensions: input.suspensions.map(toSuspensionView),
    auditHistory: input.auditHistory.map(toAuditView),
  };
}
