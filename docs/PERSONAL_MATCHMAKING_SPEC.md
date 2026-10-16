# Personal Matchmaking — Draft Specification

**Status: proposal only.** No personal or assisted matchmaking exists in the code today (no relationship-manager role, client assignment, curated shortlist or meeting tracking). This draft builds on what the codebase already has, so it can be reviewed before any design or code work. Every point marked **Owner decision** needs an answer first.

## 1. Goal

Offer a premium, human-assisted service: a relationship manager (RM) works with a paying member ("client") to understand what they want, hand-picks suitable profiles, contacts the other side with consent, and arranges introductions. The self-service product stays unchanged for everyone else.

## 2. What already exists and can be reused

| Need | Existing piece | Where |
|---|---|---|
| Staff identity, roles, permissions | `admin_users`, `admin_roles`, `role_permissions`, `requirePermission()`; Super Admin can create new roles | `src/server/modules/staff/`, `src/server/middleware/rbac.ts` |
| Paid entitlement | Membership plans with a `features` JSON. Today only `features.advancedSearch` is read for enforcement (`hasAdvancedSearchEntitlement`). Chat needs any active membership (`hasActiveMembership`, `features.chat` is not read), and visibility boost comes from the six-month plan duration. A new `features.personalMatchmaking` flag would need its own gate function, following `hasAdvancedSearchEntitlement`. | `membership_plans.features`, `memberships/membership-gate.ts`, `memberships/visibility-boost.ts`, `admin/plans-admin.service.ts` |
| Candidate finding | Search with all filters; recommendation scoring with explanations | `search.service.ts`, `recommendations/` |
| Contacting a member | In-app notifications, e-mail, push | `notifications.service.ts` `notify()` |
| Consent between two members | Interest → accept → match → chat | `interactions.service.ts`, `chat.service.ts` |
| Privacy rules | Hidden profiles, photo visibility, blocks | `profiles/privacy.ts`, `blocks` table |
| Audit trail | `audit_logs` via `record()` | `audit.service.ts` |
| Payments and invoices | Checkout, verify, invoice PDF | `payments/`, `invoices/` |

## 3. Proposed scope (MVP)

1. **Plan:** a new membership plan with `features.personalMatchmaking = true` (Owner decision: price, duration, and whether it includes the normal premium features). The admin plan editor currently accepts only `advancedSearch` as an editable feature (`plans-admin.controller.ts`), so it would need extending.
2. **Role:** a new staff role, for example `RELATIONSHIP_MANAGER`, with new permissions:
   * `matchmaking.clients.view`: see only clients assigned to me.
   * `matchmaking.clients.manage`: notes, shortlist, status for my clients.
   * `matchmaking.assign`: assign or reassign clients (supervisor / Super Admin).
3. **Assignment:** when a member buys the plan, they enter an "unassigned" queue; a supervisor assigns an RM. One active RM per client.
4. **Intake:** the RM records structured requirements (beyond partner preferences) and private notes. The client can see their requirements, not the RM's internal notes (Owner decision).
5. **Curated shortlist:** the RM searches and adds candidate profiles with a reason. The client sees the list in the dashboard and marks Interested / Not interested.
6. **Introduction with consent:** for an "Interested" candidate, the RM sends an introduction request. The candidate sees who is interested and can accept or decline. On acceptance, the system creates the normal accepted interest and match, so chat works through existing rules.
7. **Status tracking:** per candidate: Suggested → Client interested → Introduction sent → Accepted / Declined → Meeting arranged → Closed (Owner decision on the exact stages).
8. **Reporting:** supervisor view of clients per RM, introductions sent and accepted, and time to first introduction.

## 4. Privacy and safety rules (must hold)

* An RM sees only their assigned clients' private data. Candidate profiles are seen exactly as any signed-in member would see them (hidden profiles stay hidden; `ACCEPTED_ONLY` photos stay hidden) unless the candidate opts in (Owner decision).
* No contact details (e-mail, phone) are shown to the RM or the client without explicit consent from the person they belong to.
* A block between two members excludes them from each other's curated lists.
* Every RM action is audited (who viewed which client, which candidate was proposed, every status change).
* Candidates can opt out of being proposed by RMs (new privacy setting).
* An RM can never act as the member (no "log in as") and never sends messages in the member's name.

## 5. Proposed data model (additive tables; not created)

| Table | Key columns |
|---|---|
| `matchmaking_clients` | `user_id` (unique), `membership_id`, `assigned_admin_id`, `status`, `requirements` (jsonb), `created_at`, `closed_at` |
| `matchmaking_notes` | `client_id`, `admin_id`, `body`, `visibility` (INTERNAL / SHARED), `created_at` |
| `matchmaking_candidates` | `client_id`, `candidate_user_id`, `proposed_by_admin_id`, `reason`, `stage`, `client_response`, `candidate_response`, timestamps; unique (`client_id`, `candidate_user_id`) |
| `matchmaking_events` | append-only stage changes (or reuse `audit_logs`) |

## 6. Proposed API (outline)

* Member: `GET /matchmaking/me`, `GET /matchmaking/me/candidates`, `POST /matchmaking/me/candidates/:id/response`, `GET /matchmaking/introductions` (as a candidate), `POST /matchmaking/introductions/:id/response`.
* Staff: `GET /admin/matchmaking/clients`, `GET/PATCH /admin/matchmaking/clients/:id`, `POST /admin/matchmaking/clients/:id/notes`, `POST /admin/matchmaking/clients/:id/candidates`, `POST /admin/matchmaking/candidates/:id/introduce`, `POST /admin/matchmaking/clients/:id/assign`.

All through the existing controller → service → repository pattern, `withErrorHandling`, zod validation, `requirePermission`, and audit.

## 7. Acceptance criteria for the MVP (proposed, to be confirmed with the owner)

1. Buying the matchmaking plan puts the member in the unassigned queue within one request, and the purchase is audited.
2. An RM with only `matchmaking.clients.view` gets 403 for any client not assigned to them (covered by a permission-matrix test like `tests/b18-permission-matrix.test.ts`).
3. A candidate who is hidden, blocked by or blocking the client, or has opted out never appears in the RM's candidate search or the client's curated list.
4. No API response to an RM or client includes another member's e-mail or phone number unless that member consented.
5. A candidate's acceptance of an introduction creates exactly one accepted interest and one match, even if the request is sent twice (idempotent, like the existing interest flow).
6. Every RM action listed in §4 writes an `audit_logs` row; the supervisor report counts match the audit data.
7. Existing members without the plan see no change (existing test suite stays green).

## 8. Compliance and data handling (needs legal input)

* Consent records for candidates being proposed and for sharing contact details, with timestamps, kept for as long as the law requires (India's Digital Personal Data Protection Act, 2023, is the likely framework; to be confirmed by a lawyer).
* Retention and deletion of RM notes when a client's account is deleted (the existing deletion job anonymises users but would not touch new tables unless extended).
* Whether RM notes count as personal data the member can request a copy of.

## 9. Open questions for the owner

1. Is this a separate plan or an add-on to an existing plan? Price and duration?
2. Will RMs be employees using the existing admin panel, or an external agency (needing a separate, narrower panel)?
3. May a candidate who is not a paying member be introduced? (Today, sending interests needs a membership; see D-3.)
4. Should clients see the RM's name and contact, and is there a phone/WhatsApp channel between RM and client?
5. Do meetings happen offline, and should outcomes (meeting held, engaged, married) be recorded?
6. Service levels: how many profiles per week, response times, refund policy if no introductions?
7. Languages the RMs will work in, and regions covered (India only, or NRI markets too)?

## 10. Not in the MVP

Automated AI matching for RMs, video meetings, horoscope matching, family-member accounts, offline event management.
