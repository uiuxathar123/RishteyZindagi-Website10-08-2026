"use client";

/**
 * Real signup against the backend (B1/B2):
 *   1. POST /auth/register            { name, email, mobileNumber, countryCode } -> OTP challenge
 *   2. POST /auth/verify-signup-otp   { identifier, code }                      -> one-time ticket
 *   3. POST /auth/set-password        { identifier, ticket, password }          -> account created + signed in
 *      (the /bff proxy turns the returned session token into an httpOnly cookie)
 *   4. POST /profiles/me              { gender, dateOfBirth }                   -> profile started,
 *      then PATCH /profiles/me with religion/community when chosen.
 * No account exists until step 3. Gender, date of birth, religion and
 * community are profile data, so they are only sent once the session exists.
 */
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { LookupSelect } from "@/components/forms/LookupSelect";
import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { groupCommunities, useReference } from "@/lib/api/lookups";
import type { OtpChallenge, RegisterResponse } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Check, PartyPopper } from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { FieldError, FormAlert } from "./FormAlert";
import { OtpChallengePanel, messageOf } from "./OtpChallengePanel";

const STEPS = ["Basic Details", "Verify OTP", "Set Password", "Done"] as const;

// Markets the product serves first; the backend accepts any +1..+4 digit code.
const COUNTRY_CODES = [
  { code: "+91", label: "India (+91)" },
  { code: "+971", label: "UAE (+971)" },
  { code: "+966", label: "Saudi Arabia (+966)" },
  { code: "+974", label: "Qatar (+974)" },
  { code: "+965", label: "Kuwait (+965)" },
  { code: "+1", label: "USA / Canada (+1)" },
  { code: "+44", label: "United Kingdom (+44)" },
] as const;

type FieldKey = "name" | "gender" | "dateOfBirth" | "mobileNumber" | "email" | "password" | "confirm";
type Errors = Partial<Record<FieldKey, string>>;

interface Details {
  name: string;
  gender: "" | "MALE" | "FEMALE";
  dateOfBirth: string;
  countryCode: string;
  mobileNumber: string;
  email: string;
  religionId: string;
  communityId: string;
}

const EMPTY: Details = {
  name: "",
  gender: "",
  dateOfBirth: "",
  countryCode: "+91",
  mobileNumber: "",
  email: "",
  religionId: "",
  communityId: "",
};

type ProfileStatus = "idle" | "working" | "done" | "error";

function maxDob(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

export function SignupFlow() {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Details>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [registeredKey, setRegisteredKey] = useState<string>("");
  const [ticket, setTicket] = useState<string | null>(null);
  // B18: true when the platform skipped the sign-up code (policy OTP_NOT_REQUIRED).
  const [otpSkipped, setOtpSkipped] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("idle");
  const [profileError, setProfileError] = useState<string | null>(null);

  const ref = useReference({});
  const communityRef = useReference({ religionId: d.religionId || undefined });
  const communityGroups = useMemo(
    () => (d.religionId && communityRef.data?.communities ? groupCommunities(communityRef.data.communities) : []),
    [d.religionId, communityRef.data]
  );

  const set = <K extends keyof Details>(key: K, value: Details[K]) => setD((prev) => ({ ...prev, [key]: value }));

  // ---- step 0: register ----------------------------------------------------
  async function submitDetails(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError(null);

    const mobile = d.mobileNumber.replace(/[\s-]/g, "");
    const email = d.email.trim().toLowerCase();
    const name = d.name.trim();
    const errs: Errors = {};
    if (!name) errs.name = "Please enter your full name.";
    if (!d.gender) errs.gender = "Please choose one.";
    if (!d.dateOfBirth) errs.dateOfBirth = "Please enter your date of birth.";
    else if (d.dateOfBirth > maxDob()) errs.dateOfBirth = "You must be at least 18 years old.";
    if (!/^[0-9]{6,15}$/.test(mobile)) errs.mobileNumber = "Enter 6–15 digits, without the country code.";
    if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = "Enter a valid email address.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const key = JSON.stringify([name, email, mobile, d.countryCode]);
    if (challenge && key === registeredKey) {
      // Same details as the code that was already sent — don't burn another OTP.
      setStep(ticket ? 2 : 1);
      return;
    }

    setPending(true);
    try {
      const c = await api.post<RegisterResponse>("/auth/register", {
        name,
        email,
        mobileNumber: mobile,
        countryCode: d.countryCode,
      });
      setChallenge({ identifier: c.identifier, channel: c.channel === "NONE" ? "EMAIL" : c.channel, expiresInSeconds: c.expiresInSeconds, resendAvailableAt: c.resendAvailableAt });
      setRegisteredKey(key);
      setD((prev) => ({ ...prev, name, email, mobileNumber: mobile }));
      if (c.otpRequired === false && c.ticket) {
        // The platform does not require a code for sign-up: go straight to choosing a password.
        setTicket(c.ticket);
        setOtpSkipped(true);
        setStep(2);
      } else {
        setTicket(null);
        setOtpSkipped(false);
        setStep(1);
      }
    } catch (err) {
      if (isApiError(err)) {
        const map: Errors = {};
        for (const issue of err.details) {
          if (issue.path === "name") map.name = issue.message;
          else if (issue.path === "email") map.email = issue.message;
          else if (issue.path === "mobileNumber") map.mobileNumber = issue.message;
          else if (issue.path === "countryCode") map.mobileNumber = issue.message;
        }
        if (err.kind === "conflict") {
          // The backend says which contact is taken in the message.
          if (/email/i.test(err.message)) map.email = err.message;
          else if (/mobile/i.test(err.message)) map.mobileNumber = err.message;
        }
        setErrors(map);
        if (Object.keys(map).length === 0) setFormError(err.friendlyMessage);
        else if (err.kind === "conflict") setFormError("You may already have an account — try logging in instead.");
      } else {
        setFormError(messageOf(err));
      }
    } finally {
      setPending(false);
    }
  }

  // ---- step 1: verify code -------------------------------------------------
  async function verifyCode(code: string) {
    if (!challenge) return;
    const res = await api.post<{ ticket: string }>("/auth/verify-signup-otp", { identifier: challenge.identifier, code });
    setTicket(res.ticket);
    setStep(2);
  }

  // ---- step 2: set password -> account + session ---------------------------
  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (pending || !challenge || !ticket) return;
    setFormError(null);
    const errs: Errors = {};
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    if (password !== confirm) errs.confirm = "The two passwords don't match.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setPending(true);
    try {
      await api.post("/auth/set-password", { identifier: challenge.identifier, ticket, password });
      setPassword("");
      setConfirm("");
      setStep(3);
      void createProfile();
    } catch (err) {
      if (isApiError(err) && err.kind === "validation") {
        const issue = err.details.find((x) => x.path === "password");
        if (issue) setErrors({ password: issue.message });
        else setFormError(err.friendlyMessage);
      } else if (isApiError(err) && err.kind === "unauthorized") {
        setTicket(null);
        setFormError(otpSkipped ? "Your sign-up session has expired. Please submit your details again." : "Your verification has expired. Please verify your code again.");
        setStep(otpSkipped ? 0 : 1);
      } else if (isApiError(err) && err.kind === "conflict") {
        setFormError(`${err.message} Try logging in instead.`);
      } else {
        setFormError(messageOf(err));
      }
    } finally {
      setPending(false);
    }
  }

  // ---- step 3: start the profile with what was collected --------------------
  async function createProfile() {
    setProfileStatus("working");
    setProfileError(null);
    try {
      try {
        await api.post("/profiles/me", { gender: d.gender, dateOfBirth: d.dateOfBirth });
      } catch (err) {
        // A profile that already exists is fine (retry after a partial failure).
        if (!(isApiError(err) && err.kind === "conflict")) throw err;
      }
      if (d.religionId) {
        await api.patch("/profiles/me", {
          religionId: d.religionId,
          ...(d.communityId ? { communityId: d.communityId } : {}),
        });
      }
      setProfileStatus("done");
    } catch (err) {
      setProfileError(messageOf(err));
      setProfileStatus("error");
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      {/* Stepper */}
      <ol className="mb-8 flex items-center justify-between" aria-label="Signup progress">
        {STEPS.map((baseLabel, i) => {
          const label = i === 1 && otpSkipped ? "No code needed" : baseLabel;
          return (
          <li key={label} className="flex flex-1 items-center last:flex-none" aria-current={i === step ? "step" : undefined}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                  i < step && "border-rz-maroon bg-rz-maroon text-white",
                  i === step && "border-rz-maroon text-rz-maroon",
                  i > step && "border-rz-border text-rz-border"
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={cn("hidden text-[11px] font-medium sm:block", i <= step ? "text-rz-navy" : "text-rz-muted")}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className={cn("mx-2 h-0.5 flex-1 rounded-full", i < step ? "bg-rz-maroon" : "bg-rz-border")} />
            )}
          </li>
          );
        })}
      </ol>

      <div className="rounded-xl border border-rz-border bg-white p-6 shadow-card-sm md:p-8">
        {step === 0 && (
          <form onSubmit={submitDetails} className="space-y-5" noValidate>
            <h2 className="font-serif text-xl font-semibold text-rz-navy">Let&apos;s start with the basics</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="su-name">Full name</FieldLabel>
                <Input
                  id="su-name"
                  autoComplete="name"
                  value={d.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Your name"
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? "su-name-error" : undefined}
                />
                <FieldError id="su-name-error">{errors.name}</FieldError>
              </div>
              <div>
                <FieldLabel htmlFor="su-gender">This profile is for a</FieldLabel>
                <Select
                  id="su-gender"
                  value={d.gender}
                  onChange={(e) => set("gender", e.target.value as Details["gender"])}
                  aria-invalid={errors.gender ? true : undefined}
                  aria-describedby={errors.gender ? "su-gender-error" : undefined}
                >
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="FEMALE">Bride (female)</option>
                  <option value="MALE">Groom (male)</option>
                </Select>
                <FieldError id="su-gender-error">{errors.gender}</FieldError>
              </div>
              <div>
                <FieldLabel htmlFor="su-dob">Date of birth</FieldLabel>
                <Input
                  id="su-dob"
                  type="date"
                  value={d.dateOfBirth}
                  max={maxDob()}
                  onChange={(e) => set("dateOfBirth", e.target.value)}
                  aria-invalid={errors.dateOfBirth ? true : undefined}
                  aria-describedby={errors.dateOfBirth ? "su-dob-error" : undefined}
                />
                <FieldError id="su-dob-error">{errors.dateOfBirth}</FieldError>
              </div>
              <div>
                <FieldLabel htmlFor="su-cc">Country code</FieldLabel>
                <Select id="su-cc" value={d.countryCode} onChange={(e) => set("countryCode", e.target.value)}>
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="su-mobile">Mobile number</FieldLabel>
                <Input
                  id="su-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={d.mobileNumber}
                  onChange={(e) => set("mobileNumber", e.target.value)}
                  placeholder="98765 43210"
                  aria-invalid={errors.mobileNumber ? true : undefined}
                  aria-describedby={errors.mobileNumber ? "su-mobile-error" : undefined}
                />
                <FieldError id="su-mobile-error">{errors.mobileNumber}</FieldError>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="su-email">Email address</FieldLabel>
                <Input
                  id="su-email"
                  type="email"
                  autoComplete="email"
                  value={d.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@example.com"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? "su-email-error" : undefined}
                />
                <FieldError id="su-email-error">{errors.email}</FieldError>
              </div>
              <div>
                <FieldLabel htmlFor="su-religion">Religion (optional)</FieldLabel>
                <LookupSelect
                  id="su-religion"
                  value={d.religionId}
                  onChange={(id) => setD((prev) => ({ ...prev, religionId: id, communityId: "" }))}
                  options={ref.data?.religions}
                  loading={ref.loading}
                  placeholder="Select religion"
                />
              </div>
              {d.religionId && communityGroups.length > 0 && (
                <div>
                  <FieldLabel htmlFor="su-community">Community / caste (optional)</FieldLabel>
                  <LookupSelect
                    id="su-community"
                    value={d.communityId}
                    onChange={(id) => set("communityId", id)}
                    groups={communityGroups}
                    loading={communityRef.loading}
                    placeholder="Select community"
                  />
                </div>
              )}
            </div>
            {formError && <FormAlert tone="error">{formError}</FormAlert>}
            <Button type="submit" fullWidth size="lg" disabled={pending}>
              {pending ? "Sending code…" : "Continue"}
            </Button>
            <p className="text-center text-xs text-rz-muted">
              By continuing you agree to our{" "}
              <Link href="/terms" className="rz-focus font-semibold text-rz-maroon">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy-policy" className="rz-focus font-semibold text-rz-maroon">
                Privacy Policy
              </Link>
              . Already registered?{" "}
              <Link href="/login" className="rz-focus font-semibold text-rz-maroon">
                Log in
              </Link>
            </p>
          </form>
        )}

        {step === 1 && challenge && (
          <div className="space-y-5">
            <h2 className="font-serif text-xl font-semibold text-rz-navy">Verify your {challenge.channel === "EMAIL" ? "email" : "mobile number"}</h2>
            {formError && <FormAlert tone="error">{formError}</FormAlert>}
            <OtpChallengePanel
              idPrefix="su-otp"
              challenge={challenge}
              destination={challenge.channel === "EMAIL" ? d.email : `${d.countryCode} ${d.mobileNumber}`}
              purpose="SIGNUP"
              devIdentifier={challenge.identifier}
              submitLabel="Verify & Continue"
              onSubmit={verifyCode}
              onResend={() =>
                api.post<Omit<OtpChallenge, "identifier">>("/auth/resend-otp", {
                  identifier: challenge.identifier,
                  purpose: "SIGNUP",
                })
              }
              onBack={() => {
                setFormError(null);
                setStep(0);
              }}
              backLabel="Change details"
            />
          </div>
        )}

        {step === 2 && (
          <form onSubmit={submitPassword} className="space-y-5" noValidate>
            <h2 className="font-serif text-xl font-semibold text-rz-navy">Set a password</h2>
            <div>
              <FieldLabel htmlFor="su-password">Password</FieldLabel>
              <Input
                id="su-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? "su-password-error" : undefined}
              />
              <FieldError id="su-password-error">{errors.password}</FieldError>
            </div>
            <div>
              <FieldLabel htmlFor="su-password-confirm">Confirm password</FieldLabel>
              <Input
                id="su-password-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                aria-invalid={errors.confirm ? true : undefined}
                aria-describedby={errors.confirm ? "su-confirm-error" : undefined}
              />
              <FieldError id="su-confirm-error">{errors.confirm}</FieldError>
            </div>
            {formError && <FormAlert tone="error">{formError}</FormAlert>}
            <Button type="submit" fullWidth size="lg" disabled={pending}>
              {pending ? "Creating account…" : "Create Account"}
            </Button>
          </form>
        )}

        {step === 3 && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rz-success/10 text-rz-success">
              <PartyPopper className="h-8 w-8" strokeWidth={1.6} />
            </span>
            <h2 className="font-serif text-2xl font-semibold text-rz-navy">Your account is ready!</h2>
            <p className="max-w-sm text-sm text-rz-muted">
              You&apos;re signed in. Next, complete your profile and set your partner preferences so we can start
              finding your best matches.
            </p>
            {profileStatus === "working" && (
              <p className="text-xs text-rz-muted" role="status">
                Setting up your profile…
              </p>
            )}
            {profileStatus === "error" && (
              <div className="w-full space-y-3 text-left">
                <FormAlert tone="error">
                  Your account was created, but we couldn&apos;t save your profile basics: {profileError}
                </FormAlert>
                <Button variant="outline" size="sm" onClick={() => void createProfile()}>
                  Try again
                </Button>
              </div>
            )}
            <div className="mt-2 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
              {/* Hard navigation: the session cookie was just set, so no cached
                  (signed-out) router state may be reused. */}
              <Button size="lg" disabled={profileStatus === "working"} onClick={() => window.location.assign("/dashboard/profile")}>
                Complete My Profile
              </Button>
              <Button variant="outline" size="lg" onClick={() => window.location.assign("/dashboard")}>
                Go to Dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
