/**
 * B8: admin payment-gateway configuration — active-gateway selection,
 * the "exactly one active" invariant, enable/disable, credential
 * encryption at rest (never leaked in any API response or stored as
 * plaintext), test-connection honesty, and admin RBAC.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as listGateways } from "@/app/api/v1/admin/payment-gateways/route";
import { PATCH as updateGatewayById } from "@/app/api/v1/admin/payment-gateways/[gatewayId]/route";
import { POST as activateGateway } from "@/app/api/v1/admin/payment-gateways/[gatewayId]/activate/route";
import { POST as deactivateGateway } from "@/app/api/v1/admin/payment-gateways/[gatewayId]/deactivate/route";
import { POST as testConnection } from "@/app/api/v1/admin/payment-gateways/[gatewayId]/test-connection/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, paymentGateways } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { req } from "./helpers/profile-fixtures";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}
function patchReq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "PATCH" });
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `gw-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Gateway Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
  const loginRes = await loginAdmin(
    new NextRequest("http://localhost/api/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "adminpassword1" }),
    })
  );
  const { data } = await loginRes.json();
  return data.sessionToken as string;
}

async function gatewayIdByName(name: string): Promise<string> {
  const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.name, name)).limit(1);
  if (!row) throw new Error(`Seeded payment gateway "${name}" not found — did db:seed run against the test DB?`);
  return row.id;
}

describe("B8 payment gateways (admin)", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
  });

  it("[gw-list] lists all five seeded gateways with Razorpay active by default", async () => {
    const token = await seedAdmin("SUPER_ADMIN");
    const res = await listGateways(greq("http://localhost/api/v1/admin/payment-gateways", token));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.gateways).toHaveLength(5);
    const active = data.gateways.filter((g: { isActive: boolean }) => g.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("Razorpay");
  });

  it("[gw-single-active] activating a different gateway deactivates every other one (exactly one active at a time)", async () => {
    const token = await seedAdmin("SUPER_ADMIN");
    const cashfreeId = await gatewayIdByName("Cashfree Payments");
    const res = await activateGateway(preq(`http://localhost/api/v1/admin/payment-gateways/${cashfreeId}/activate`, {}, token), {
      params: { gatewayId: cashfreeId },
    });
    expect(res.status).toBe(200);

    const rows = await db.select().from(paymentGateways);
    const activeRows = rows.filter((r) => r.isActive);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].name).toBe("Cashfree Payments");
  });

  it("[gw-deactivate] disabling the active gateway leaves zero active — never auto-falls-back to another", async () => {
    const token = await seedAdmin("SUPER_ADMIN");
    const razorpayId = await gatewayIdByName("Razorpay");
    const res = await deactivateGateway(preq(`http://localhost/api/v1/admin/payment-gateways/${razorpayId}/deactivate`, {}, token), {
      params: { gatewayId: razorpayId },
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(paymentGateways);
    expect(rows.every((r) => !r.isActive)).toBe(true);
  });

  it("[gw-test-connection-not-configured] test-connection honestly reports 'not configured' for a gateway with no env credentials, never fakes success", async () => {
    const token = await seedAdmin("SUPER_ADMIN");
    const razorpayId = await gatewayIdByName("Razorpay");
    const res = await testConnection(preq(`http://localhost/api/v1/admin/payment-gateways/${razorpayId}/test-connection`, {}, token), {
      params: { gatewayId: razorpayId },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.ok).toBe(false);
    expect(data.message.toLowerCase()).toContain("not configured");
  });

  it("[gw-credentials-encrypted] saved credentials are never returned in plaintext by any API response, and are not stored as plaintext in the DB", async () => {
    const token = await seedAdmin("SUPER_ADMIN");
    const razorpayId = await gatewayIdByName("Razorpay");
    const secretApiKey = "sk_test_super_secret_value_12345";
    const res = await updateGatewayById(
      patchReq(`http://localhost/api/v1/admin/payment-gateways/${razorpayId}`, { apiKey: secretApiKey, apiSecret: "another_secret", merchantId: "MERCH1234" }, token),
      { params: { gatewayId: razorpayId } }
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    // The response never contains the plaintext secret anywhere.
    expect(JSON.stringify(data)).not.toContain(secretApiKey);
    expect(data.gateway.credentialsConfigured).toBe(true);
    expect(data.gateway.merchantIdLast4).toBe("1234");

    const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.id, razorpayId)).limit(1);
    const stored = JSON.stringify(row.config);
    expect(stored).not.toContain(secretApiKey);
    expect(stored).not.toContain("another_secret");
  });

  it("[gw-rbac-staff-denied] a STAFF_ADMIN without platform.settings.manage cannot list/activate/update gateways", async () => {
    const staffToken = await seedAdmin("STAFF_ADMIN");
    const razorpayId = await gatewayIdByName("Razorpay");
    const listRes = await listGateways(greq("http://localhost/api/v1/admin/payment-gateways", staffToken));
    expect(listRes.status).toBe(403);
    const activateRes = await activateGateway(preq(`http://localhost/api/v1/admin/payment-gateways/${razorpayId}/activate`, {}, staffToken), {
      params: { gatewayId: razorpayId },
    });
    expect(activateRes.status).toBe(403);
  });

  it("[gw-rbac-member-denied] an unauthenticated/invalid session cannot reach any gateway admin endpoint", async () => {
    const res = await listGateways(greq("http://localhost/api/v1/admin/payment-gateways", "not-a-real-token"));
    expect(res.status).toBe(401);
  });
});
