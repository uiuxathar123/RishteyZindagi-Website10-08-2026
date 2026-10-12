# B19 — Release readiness matrix

Legend — **PASS (local)**: proven by automated tests and/or the real-HTTP smoke test against a production build, using local mock servers only. **BLOCKED**: needs credentials or network the build environment does not have; not claimed as working. **NOT BUILT**: out of scope.

| # | Feature | Built | Automated tests | Real-HTTP smoke (prod build) | Live provider verified | Notes |
|---|---|---|---|---|---|---|
| 1 | Maintenance mode (Super Admin) | Yes | `b19-site-controls` | `b19` 20–27 | n/a | Admin Panel, health, webhooks, jobs and `/site-status` stay up. |
| 2 | Manual profile approval + Visibility Queue | Yes | `b19-site-controls` | – | n/a | Not retroactive; see B19-P2-4. |
| 3 | Admin MFA (e-mailed code) | Yes | `b19-admin-mfa` | `b19` 30–34 | **BLOCKED** (needs real SMTP) | Break-glass: `npm run admin:disable-mfa`. |
| 4 | Support contact store + contact form + inbox | Yes | `b19-content` | `b19` 40–42 | n/a | Honeypot + rate limits. |
| 5 | Success stories CMS | Yes | `b19-content` | – | n/a | Publishing needs recorded consent; nothing seeded. |
| 6 | Dashboard time-series charts | Yes | `b19-dashboard-security` | `b19` 90 | n/a | Asia/Kolkata days, zero-filled. |
| 7 | Security-events CSV export | Yes | `b19-dashboard-security` | `b19` 91 | n/a | Formula-injection safe; alerting NOT BUILT. |
| 8 | Delegable Plans / Communities screens | Yes | `b19-dashboard-security` | – | n/a | Staff with the permission see them in their menu. |
| 9 | Change e-mail / mobile | Yes | `b19-contact-change` | `b19` 80–82 | **BLOCKED** (real SMTP / SMS) | Code goes to the new contact; other sessions signed out. |
| 10 | Weekly e-mail digest | Yes | `b19-digest` | `b19` 70–73 | **BLOCKED** (real SMTP) | Opt-in, counts only, one per ISO week. |
| 11 | Live chat (SSE) | Yes | `b19-chat-stream` | `b19` 50–54 (through the proxy) | n/a | **SSE, not WebSocket.** Polling fallback kept. |
| 12 | Community groups (member + admin) | Yes | `b19-groups` | `b19` 60–67 | n/a | Admin-curated; reports + hide + remove. |
| 13 | Renewal follow-up (dunning) groundwork | Yes | `b19-dunning` | `b19` 74, 92 | n/a | **Reminders only. No automatic charging.** |
| 14 | Recurring billing / auto-debit | **NOT BUILT** | – | – | – | Needs Razorpay Subscriptions / e-mandate or PhonePe Autopay. |
| 15 | Android app | **NOT BUILT** | – | – | – | Outside the web app. |
| 16 | Security-event alerting | **NOT BUILT** | – | – | – | Listed in B19-P3-4. |
| 17 | Razorpay / SMTP / Fast2SMS / PhonePe against the real services | – | local mocks | local mocks | **BLOCKED** | Run `npm run check:providers` on your machine with TEST keys. |
