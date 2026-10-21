/**
 * Default illustrated avatars, shown wherever a member has no photo (or a photo cannot be shown). The look follows
 * the member's gender and religion — e.g. a turban for a Sikh man, a headscarf for a Muslim woman, a bindi for a
 * Hindu or Jain woman, a small cross for a Christian member — and small details (skin tone, colours) vary by a
 * stable seed (the profile id), so two members do not look identical. It is never a real person's likeness.
 *
 * Display only: an avatar is NOT a profile photo. It does not count towards profile completeness or visibility —
 * search, recommendations and introductions still need a real photo — and it disappears as soon as the member
 * uploads one.
 */

export type AvatarGender = "MALE" | "FEMALE";
export type AvatarStyle = "turban" | "beard" | "short" | "long" | "bun" | "hijab";

export interface AvatarSpec {
  gender: AvatarGender;
  skin: number;
  hair: number;
  bg: number;
  outfit: number;
  style: AvatarStyle;
  bindi: boolean;
  cross: boolean;
}

const SKIN = ["#F1C9A5", "#E0AC83", "#C98E64", "#B07650", "#8E5B3A", "#6E4529"];
const HAIR = ["#1B1411", "#2B1D16", "#3B2A20", "#4A3426"];
const BG = ["#F4E5C4", "#E3ECF7", "#F6E1E5", "#E2F1EA", "#EDE6F6", "#FBE9DA", "#E6EEF0", "#F2EEE3"];
const OUTFIT = ["#7A1F3D", "#1F3B5C", "#2F5D50", "#8A5A12", "#4B3A78", "#9C3D2E", "#355C7D", "#5E4B3C"];
const CLOTH = ["#1F3B5C", "#7A1F3D", "#C17A1E", "#2F5D50", "#E06D2E", "#3D2E6B"];

/** Small stable hash (FNV-1a) so the same seed always gives the same avatar. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The default look for a member: style from gender + religion, small details from the seed. */
export function defaultAvatarSpec(input: { gender: AvatarGender; religion?: string | null; seed: string }): AvatarSpec {
  const h = hash(input.seed);
  const religion = (input.religion ?? "").toLowerCase();
  const female = input.gender === "FEMALE";
  let style: AvatarStyle = female ? (h % 3 === 0 ? "bun" : "long") : "short";
  if (religion === "sikh" && !female) style = "turban";
  if (religion === "muslim") style = female ? "hijab" : "beard";
  return {
    gender: input.gender,
    // the middle four skin tones by default; colours vary by seed
    skin: 1 + (h % 4),
    hair: (h >>> 3) % HAIR.length,
    bg: (h >>> 6) % BG.length,
    outfit: (h >>> 9) % OUTFIT.length,
    style,
    bindi: female && (religion === "hindu" || religion === "jain"),
    cross: religion === "christian",
  };
}

/** Draws an avatar as a 600×600 SVG string. */
export function drawAvatar(a: AvatarSpec): string {
  const skin = SKIN[a.skin % SKIN.length];
  const hair = HAIR[a.hair % HAIR.length];
  const outfit = OUTFIT[a.outfit % OUTFIT.length];
  const bg = BG[a.bg % BG.length];
  const cloth = CLOTH[(a.outfit + 2) % CLOTH.length];
  const p: string[] = [];
  p.push(`<rect width="600" height="600" fill="${bg}"/>`);
  p.push(`<circle cx="300" cy="560" r="300" fill="${bg}" opacity="0.6"/>`);
  // behind the head: long hair, or a headscarf's drape
  if (a.style === "long") p.push(`<path d="M170 300 Q160 170 300 150 Q440 170 430 300 L440 470 Q300 500 160 470 Z" fill="${hair}"/>`);
  if (a.style === "hijab") p.push(`<path d="M160 330 Q150 160 300 140 Q450 160 440 330 L470 520 Q300 560 130 520 Z" fill="${cloth}"/>`);
  // shoulders + neck
  p.push(`<path d="M90 600 Q100 470 230 440 L370 440 Q500 470 510 600 Z" fill="${outfit}"/>`);
  p.push(`<rect x="262" y="370" width="76" height="90" rx="30" fill="${skin}"/>`);
  p.push(`<path d="M230 440 Q300 500 370 440" fill="none" stroke="#00000022" stroke-width="6"/>`);
  if (a.cross) p.push(`<path d="M300 452 L300 486 M289 463 L311 463" stroke="#C99A45" stroke-width="5" stroke-linecap="round"/>`);
  // head + ears
  p.push(`<ellipse cx="300" cy="280" rx="108" ry="128" fill="${skin}"/>`);
  p.push(`<ellipse cx="193" cy="292" rx="16" ry="26" fill="${skin}"/><ellipse cx="407" cy="292" rx="16" ry="26" fill="${skin}"/>`);
  // hair / head covering on top
  if (a.style === "short" || a.style === "beard") p.push(`<path d="M190 262 Q186 150 300 148 Q418 150 410 262 Q392 196 300 198 Q214 198 190 262 Z" fill="${hair}"/>`);
  if (a.style === "long") p.push(`<path d="M192 280 Q190 156 300 152 Q414 158 408 280 Q380 190 300 196 Q226 196 192 280 Z" fill="${hair}"/>`);
  if (a.style === "bun")
    p.push(`<circle cx="300" cy="140" r="46" fill="${hair}"/><path d="M192 280 Q190 160 300 156 Q412 160 408 280 Q384 196 300 198 Q218 198 192 280 Z" fill="${hair}"/>`);
  if (a.style === "hijab") p.push(`<path d="M186 300 Q184 156 300 150 Q416 156 414 300 Q400 200 300 196 Q200 200 186 300 Z" fill="${cloth}"/>`);
  if (a.style === "turban") {
    const t = CLOTH[a.outfit % CLOTH.length];
    // pagri: taller than the head, a peak at the front centre and diagonal folds
    p.push(`<path d="M184 262 Q172 150 226 112 Q300 66 374 112 Q428 150 416 262 Q362 228 300 240 Q238 228 184 262 Z" fill="${t}"/>`);
    p.push(
      `<path d="M300 240 Q292 170 300 92" fill="none" stroke="#00000030" stroke-width="7"/><path d="M198 226 Q250 150 300 140" fill="none" stroke="#00000022" stroke-width="8"/><path d="M402 226 Q350 150 300 140" fill="none" stroke="#00000022" stroke-width="8"/><path d="M206 196 Q256 128 300 118" fill="none" stroke="#0000001a" stroke-width="6"/><path d="M394 196 Q344 128 300 118" fill="none" stroke="#0000001a" stroke-width="6"/>`
    );
  }
  if (a.style === "beard" || a.style === "turban")
    p.push(`<path d="M196 300 Q200 410 300 418 Q400 410 404 300 Q392 360 300 366 Q208 360 196 300 Z" fill="${hair}" opacity="0.92"/>`);
  // face: brows, eyes, nose, smile
  p.push(`<path d="M238 252 Q256 242 274 250" stroke="${hair}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
  p.push(`<path d="M326 250 Q344 242 362 252" stroke="${hair}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
  p.push(`<ellipse cx="257" cy="280" rx="8" ry="9" fill="#2A1A12"/><ellipse cx="343" cy="280" rx="8" ry="9" fill="#2A1A12"/>`);
  p.push(`<path d="M296 296 Q290 318 300 322" stroke="#00000033" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  if (a.style === "beard" || a.style === "turban") p.push(`<path d="M272 346 Q300 362 328 346" stroke="#E9D6C8" stroke-width="5" fill="none" stroke-linecap="round"/>`);
  else p.push(`<path d="M266 344 Q300 368 334 344" stroke="#7A3B2E" stroke-width="6" fill="none" stroke-linecap="round"/>`);
  if (a.bindi) p.push(`<circle cx="300" cy="238" r="5" fill="#B3283F"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">${p.join("")}</svg>`;
}

const cache = new Map<string, string>();

/** A data: URI for the member's default avatar (cached), usable directly as an image src. */
export function defaultAvatarSrc(input: { gender?: string | null; religion?: string | null; seed: string }): string | undefined {
  if (input.gender !== "MALE" && input.gender !== "FEMALE") return undefined;
  const key = `${input.gender}|${input.religion ?? ""}|${input.seed}`;
  let src = cache.get(key);
  if (!src) {
    src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawAvatar(defaultAvatarSpec({ gender: input.gender, religion: input.religion, seed: input.seed })))}`;
    cache.set(key, src);
  }
  return src;
}
