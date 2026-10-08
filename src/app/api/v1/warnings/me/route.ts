import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMyWarningsHandler } from "@/server/modules/warnings/warnings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listMyWarningsHandler(req));
