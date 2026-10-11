/** B19 admin/member API shapes (mirrors the server views; no secrets). */
export interface SiteControlsView {
  maintenance: { enabled: boolean; message: string; updatedAt: string | null };
  approval: { manualApproval: boolean; updatedAt: string | null };
  digest: { enabled: boolean; updatedAt: string | null; mailerConfigured: boolean };
}

export interface ApprovalQueueItem {
  profileId: string;
  publicId: string;
  userId: string;
  displayName: string;
  gender: string;
  profileCompletionPercent: number;
  approvalStatus: "APPROVED" | "PENDING" | "REJECTED";
  approvalReason: string | null;
  approvalDecidedAt: string | null;
  submittedAt: string;
}
export interface ApprovalQueuePage {
  items: ApprovalQueueItem[];
  page: number;
  pageSize: number;
  total: number;
  status: "APPROVED" | "PENDING" | "REJECTED";
}

export interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  topic: string;
  subject: string;
  message: string;
  status: "NEW" | "READ" | "RESOLVED";
  adminNote: string | null;
  handledAt: string | null;
  createdAt: string;
}
export interface ContactMessagePage {
  items: ContactMessageRow[];
  page: number;
  pageSize: number;
  total: number;
  newCount: number;
}
export interface SupportContactAdmin {
  contact: { email: string; phone: string; hours: string };
  updatedAt: string | null;
}
export interface StoryRow {
  id: string;
  coupleNames: string;
  location: string;
  year: number;
  story: string;
  isPublished: boolean;
  consentConfirmed: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface DashboardTrends {
  days: number;
  timezone: string;
  currencies: string[];
  series: Array<{ date: string; signups: number; paymentsSucceeded: number; reportsOpened: number; revenue: Record<string, number> }>;
}

export interface GroupView {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  joined: boolean;
  removed: boolean;
}
export interface GroupPostView {
  id: string;
  groupId: string;
  authorName: string;
  body: string;
  createdAt: string;
  mine: boolean;
}
export interface AdminGroupView {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  memberCount: number;
  postCount: number;
  openReportCount: number;
  createdAt: string;
}
export interface AdminGroupPost {
  id: string;
  body: string;
  status: "VISIBLE" | "HIDDEN" | "DELETED";
  hiddenReason: string | null;
  authorUserId: string;
  authorName: string;
  reportCount: number;
  createdAt: string;
}
export interface AdminGroupMember {
  userId: string;
  name: string;
  status: "ACTIVE" | "REMOVED";
  joinedAt: string;
  removedReason: string | null;
}
