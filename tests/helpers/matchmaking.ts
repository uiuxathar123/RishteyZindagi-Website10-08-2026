/**
 * Personal Matchmaking test helpers: configure the service as a Super Admin, build a customer with partner
 * preferences, and call the member / admin routes through their real handlers. The dev payment provider and IN_APP
 * notifications are used throughout — nothing leaves the machine.
 */
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/server/db/client";
import { matchmakingCases, payments } from "@/server/db/schema";
import { GET as getOffer } from "@/app/api/v1/matchmaking/offer/route";
import { POST as mmCheckout } from "@/app/api/v1/matchmaking/checkout/route";
import { GET as getMine, PATCH as patchMine } from "@/app/api/v1/matchmaking/me/route";
import { PUT as putOptOut } from "@/app/api/v1/matchmaking/me/opt-out/route";
import { POST as respondRoute } from "@/app/api/v1/matchmaking/me/suggestions/[suggestionId]/response/route";
import { GET as adminGetSettings, PUT as adminPutSettings } from "@/app/api/v1/admin/matchmaking/settings/route";
import { GET as adminListCases } from "@/app/api/v1/admin/matchmaking/cases/route";
import { GET as adminGetCase } from "@/app/api/v1/admin/matchmaking/cases/[caseId]/route";
import { POST as adminNotes } from "@/app/api/v1/admin/matchmaking/cases/[caseId]/notes/route";
import { POST as adminStatus } from "@/app/api/v1/admin/matchmaking/cases/[caseId]/status/route";
import { GET as adminRecos } from "@/app/api/v1/admin/matchmaking/cases/[caseId]/recommendations/route";
import { POST as adminAddSuggestion } from "@/app/api/v1/admin/matchmaking/cases/[caseId]/suggestions/route";
import { POST as adminSuggestionAction } from "@/app/api/v1/admin/matchmaking/suggestions/[suggestionId]/route";
import { POST as verifyPaymentRoute } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { GET as adminSearchMembers } from "@/app/api/v1/admin/matchmaking/members/route";
import { GET as adminListIntros, POST as adminCreateIntro } from "@/app/api/v1/admin/matchmaking/introductions/route";
import { GET as adminPreviewIntro } from "@/app/api/v1/admin/matchmaking/introductions/preview/route";
import { GET as adminIntroCandidates } from "@/app/api/v1/admin/matchmaking/introductions/candidates/route";
import { GET as adminOverview } from "@/app/api/v1/admin/matchmaking/overview/route";
import { GET as adminDirectory } from "@/app/api/v1/admin/matchmaking/directory/route";
import { GET as adminListInvitations, POST as adminInvite } from "@/app/api/v1/admin/matchmaking/invitations/route";
import { POST as adminRevokeInvitation } from "@/app/api/v1/admin/matchmaking/invitations/[invitationId]/revoke/route";
import { POST as respondInvitation } from "@/app/api/v1/matchmaking/invitations/[invitationId]/response/route";
import { POST as adminWithdrawIntro } from "@/app/api/v1/admin/matchmaking/introductions/[introductionId]/withdraw/route";
import { GET as adminGetCv, POST as adminDecideCv } from "@/app/api/v1/admin/matchmaking/company-verification/[userId]/route";
import { GET as getMyIntros } from "@/app/api/v1/matchmaking/introductions/route";
import { POST as respondIntro } from "@/app/api/v1/matchmaking/introductions/[introductionId]/response/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { MATCHMAKING_CONSENT_VERSION } from "@/server/modules/matchmaking/matchmaking-settings";
import { jreq } from "./pcp";
import { buildReadyProfile, req, type ReadyProfile, type ReferenceIds } from "./profile-fixtures";

const B = "http://localhost/api/v1";
const params = (key: string, v: string) => ({ params: { [key]: v } });

export const SETTINGS = { enabled: true, prices: { INR: 499900, USD: 5999 }, includedMembershipDays: 30 };

export async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

export const api = {
  offer: (token?: string) => getOffer(jreq(`${B}/matchmaking/offer`, { token })),
  checkout: (token: string, body: Record<string, unknown> = { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION }) =>
    mmCheckout(jreq(`${B}/matchmaking/checkout`, { body, token })),
  mine: (token: string) => getMine(jreq(`${B}/matchmaking/me`, { token })),
  patchMine: (token: string, body: unknown) => patchMine(jreq(`${B}/matchmaking/me`, { method: "PATCH", body, token })),
  optOut: (token: string, optOut: boolean) => putOptOut(jreq(`${B}/matchmaking/me/opt-out`, { method: "PUT", body: { optOut }, token })),
  respond: (token: string, suggestionId: string, response: string) =>
    respondRoute(jreq(`${B}/matchmaking/me/suggestions/${suggestionId}/response`, { body: { response }, token }), params("suggestionId", suggestionId)),
  verify: (token: string, paymentId: string) => verifyPaymentRoute(jreq(`${B}/payments/${paymentId}/verify`, { body: {}, token }), params("paymentId", paymentId)),
  respondInvitation: (token: string, invitationId: string, body: unknown) =>
    respondInvitation(jreq(`${B}/matchmaking/invitations/${invitationId}/response`, { body, token }), params("invitationId", invitationId)),
  introductions: (token: string) => getMyIntros(jreq(`${B}/matchmaking/introductions`, { token })),
  respondIntroduction: (token: string, introductionId: string, response: string) =>
    respondIntro(jreq(`${B}/matchmaking/introductions/${introductionId}/response`, { body: { response }, token }), params("introductionId", introductionId)),
  admin: {
    searchMembers: (token: string, q: string, scope = "introducible") =>
      adminSearchMembers(jreq(`${B}/admin/matchmaking/members?q=${encodeURIComponent(q)}&scope=${scope}`, { token })),
    previewIntroduction: (token: string, userA: string, userB: string) =>
      adminPreviewIntro(jreq(`${B}/admin/matchmaking/introductions/preview?userA=${userA}&userB=${userB}`, { token })),
    directory: (token: string, qs = "") => adminDirectory(jreq(`${B}/admin/matchmaking/directory${qs}`, { token })),
    listInvitations: (token: string, qs = "") => adminListInvitations(jreq(`${B}/admin/matchmaking/invitations${qs}`, { token })),
    invite: (token: string, body: unknown) => adminInvite(jreq(`${B}/admin/matchmaking/invitations`, { body, token })),
    revokeInvitation: (token: string, invitationId: string) =>
      adminRevokeInvitation(jreq(`${B}/admin/matchmaking/invitations/${invitationId}/revoke`, { body: {}, token }), params("invitationId", invitationId)),
    overview: (token: string) => adminOverview(jreq(`${B}/admin/matchmaking/overview`, { token })),
    introductionCandidates: (token: string, userId: string) => adminIntroCandidates(jreq(`${B}/admin/matchmaking/introductions/candidates?userId=${userId}`, { token })),
    listIntroductions: (token: string, qs = "") => adminListIntros(jreq(`${B}/admin/matchmaking/introductions${qs}`, { token })),
    createIntroduction: (token: string, body: unknown) => adminCreateIntro(jreq(`${B}/admin/matchmaking/introductions`, { body, token })),
    withdrawIntroduction: (token: string, introductionId: string) =>
      adminWithdrawIntro(jreq(`${B}/admin/matchmaking/introductions/${introductionId}/withdraw`, { body: {}, token }), params("introductionId", introductionId)),
    getCompanyVerification: (token: string, userId: string) => adminGetCv(jreq(`${B}/admin/matchmaking/company-verification/${userId}`, { token }), params("userId", userId)),
    decideCompanyVerification: (token: string, userId: string, body: unknown) =>
      adminDecideCv(jreq(`${B}/admin/matchmaking/company-verification/${userId}`, { body, token }), params("userId", userId)),
    getSettings: (token: string) => adminGetSettings(jreq(`${B}/admin/matchmaking/settings`, { token })),
    putSettings: (token: string, body: unknown) => adminPutSettings(jreq(`${B}/admin/matchmaking/settings`, { method: "PUT", body, token })),
    listCases: (token: string, qs = "") => adminListCases(jreq(`${B}/admin/matchmaking/cases${qs}`, { token })),
    getCase: (token: string, caseId: string) => adminGetCase(jreq(`${B}/admin/matchmaking/cases/${caseId}`, { token }), params("caseId", caseId)),
    note: (token: string, caseId: string, body: unknown) => adminNotes(jreq(`${B}/admin/matchmaking/cases/${caseId}/notes`, { body, token }), params("caseId", caseId)),
    status: (token: string, caseId: string, body: unknown) => adminStatus(jreq(`${B}/admin/matchmaking/cases/${caseId}/status`, { body, token }), params("caseId", caseId)),
    recos: (token: string, caseId: string) => adminRecos(jreq(`${B}/admin/matchmaking/cases/${caseId}/recommendations`, { token }), params("caseId", caseId)),
    addSuggestion: (token: string, caseId: string, candidateUserId: string, source = "MANUAL") =>
      adminAddSuggestion(jreq(`${B}/admin/matchmaking/cases/${caseId}/suggestions`, { body: { candidateUserId, source }, token }), params("caseId", caseId)),
    act: (token: string, suggestionId: string, action: string) =>
      adminSuggestionAction(jreq(`${B}/admin/matchmaking/suggestions/${suggestionId}`, { body: { action }, token }), params("suggestionId", suggestionId)),
  },
};

export async function configure(adminToken: string, settings: unknown = SETTINGS) {
  const res = await api.admin.putSettings(adminToken, settings);
  expect(res.status).toBe(200);
}

/** A ready (searchable) customer profile with full partner preferences, so scoring has evidence. */
export async function buildCustomer(prefix: string, refs: ReferenceIds, gender: "MALE" | "FEMALE" = "MALE"): Promise<ReadyProfile> {
  const customer = await buildReadyProfile(prefix, refs, { gender, dateOfBirth: "1992-04-04" });
  const res = await patchPreferences(
    req(
      `${B}/profiles/me/partner-preferences`,
      {
        ageMin: 20,
        ageMax: 45,
        heightMinCm: 140,
        heightMaxCm: 200,
        religionId: refs.religionId,
        communityIds: [refs.communityId],
        maritalStatusIds: [refs.maritalStatusId],
        motherTongueIds: [refs.motherTongueId],
        educationIds: [refs.educationId],
        professionIds: [refs.professionId],
        countryIds: [refs.countryId],
        cityIds: [refs.cityId],
      },
      { token: customer.member.sessionToken, method: "PATCH" }
    )
  );
  expect(res.status).toBe(200);
  return customer;
}

/** Checkout + dev-gateway verify. Returns the case id and payment id. */
export async function buyMatchmaking(token: string, outcome: "SUCCESS" | "FAILED" | "PENDING" = "SUCCESS") {
  const co = await json(await api.checkout(token, { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION, devSimulateOutcome: outcome }));
  expect(co.status, JSON.stringify(co.body)).toBe(201);
  const { caseId, paymentId } = co.body.data.checkout as { caseId: string; paymentId: string };
  const v = await json(await api.verify(token, paymentId));
  return { caseId, paymentId, verify: v };
}

export async function caseRow(caseId: string) {
  const [row] = await db.select().from(matchmakingCases).where(eq(matchmakingCases.id, caseId));
  return row;
}

export async function paymentRow(paymentId: string) {
  const [row] = await db.select().from(payments).where(eq(payments.id, paymentId));
  return row;
}
