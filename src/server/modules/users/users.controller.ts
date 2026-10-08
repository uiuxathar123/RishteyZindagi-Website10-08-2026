import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ok } from "@/server/lib/response";
import * as usersService from "./users.service";

export async function getMeHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const user = await usersService.getMe(ctx);
  return ok({ user });
}
