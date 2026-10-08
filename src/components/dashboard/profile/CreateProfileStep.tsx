"use client";

import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import { useState } from "react";
import { Field } from "./SectionCard";
import { GENDER_OPTIONS, inputToInt, issuesByPath } from "./profileForm";

/** First step for an account that has no profile yet: POST /profiles/me with the three fields the backend asks for. */
export function CreateProfileStep({ onCreated }: { onCreated: () => void }) {
  const [gender, setGender] = useState<string>("");
  const [dob, setDob] = useState("");
  const [height, setHeight] = useState("");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const create = useAction(async () => {
    const body: Record<string, unknown> = { gender, dateOfBirth: dob };
    const h = inputToInt(height);
    if (h !== undefined) body.heightCm = h;
    await api.post("/profiles/me", body);
    return true;
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!gender) errs.gender = "Choose Bride or Groom.";
    const t = Date.parse(dob);
    if (!dob || Number.isNaN(t)) errs.dateOfBirth = "Enter your date of birth.";
    else {
      const age = (Date.now() - t) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 18 || age > 100) errs.dateOfBirth = "Age must be between 18 and 100.";
    }
    if (height.trim()) {
      const h = inputToInt(height);
      if (h === undefined || h < 90 || h > 250) errs.heightCm = "Height must be between 90 and 250 cm.";
    }
    setClientErrors(errs);
    if (Object.keys(errs).length) return;
    const created = await create.run();
    if (created) onCreated();
  }

  const err = create.error;
  const issues = { ...issuesByPath(err), ...clientErrors };

  return (
    <div className="rounded-lg border border-rz-border bg-white p-5 md:p-6">
      <h3 className="font-serif text-xl font-semibold text-rz-navy">Create your profile</h3>
      <p className="mt-1 text-sm text-rz-muted">
        You don’t have a profile yet. Start with these basics — you’ll add the rest (religion, education, photos and more) right after.
      </p>
      <form onSubmit={submit} className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2" noValidate>
        <Field id="create-gender" label="This profile is for a" error={issues.gender}>
          <Select id="create-gender" value={gender} onChange={(e) => setGender(e.target.value)} aria-invalid={!!issues.gender}>
            <option value="">Select</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="create-dob" label="Date of birth" error={issues.dateOfBirth}>
          <Input id="create-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} aria-invalid={!!issues.dateOfBirth} />
        </Field>
        <Field id="create-height" label="Height in cm (optional)" error={issues.heightCm}>
          <Input id="create-height" type="number" inputMode="numeric" min={90} max={250} value={height} onChange={(e) => setHeight(e.target.value)} aria-invalid={!!issues.heightCm} />
        </Field>
        <div className="sm:col-span-2" aria-live="polite">
          {err && (
            <p role="alert" className="mb-3 rounded-md border border-rz-danger/30 bg-rz-danger/5 px-3 py-2 text-sm text-rz-danger">
              {err.kind === "conflict" ? "A profile already exists for this account." : err.friendlyMessage}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={create.pending}>
              {create.pending ? "Creating…" : "Create profile"}
            </Button>
            {err?.kind === "conflict" && (
              <Button type="button" variant="outline" onClick={onCreated}>
                Open my profile
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
