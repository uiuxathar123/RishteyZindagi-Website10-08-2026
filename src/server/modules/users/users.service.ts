import { NotFoundError, AuthorizationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import * as usersRepo from "./users.repository";
import { toPublicUser, type PublicUser } from "./users.dto";

export async function getMe(ctx: AuthContext): Promise<PublicUser> {
  if (ctx.subject.type !== "user") {
    // An admin session hitting a member-only endpoint is an authorization
    // problem, not a 404 — they authenticated fine, they're just the
    // wrong kind of subject for this route.
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  const user = await usersRepo.findById(ctx.subject.id);
  if (!user) throw new NotFoundError("User not found.");
  return toPublicUser(user);
}
