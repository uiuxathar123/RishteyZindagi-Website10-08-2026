/**
 * Browser-side hand-off to a real payment gateway. Only PUBLIC values (the Razorpay key id, order id
 * and amount, or a PhonePe redirect URL) ever reach the browser — gateway secrets stay on the server.
 * Nothing here decides whether a payment succeeded: after the gateway returns, the caller always asks
 * OUR server to confirm/verify, and the server checks the signature / asks the gateway directly.
 */

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", cb: (resp: { error?: { description?: string } }) => void) => void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout can only open in a browser."));
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = RAZORPAY_SCRIPT;
    el.async = true;
    el.onload = () => (window.Razorpay ? resolve() : reject(new Error("Razorpay Checkout did not initialise.")));
    el.onerror = () => {
      scriptPromise = null; // allow a retry
      el.remove();
      reject(new Error("Could not load Razorpay Checkout. Check your connection and try again."));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export type RazorpayOutcome =
  | { kind: "paid"; response: RazorpaySuccess }
  | { kind: "dismissed" }
  | { kind: "failed"; message: string };

/** Opens Razorpay Checkout for an order created by OUR server and resolves when the member is done. */
export async function openRazorpayCheckout(opts: {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  planName: string;
  prefill?: { name?: string; email?: string };
}): Promise<RazorpayOutcome> {
  await loadRazorpayScript();
  const Ctor = window.Razorpay as RazorpayCtor;
  return new Promise<RazorpayOutcome>((resolve) => {
    let settled = false;
    const done = (o: RazorpayOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    const rzp = new Ctor({
      key: opts.keyId,
      order_id: opts.orderId,
      amount: opts.amount,
      currency: opts.currency,
      name: "RishteyZindagi",
      description: `${opts.planName} Membership`,
      prefill: opts.prefill,
      theme: { color: "#7a1f2b" },
      handler: (response: RazorpaySuccess) => done({ kind: "paid", response }),
      modal: { ondismiss: () => done({ kind: "dismissed" }) },
    });
    rzp.on("payment.failed", (resp) => done({ kind: "failed", message: resp?.error?.description ?? "The payment did not go through." }));
    rzp.open();
  });
}

/** PhonePe sends the member to its hosted page. Only an https URL is ever followed. */
export function redirectToGateway(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    window.location.assign(u.toString());
    return true;
  } catch {
    return false;
  }
}
