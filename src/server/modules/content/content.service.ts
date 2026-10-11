/**
 * B19: public contact inbox, public support contact details, and CMS-managed success stories.
 *
 *  - Contact form (anonymous): validated, rate-limited, honeypot-guarded; stored in `contact_messages`. Nothing is
 *    echoed back beyond "received". Admins (permission `support.manage`) list and triage them: NEW → READ → RESOLVED.
 *  - Support contact details (e-mail / phone / hours) live in `platform_settings` key `support.contact`; the public
 *    Contact page shows only what has been entered. Editing needs `support.manage`.
 *  - Success stories (`content.manage`): a story can be published only after the admin confirms the couple's consent;
 *    the public endpoint returns published stories only (no e-mail, no ids beyond the story id).
 */
import { createHmac } from "crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { contactMessages, successStories } from "@/server/db/schema";
import { getEnv } from "@/server/config/env";
import { ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import * as settingsRepo from "@/server/modules/platform-settings/platform-settings.repository";

type Meta = { ipAddress?: string | null; userAgent?: string | null };

// ---------------------------------------------------------------------------
// Support contact details
// ---------------------------------------------------------------------------

export interface SupportContact {
  email: string;
  phone: string;
  hours: string;
}
const SUPPORT_KEY = "support.contact";
const supportSchema = z
  .object({
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]),
    phone: z.string().trim().max(40).regex(/^[0-9+()\-\s]*$/, "Phone may contain digits, spaces, + - ( ) only."),
    hours: z.string().trim().max(120),
  })
  .strict();

export async function getPublicSupportContact(): Promise<SupportContact> {
  const empty: SupportContact = { email: "", phone: "", hours: "" };
  const row = await settingsRepo.get(SUPPORT_KEY);
  if (!row) return empty;
  const parsed = supportSchema.safeParse(row.value);
  return parsed.success ? parsed.data : empty;
}

export async function getSupportContactAdmin(ctx: AuthContext) {
  await requirePermission(ctx, "support.manage");
  const row = await settingsRepo.get(SUPPORT_KEY);
  return { contact: await getPublicSupportContact(), updatedAt: row ? row.updatedAt.toISOString() : null };
}

export async function setSupportContact(ctx: AuthContext, input: unknown, meta: Meta) {
  await requirePermission(ctx, "support.manage");
  const parsed = supportSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("The contact details are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const previous = await getPublicSupportContact();
  await settingsRepo.upsert(SUPPORT_KEY, parsed.data, ctx.subject.id);
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "settings.support_contact_changed", entityType: "platform_setting", ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { setting: SUPPORT_KEY, previous, new: parsed.data } });
  return getSupportContactAdmin(ctx);
}

// ---------------------------------------------------------------------------
// Contact messages
// ---------------------------------------------------------------------------

export const CONTACT_TOPICS = ["GENERAL", "ACCOUNT", "BILLING", "SAFETY", "STORY"] as const;
export const CONTACT_STATUSES = ["NEW", "READ", "RESOLVED"] as const;

export const contactInputSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(200),
    topic: z.enum(CONTACT_TOPICS).default("GENERAL"),
    subject: z.string().trim().min(3).max(150),
    message: z.string().trim().min(10).max(3000),
    /** Honeypot: real visitors never see or fill this. */
    website: z.string().max(200).optional(),
  })
  .strict();
export type ContactInput = z.infer<typeof contactInputSchema>;

function ipHash(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", getEnv().AUTH_SECRET).update(`contact:${ip}`).digest("hex").slice(0, 32);
}

/** Returns normally for a honeypot hit too (the bot is told "received"); nothing is stored for it. */
export async function submitContactMessage(input: ContactInput, meta: Meta): Promise<void> {
  if (input.website && input.website.trim() !== "") return;
  await db.insert(contactMessages).values({
    name: input.name,
    email: input.email,
    topic: input.topic,
    subject: input.subject,
    message: input.message,
    ipHash: ipHash(meta.ipAddress),
  });
}

export interface ContactMessageView {
  id: string;
  name: string;
  email: string;
  topic: string;
  subject: string;
  message: string;
  status: string;
  adminNote: string | null;
  handledAt: string | null;
  createdAt: string;
}
const toContactView = (r: typeof contactMessages.$inferSelect): ContactMessageView => ({
  id: r.id,
  name: r.name,
  email: r.email,
  topic: r.topic,
  subject: r.subject,
  message: r.message,
  status: r.status,
  adminNote: r.adminNote ?? null,
  handledAt: r.handledAt ? r.handledAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

export async function listContactMessages(ctx: AuthContext, input: { status?: string; page?: number; pageSize?: number }) {
  await requirePermission(ctx, "support.manage");
  if (input.status && !(CONTACT_STATUSES as readonly string[]).includes(input.status)) throw new ValidationError("status must be NEW, READ or RESOLVED.");
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const where = input.status ? eq(contactMessages.status, input.status) : undefined;
  const [rows, [{ c }], [{ n }]] = await Promise.all([
    db.select().from(contactMessages).where(where).orderBy(desc(contactMessages.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ c: sql<number>`count(*)::int` }).from(contactMessages).where(where),
    db.select({ n: sql<number>`count(*)::int` }).from(contactMessages).where(eq(contactMessages.status, "NEW")),
  ]);
  return { items: rows.map(toContactView), page, pageSize, total: c, newCount: n };
}

export async function updateContactMessage(ctx: AuthContext, id: string, input: { status?: string; adminNote?: string }, meta: Meta): Promise<ContactMessageView> {
  await requirePermission(ctx, "support.manage");
  if (input.status === undefined && input.adminNote === undefined) throw new ValidationError("Provide a status and/or a note.");
  if (input.status !== undefined && !(CONTACT_STATUSES as readonly string[]).includes(input.status)) throw new ValidationError("status must be NEW, READ or RESOLVED.");
  const [existing] = await db.select().from(contactMessages).where(eq(contactMessages.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Message not found.");
  const now = new Date();
  const [row] = await db
    .update(contactMessages)
    .set({
      ...(input.status !== undefined ? { status: input.status, handledByAdminId: ctx.subject.id, handledAt: input.status === "NEW" ? null : now } : {}),
      ...(input.adminNote !== undefined ? { adminNote: input.adminNote.trim().slice(0, 1000) || null } : {}),
    })
    .where(eq(contactMessages.id, id))
    .returning();
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "contact.message_updated", entityType: "contact_message", entityId: id, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { previousStatus: existing.status, newStatus: row.status } });
  return toContactView(row);
}

// ---------------------------------------------------------------------------
// Success stories
// ---------------------------------------------------------------------------

// NOTE: the update schema is built from the default-free fields on purpose. `.partial()` on a field that has a
// `.default()` would silently refill it (e.g. a PATCH of just `year` would un-publish the story and reset its order).
const storyFields = z.object({
  coupleNames: z.string().trim().min(3).max(120),
  location: z.string().trim().min(2).max(120),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  story: z.string().trim().min(30).max(1500),
  sortOrder: z.number().int().min(0).max(9999),
  isPublished: z.boolean(),
  consentConfirmed: z.boolean(),
});
export const storyCreateSchema = storyFields
  .extend({
    sortOrder: storyFields.shape.sortOrder.default(0),
    isPublished: storyFields.shape.isPublished.default(false),
    consentConfirmed: storyFields.shape.consentConfirmed.default(false),
  })
  .strict();
export const storyUpdateSchema = storyFields.partial().strict();

export interface StoryView {
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
const toStoryView = (r: typeof successStories.$inferSelect): StoryView => ({
  id: r.id,
  coupleNames: r.coupleNames,
  location: r.location,
  year: r.year,
  story: r.story,
  isPublished: r.isPublished,
  consentConfirmed: r.consentConfirmed,
  sortOrder: r.sortOrder,
  updatedAt: r.updatedAt.toISOString(),
});

export async function listPublishedStories() {
  const rows = await db.select().from(successStories).where(and(eq(successStories.isPublished, true), eq(successStories.consentConfirmed, true))).orderBy(asc(successStories.sortOrder), desc(successStories.year), asc(successStories.createdAt)).limit(100);
  return rows.map((r) => ({ id: r.id, coupleNames: r.coupleNames, location: r.location, year: r.year, story: r.story }));
}

export async function listStoriesAdmin(ctx: AuthContext) {
  await requirePermission(ctx, "content.manage");
  const rows = await db.select().from(successStories).orderBy(asc(successStories.sortOrder), desc(successStories.createdAt));
  return { stories: rows.map(toStoryView) };
}

function assertPublishable(s: { isPublished: boolean; consentConfirmed: boolean }) {
  if (s.isPublished && !s.consentConfirmed) {
    throw new ConflictError("A story can only be published after you confirm the couple has agreed to it being shown.");
  }
}

export async function createStory(ctx: AuthContext, input: unknown, meta: Meta): Promise<StoryView> {
  await requirePermission(ctx, "content.manage");
  const parsed = storyCreateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("The story is invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  assertPublishable(parsed.data);
  const [row] = await db.insert(successStories).values({ ...parsed.data, createdByAdminId: ctx.subject.id }).returning();
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "story.created", entityType: "success_story", entityId: row.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { isPublished: row.isPublished } });
  return toStoryView(row);
}

export async function updateStory(ctx: AuthContext, id: string, input: unknown, meta: Meta): Promise<StoryView> {
  await requirePermission(ctx, "content.manage");
  const parsed = storyUpdateSchema.safeParse(input);
  if (!parsed.success || Object.keys(parsed.data).length === 0) throw new ValidationError("The story changes are invalid.", parsed.success ? undefined : parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const [existing] = await db.select().from(successStories).where(eq(successStories.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Story not found.");
  assertPublishable({ isPublished: parsed.data.isPublished ?? existing.isPublished, consentConfirmed: parsed.data.consentConfirmed ?? existing.consentConfirmed });
  const [row] = await db.update(successStories).set({ ...parsed.data, updatedAt: new Date() }).where(eq(successStories.id, id)).returning();
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "story.updated", entityType: "success_story", entityId: id, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { wasPublished: existing.isPublished, isPublished: row.isPublished, fields: Object.keys(parsed.data) } });
  return toStoryView(row);
}

export async function deleteStory(ctx: AuthContext, id: string, meta: Meta): Promise<void> {
  await requirePermission(ctx, "content.manage");
  const deleted = await db.delete(successStories).where(eq(successStories.id, id)).returning({ id: successStories.id });
  if (deleted.length === 0) throw new NotFoundError("Story not found.");
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "story.deleted", entityType: "success_story", entityId: id, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
}
