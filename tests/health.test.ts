import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/health/route";

describe("GET /api/v1/health", () => {
  it("reports ok with a live database connection", async () => {
    const req = new NextRequest("http://localhost/api/v1/health");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: { status: "ok", database: "connected" },
      message: "OK",
    });
  });
});
