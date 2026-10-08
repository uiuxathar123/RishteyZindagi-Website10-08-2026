/** Child-process worker for the multi-process rate-limit test: prints how many of N hits were allowed. */
import "dotenv/config";
import { hitRateLimit } from "../../src/server/lib/rate-limit-store";

async function main() {
  const [key, attempts, limit] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
  let allowed = 0;
  for (let i = 0; i < attempts; i++) {
    const r = await hitRateLimit(key, limit, 60_000);
    if (r.allowed) allowed++;
  }
  console.log(allowed);
  process.exit(0);
}
main();
