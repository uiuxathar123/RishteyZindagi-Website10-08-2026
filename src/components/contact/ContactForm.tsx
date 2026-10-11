"use client";

import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import { FormEvent, useState } from "react";

const TOPICS = [
  { value: "GENERAL", label: "General question" },
  { value: "ACCOUNT", label: "My account" },
  { value: "BILLING", label: "Membership or payment" },
  { value: "SAFETY", label: "A safety concern" },
  { value: "STORY", label: "Share my success story" },
];

/** Public contact form → `POST /contact` (stored in the admin inbox). Works signed-out. */
export function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", topic: "GENERAL", subject: "", message: "", website: "" });
  const [sent, setSent] = useState(false);
  const send = useAction((body: typeof form) => api.post("/contact", { ...body, ...(body.website ? {} : { website: undefined }) }));
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await send.run(form);
    if (res !== null && res !== undefined) setSent(true);
  }

  if (sent) {
    return (
      <div role="status" data-testid="contact-sent" className="rounded-lg border border-rz-border bg-white p-6">
        <p className="font-serif text-lg font-semibold text-rz-navy">Thank you — we have your message.</p>
        <p className="mt-1 text-sm text-rz-muted">Our team will reply to the e-mail address you gave. For anything urgent about safety, please also use the Report option on the member&apos;s profile.</p>
      </div>
    );
  }

  const err = send.error;
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-rz-border bg-white p-5" aria-label="Contact form" data-testid="contact-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="ct-name">Your name</FieldLabel>
          <Input id="ct-name" required minLength={2} maxLength={100} value={form.name} onChange={set("name")} />
        </div>
        <div>
          <FieldLabel htmlFor="ct-email">E-mail</FieldLabel>
          <Input id="ct-email" type="email" required maxLength={200} value={form.email} onChange={set("email")} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="ct-topic">Topic</FieldLabel>
          <Select id="ct-topic" value={form.topic} onChange={set("topic")}>
            {TOPICS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="ct-subject">Subject</FieldLabel>
          <Input id="ct-subject" required minLength={3} maxLength={150} value={form.subject} onChange={set("subject")} />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor="ct-message">Message</FieldLabel>
        <Textarea id="ct-message" required minLength={10} maxLength={3000} rows={6} value={form.message} onChange={set("message")} />
        <p className="mt-1 text-xs text-rz-muted">Please do not include passwords or payment card details.</p>
      </div>
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} /></label>
      </div>
      <div aria-live="polite">
        {err && (
          <p role="alert" className="rounded-md border border-rz-danger/30 bg-rz-danger/5 px-3 py-2 text-[13px] text-rz-danger">
            {err.kind === "rate_limited" ? "You have sent several messages recently. Please try again later." : err.kind === "validation" ? err.firstIssue ?? "Please check the form and try again." : err.friendlyMessage}
          </p>
        )}
      </div>
      <Button type="submit" disabled={send.pending}>{send.pending ? "Sending…" : "Send message"}</Button>
    </form>
  );
}
