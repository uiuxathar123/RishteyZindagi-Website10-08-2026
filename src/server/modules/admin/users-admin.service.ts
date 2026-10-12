/**
 * B9: admin user search/list/detail — genuinely new admin capability
 * (see this file's controller/repository for the full context). Reuses
 * the existing `users.view` permission ("View member accounts") for
 * every function here — it already exists precisely for this purpose;
 * see BACKEND.md's B9 section for the full reasoning on why no new
 * permission was needed.
 *
 * The detail composition calls straight into each owning module's
 * already-existing, already-tested repository functions
 * (memberships.repository.listForUser, warnings.repository
 * .listWarningsForUser, reports.repository.listSuspensionsForUser) —
 * never duplicating their query logic — plus two small new B9-only
 * queries (reports in both directions, audit history) that didn't
 * already exist anywhere.
 */
import { NotFoundError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as repo from "./users-admin.repository";
import type { UserRow, ProfileRow } from "./users-admin.repository";
import * as auditRepo from "./audit-logs.repository";
import * as membershipsRepo from "@/server/modules/memberships/memberships.repository";
import * as warningsRepo from "@/server/modules/warnings/warnings.repository";
import * as reportsRepo from "@/server/modules/reports/reports.repository";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import { toSummaryView, toDetailView } from "./users-admin.dto";
import type { AdminUserSummaryView } from "./users-admin.dto";

const PERMISSION = "users.view";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface SearchUsersInput {
  q?: string;
  status?: UserRow["status"];
  verificationStatus?: ProfileRow["verificationStatus"];
  membership?: "ACTIVE" | "NONE";
  openReports?: boolean;
  sort?: "newest" | "oldest" | "name" | "lastActive";
  page?: number;
  pageSize?: number;
}

export interface UsersPage {
  items: AdminUserSummaryView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function searchUsersForAdmin(ctx: AuthContext, input: SearchUsersInput): Promise<UsersPage> {
  await requirePermission(ctx, PERMISSION);
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const { items, total } = await repo.searchUsers(
    { q: input.q, status: input.status, verificationStatus: input.verificationStatus, membership: input.membership, openReports: input.openReports, sort: input.sort },
    page,
    pageSize
  );

  // One query for the primary photos of this page (admins may always open photos).
  const profileIds = items.map((r) => r.profile?.id).filter((x): x is string => !!x);
  const photos = await profilesRepo.listPhotosForProfiles(profileIds);
  const primaryPhotoId = (profileId: string | undefined): string | null => {
    const list = profileId ? photos.get(profileId) : undefined;
    return list ? (list.find((p) => p.isPrimary) ?? list[0])?.id ?? null : null;
  };

  return {
    items: items.map((row) => toSummaryView(row.user, row.profile, primaryPhotoId(row.profile?.id))),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getUserDetailForAdmin(ctx: AuthContext, userId: string) {
  await requirePermission(ctx, PERMISSION);
  const found = await repo.findUserWithProfile(userId);
  if (!found) throw new NotFoundError("User not found.");

  const [memberships, reportsAgainst, reportsFiled, warnings, suspensions, auditHistory] = await Promise.all([
    membershipsRepo.listForUser(userId),
    repo.listReportsAgainstUser(userId),
    repo.listReportsFiledByUser(userId),
    warningsRepo.listWarningsForUser(userId),
    reportsRepo.listSuspensionsForUser(userId),
    auditRepo.listForUser(userId),
  ]);

  return toDetailView({
    user: found.user,
    profile: found.profile,
    memberships,
    reportsAgainst,
    reportsFiled,
    warnings,
    suspensions,
    auditHistory,
  });
}
