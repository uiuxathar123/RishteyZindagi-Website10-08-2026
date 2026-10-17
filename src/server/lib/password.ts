/**
 * Password hashing — bcrypt via bcryptjs (pure JS, no native build step,
 * so it installs and runs the same in every environment including this
 * sandbox). Cost factor 12 is bcrypt's commonly-recommended production
 * default as of 2026 (balances hash time vs. brute-force resistance).
 * Nothing outside this file ever calls bcrypt directly, so the algorithm
 * and cost factor can only change in one place.
 *
 * bcrypt is deliberately slow CPU work (about a third of a second per call
 * at cost 12). bcryptjs runs it on the calling thread, so on the main thread
 * concurrent logins queue behind each other and every other request waits
 * too. The work therefore runs on a small pool of worker threads, using the
 * same bcryptjs library, so hashes, the cost factor and the comparison are
 * byte-for-byte what they were. If a worker thread cannot be started (or
 * cannot load bcryptjs), the call runs on the calling thread exactly as
 * before, so a password check never fails because of the pool.
 */
import bcrypt from "bcryptjs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

const SALT_ROUNDS = 12;

/** At most four threads (bcrypt is CPU-bound), and never all the cores. */
const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));

// Runs inside each worker. Plain CommonJS so it needs no bundling; bcryptjs is
// resolved from the app's node_modules, the same package the main thread uses.
const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const bcrypt = require("bcryptjs");
parentPort.on("message", (task) => {
  try {
    const result = task.op === "hash" ? bcrypt.hashSync(task.plain, task.rounds) : bcrypt.compareSync(task.plain, task.hash);
    parentPort.postMessage({ id: task.id, result });
  } catch (err) {
    parentPort.postMessage({ id: task.id, error: err && err.message ? String(err.message) : "bcrypt failed" });
  }
});
`;

type TaskInput = { op: "hash"; plain: string; rounds: number } | { op: "compare"; plain: string; hash: string };
type Task = TaskInput & { id: number };
type Reply = { id: number; result?: string | boolean; error?: string };

interface Pending {
  task: Task;
  resolve: (value: string | boolean) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  current: Pending | null;
}

const slots: Slot[] = [];
const queue: Pending[] = [];
let nextId = 1;
let poolDisabled = false;
let completedOnWorkers = 0;
let completedOnMainThread = 0;

/** The pre-pool behaviour, used when no worker thread is available. */
async function runOnMainThread(task: Task): Promise<string | boolean> {
  completedOnMainThread += 1;
  return task.op === "hash" ? bcrypt.hash(task.plain, task.rounds) : bcrypt.compare(task.plain, task.hash);
}

function settleOnMainThread(p: Pending): void {
  runOnMainThread(p.task).then(p.resolve, p.reject);
}

function disablePool(): void {
  poolDisabled = true;
  for (const p of queue.splice(0)) settleOnMainThread(p);
}

function startWorker(): Slot | null {
  let worker: Worker;
  try {
    worker = new Worker(WORKER_SOURCE, { eval: true });
  } catch {
    disablePool();
    return null;
  }
  worker.unref(); // an idle worker never keeps the process alive
  const slot: Slot = { worker, current: null };

  worker.on("message", (reply: Reply) => {
    const p = slot.current;
    if (!p || p.task.id !== reply.id) return;
    slot.current = null;
    worker.unref();
    if (reply.error !== undefined) p.reject(new Error(reply.error));
    else {
      completedOnWorkers += 1;
      p.resolve(reply.result as string | boolean);
    }
    dispatch();
  });

  // A worker that dies (for example, bcryptjs could not be loaded) is removed. Its task is
  // re-run on the calling thread; if no worker has ever completed a task, the pool is
  // switched off so later calls go straight to the calling thread.
  const fail = () => {
    const i = slots.indexOf(slot);
    if (i === -1) return;
    slots.splice(i, 1);
    const p = slot.current;
    slot.current = null;
    if (p) settleOnMainThread(p);
    if (completedOnWorkers === 0) disablePool();
    else dispatch();
  };
  worker.on("error", fail);
  worker.on("exit", fail);

  slots.push(slot);
  return slot;
}

function dispatch(): void {
  while (queue.length > 0) {
    let slot = slots.find((s) => s.current === null);
    if (!slot && slots.length < POOL_SIZE && !poolDisabled) slot = startWorker() ?? undefined;
    if (poolDisabled) return; // startWorker failed and already re-ran the queue on the main thread
    if (!slot) return; // every worker is busy; the next reply dispatches again
    const p = queue.shift()!;
    slot.current = p;
    slot.worker.ref(); // keep the process alive while a result is pending
    slot.worker.postMessage(p.task);
  }
}

function run(task: TaskInput): Promise<string | boolean> {
  const full: Task = { ...task, id: nextId++ };
  if (poolDisabled) return runOnMainThread(full);
  return new Promise((resolve, reject) => {
    queue.push({ task: full, resolve, reject });
    dispatch();
  });
}

export async function hashPassword(plain: string): Promise<string> {
  return (await run({ op: "hash", plain, rounds: SALT_ROUNDS })) as string;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return (await run({ op: "compare", plain, hash })) as boolean;
}

/** Test-only: how the work was spread. Never exposes any password or hash. */
export function __passwordPoolStatsForTests() {
  return { poolSize: POOL_SIZE, workers: slots.length, completedOnWorkers, completedOnMainThread, poolDisabled };
}
