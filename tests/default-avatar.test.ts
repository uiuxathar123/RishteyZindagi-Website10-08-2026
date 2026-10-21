/**
 * Default avatars (lib/avatar/defaultAvatar.ts): the look follows gender + religion, is stable per member, never
 * loads anything external, and is display-only — it never makes a photo-less profile "ready for visibility".
 */
import { describe, it, expect } from "vitest";
import { defaultAvatarSpec, defaultAvatarSrc, drawAvatar } from "@/lib/avatar/defaultAvatar";
import { computeCompletion } from "@/server/modules/profiles/completion";
import type { ProfileRow } from "@/server/modules/profiles/profiles.repository";

const spec = (gender: "MALE" | "FEMALE", religion: string | null, seed = "profile-1") => defaultAvatarSpec({ gender, religion, seed });

describe("default avatar", () => {
  it("[avatar-religion] follows gender and religion", () => {
    expect(spec("MALE", "Sikh").style).toBe("turban");
    expect(spec("FEMALE", "Sikh").style).not.toBe("turban");
    expect(spec("FEMALE", "Muslim").style).toBe("hijab");
    expect(spec("MALE", "Muslim").style).toBe("beard");
    expect(spec("FEMALE", "Hindu").bindi).toBe(true);
    expect(spec("FEMALE", "Jain").bindi).toBe(true);
    expect(spec("MALE", "Hindu").bindi).toBe(false);
    expect(spec("FEMALE", "Christian").cross).toBe(true);
    expect(spec("MALE", "Christian").cross).toBe(true);
    for (const neutral of [null, "Buddhist", "Parsi", "Jewish", "No Religion", "Other"]) {
      const s = spec("FEMALE", neutral);
      expect(["long", "bun"], String(neutral)).toContain(s.style);
      expect(s.bindi || s.cross, String(neutral)).toBe(false);
    }
    // case-insensitive, as names come from reference data
    expect(spec("MALE", "SIKH").style).toBe("turban");
  });

  it("[avatar-stable] the same member always gets the same avatar; different members differ", () => {
    expect(defaultAvatarSrc({ gender: "FEMALE", religion: "Hindu", seed: "abc" })).toBe(defaultAvatarSrc({ gender: "FEMALE", religion: "Hindu", seed: "abc" }));
    const many = new Set(Array.from({ length: 40 }, (_, i) => defaultAvatarSrc({ gender: "MALE", religion: "Hindu", seed: `member-${i}` })));
    expect(many.size).toBeGreaterThan(10);
  });

  it("[avatar-safe] is a self-contained SVG data URI; no gender means no avatar", () => {
    const src = defaultAvatarSrc({ gender: "MALE", religion: "Sikh", seed: "x" })!;
    expect(src.startsWith("data:image/svg+xml")).toBe(true);
    const svg = drawAvatar(spec("MALE", "Sikh"));
    expect(svg).not.toMatch(/href|<script|<image|url\(/i);
    expect(defaultAvatarSrc({ gender: null, religion: "Hindu", seed: "x" })).toBeUndefined();
    expect(defaultAvatarSrc({ gender: "OTHER", religion: "Hindu", seed: "x" })).toBeUndefined();
  });

  it("[avatar-not-a-photo] an avatar never counts as a photo: completeness and visibility are unchanged", () => {
    const filled = {
      gender: "FEMALE",
      dateOfBirth: new Date("1995-01-01"),
      countryId: "c",
      cityId: "c",
      maritalStatusId: "m",
      religionId: "r",
      communityId: "c",
      motherTongueId: "t",
      educationId: "e",
      professionId: "p",
      incomeRange: "INR 10,00,000 – 12,00,000 per year",
      heightCm: 160,
    } as unknown as ProfileRow;
    const noPhoto = computeCompletion(filled, false);
    expect(noPhoto.profileStatus).toBe("COMPLETE"); // not READY_FOR_VISIBILITY without a real photo
    expect(noPhoto.missingRequiredFields).toContain("profilePhoto");
    expect(computeCompletion(filled, true).profileStatus).toBe("READY_FOR_VISIBILITY");
  });
});
