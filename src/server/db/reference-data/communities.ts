/**
 * Religion → community/caste reference data. B16: this is now the SEED
 * SOURCE for the `communities` lookup table (see `seedCommunities()` in
 * ../seed.ts) — the UI no longer reads it directly; it reads the seeded
 * rows through `GET /reference/profile-options`.
 *
 * Originally compiled for the "Community" field used alongside Religion
 * in search filters, the profile editor (Basic Details + Partner
 * Preferences), and signup.
 *
 * Source: user-supplied dataset compiled from Census of India patterns,
 * Pew Research and sociological studies (Imtiaz Ahmad et al.). Only the
 * neutral, structural columns (Sect/Group, Caste/Biradari, common
 * surnames) are surfaced in the UI — exactly how community/caste fields
 * work on real matrimonial platforms. The source dataset's "Notes" column
 * (socio-economic/reservation-category commentary such as "Upper class",
 * "OBC", "Historically disadvantaged") is deliberately NOT shown as UI
 * copy; it is kept here only as a code comment on each group for future
 * reference, since labelling people by class in a dropdown would be both
 * unnecessary for matchmaking and needlessly reductive.
 *
 * Per the source dataset, Ahmadiyya was excluded at the original
 * compiler's request. Surname lists are common patterns, not proof of
 * caste — many surnames overlap across communities and vary by region.
 */

export interface CommunityGroup {
  /** Stable option value, e.g. "muslim-sunni-ashraf-syed" */
  id: string;
  /** "Caste / Biradari / Sub-group" — shown as the option label */
  name: string;
  /** Common surnames associated with this group (reference only, not rendered as a separate field) */
  surnames: string[];
}

export interface CommunitySect {
  /** "Sect / Major Group" — used as the <optgroup> label */
  sect: string;
  groups: CommunityGroup[];
}

export interface ReligionCommunity {
  religion: string;
  sects: CommunitySect[];
}

export const COMMUNITY_DATA: ReligionCommunity[] = [
  {
    religion: "Muslim",
    sects: [
      {
        sect: "Sunni — Ashraf",
        groups: [
          // Note: "Upper class — claim Prophet's lineage" (not shown in UI)
          { id: "muslim-sunni-ashraf-syed", name: "Syed / Sayyed / Mir", surnames: ["Syed", "Rizvi", "Naqvi", "Zaidi", "Jafri", "Kazmi", "Mir"] },
          // Note: "Upper class" (not shown in UI)
          { id: "muslim-sunni-ashraf-sheikh", name: "Sheikh", surnames: ["Siddiqui", "Farooqui", "Usmani", "Qureshi", "Ansari (some)"] },
          // Note: "Upper class — Afghan origin claim" (not shown in UI)
          { id: "muslim-sunni-ashraf-pathan", name: "Pathan / Khan", surnames: ["Khan", "Afridi", "Yusufzai", "Lodhi", "Rohilla"] },
          // Note: "Upper class — Turko-Mongol claim" (not shown in UI)
          { id: "muslim-sunni-ashraf-mughal", name: "Mughal", surnames: ["Mirza", "Baig", "Chughtai"] },
        ],
      },
      {
        sect: "Sunni — Ajlaf",
        groups: [
          // Note: "Weavers — mostly OBC" (not shown in UI)
          { id: "muslim-sunni-ajlaf-ansari", name: "Ansari / Momin / Julaha", surnames: ["Ansari", "Momin"] },
          // Note: "Butchers — mostly OBC" (not shown in UI)
          { id: "muslim-sunni-ajlaf-qureshi", name: "Qureshi / Qasab", surnames: ["Qureshi"] },
          // Note: "Blacksmiths — OBC" (not shown in UI)
          { id: "muslim-sunni-ajlaf-saifi", name: "Saifi", surnames: ["Saifi"] },
          // Note: "Barbers — OBC" (not shown in UI)
          { id: "muslim-sunni-ajlaf-salmani", name: "Salmani", surnames: ["Salmani"] },
          // Note: "Vegetable sellers — OBC" (not shown in UI)
          { id: "muslim-sunni-ajlaf-raeen", name: "Raeen / Kunjra", surnames: ["Raeen"] },
        ],
      },
      {
        sect: "Sunni — Arzal",
        groups: [
          // Note: "Lowest strata" (not shown in UI)
          { id: "muslim-sunni-arzal", name: "Arzal (Dalit Muslims)", surnames: ["Halalkhor", "Bhangi", "Mehtar"] },
        ],
      },
      {
        sect: "Shia (Twelver)",
        groups: [
          // Note: "Mainly in UP, Bihar, Kashmir" (not shown in UI)
          { id: "muslim-shia", name: "Various Ashraf & others", surnames: ["Often shared with Sunni Ashraf surnames, plus Shia titles"] },
        ],
      },
      {
        sect: "Bohra (Dawoodi Bohra — Ismaili)",
        groups: [
          // Note: "Mostly Gujarat, Maharashtra" (not shown in UI)
          { id: "muslim-bohra", name: "Community specific", surnames: ["Gujarati-style business surnames plus Bohra titles"] },
        ],
      },
      {
        sect: "Khoja (Nizari Ismaili)",
        groups: [
          // Note: "Business community" (not shown in UI)
          { id: "muslim-khoja", name: "Community specific", surnames: ["Gujarati / Kutchi surnames"] },
        ],
      },
    ],
  },
  {
    religion: "Hindu",
    sects: [
      {
        sect: "Brahmin",
        groups: [
          // Note: "Priest / Scholar class" (not shown in UI)
          { id: "hindu-brahmin-north", name: "North Indian Brahmin", surnames: ["Sharma", "Pandey", "Tiwari", "Mishra", "Dubey", "Chaturvedi", "Upadhyay", "Jha"] },
          { id: "hindu-brahmin-bengali", name: "Bengali Brahmin", surnames: ["Mukherjee", "Banerjee", "Chatterjee", "Bhattacharya", "Ganguly"] },
          { id: "hindu-brahmin-south", name: "South Indian Brahmin", surnames: ["Iyer", "Iyengar", "Namboodiri", "Sharma"] },
        ],
      },
      {
        sect: "Kshatriya / Rajput",
        groups: [
          // Note: "Warrior / Ruling class" (not shown in UI)
          { id: "hindu-kshatriya-rajput", name: "Rajput / Kshatriya", surnames: ["Singh", "Chauhan", "Rathore", "Solanki", "Parmar", "Thakur", "Rana", "Sisodia", "Jadeja"] },
        ],
      },
      {
        sect: "Vaishya / Bania",
        groups: [
          // Note: "Trader / Business class" (not shown in UI)
          { id: "hindu-vaishya-bania", name: "Bania / Merchant", surnames: ["Gupta", "Agarwal", "Shah", "Modi", "Bansal", "Goel", "Mittal", "Maheshwari"] },
        ],
      },
      {
        sect: "Other Backward Class (OBC)",
        groups: [
          // Note: "Pastoral / Agricultural" (not shown in UI)
          { id: "hindu-obc-yadav", name: "Yadav", surnames: ["Yadav"] },
          // Note: "Agricultural" (not shown in UI)
          { id: "hindu-obc-kurmi", name: "Kurmi / Kushwaha / Koeri", surnames: ["Kurmi", "Kushwaha", "Koeri"] },
          // Note: "Agricultural — OBC in many states" (not shown in UI)
          { id: "hindu-obc-jat", name: "Jat", surnames: ["Jat"] },
          // Note: "Various occupations" (not shown in UI)
          { id: "hindu-obc-other", name: "Other OBC communities", surnames: ["Lodhi", "Nishad", "Patel (some)", "Reddy (some)"] },
        ],
      },
      {
        sect: "Scheduled Caste (Dalit)",
        groups: [
          // Note: "Historically disadvantaged" (not shown in UI)
          { id: "hindu-sc", name: "Scheduled Caste communities", surnames: ["Paswan", "Valmiki", "Chamar", "Mahar", "Mala", "Madiga", "Jatav", "Kori"] },
        ],
      },
    ],
  },
  {
    religion: "Sikh",
    sects: [
      {
        sect: "Jat Sikh",
        groups: [
          // Note: "Largest & dominant group — landowning" (not shown in UI)
          { id: "sikh-jat", name: "Jat clans", surnames: ["Sidhu", "Gill", "Brar", "Dhillon", "Sandhu", "Bajwa", "Cheema", "Grewal", "Aulakh", "Mann"] },
        ],
      },
      {
        sect: "Khatri / Arora Sikh",
        groups: [
          // Note: "Merchant / Warrior origin" (not shown in UI)
          { id: "sikh-khatri-arora", name: "Khatri / Arora", surnames: ["Kapoor", "Malhotra", "Khanna", "Chopra", "Sethi", "Anand", "Bedi", "Sodhi", "Kohli", "Oberoi"] },
        ],
      },
      {
        sect: "Mazhabi / Ramdasia / Ravidasia",
        groups: [
          // Note: "Scheduled Caste Sikhs" (not shown in UI)
          { id: "sikh-mazhabi", name: "Dalit background (SC)", surnames: ["Often Singh/Kaur plus the original caste name, or adopted Jat names"] },
        ],
      },
      {
        sect: "General",
        groups: [
          { id: "sikh-general", name: "Singh / Kaur", surnames: ["Singh (men)", "Kaur (women)"] },
        ],
      },
    ],
  },
  {
    religion: "Christian",
    sects: [
      {
        sect: "Syrian / St. Thomas Christian (Kerala)",
        groups: [
          // Note: "Ancient Christian community" (not shown in UI)
          { id: "christian-syrian", name: "Syrian / St. Thomas Christians", surnames: ["Thomas", "Joseph", "Varghese", "Kurian", "Abraham", "George", "Cherian", "Oommen"] },
        ],
      },
      {
        sect: "Goan / Mangalorean Catholic",
        groups: [
          // Note: "Portuguese influence" (not shown in UI)
          { id: "christian-goan-mangalorean", name: "Catholic communities", surnames: ["D'Souza", "Fernandes", "Pereira", "Rodrigues", "Pinto", "D'Costa", "Dias"] },
        ],
      },
      {
        sect: "Dalit / Convert Christian",
        groups: [
          // Note: "Many face continued social discrimination" (not shown in UI)
          { id: "christian-dalit-convert", name: "Dalit background", surnames: ["Often the original caste surname is kept, or Masih, Das"] },
        ],
      },
      {
        sect: "Tribal Christian (Northeast)",
        groups: [
          // Note: "High concentration in Nagaland, Mizoram, Meghalaya" (not shown in UI)
          { id: "christian-tribal-northeast", name: "Tribal communities", surnames: ["Local tribal surnames"] },
        ],
      },
    ],
  },
  {
    religion: "Jain",
    sects: [
      {
        sect: "Merchant communities",
        groups: [
          // Note: "Very high General Category percentage" (not shown in UI)
          { id: "jain-merchant", name: "Agarwal / Oswal / Porwal and related", surnames: ["Agarwal", "Oswal", "Porwal", "Shah", "Mehta", "Bafna", "Singhal", "Kothari", "Doshi", "Jain"] },
        ],
      },
    ],
  },
  {
    religion: "Buddhist",
    sects: [
      {
        sect: "Navayana / Neo-Buddhist (Ambedkarite)",
        groups: [
          // Note: "~89% identify as Scheduled Caste" (not shown in UI)
          { id: "buddhist-navayana", name: "Ambedkarite Buddhist", surnames: ["Often the original surname is kept (Mahar, Chamar etc.) or Bauddh is added"] },
        ],
      },
      {
        sect: "Traditional (Tibetan / Himalayan)",
        groups: [
          // Note: "Small population" (not shown in UI)
          { id: "buddhist-traditional", name: "Tibetan / Himalayan Buddhist", surnames: ["Various Tibetan / local names"] },
        ],
      },
    ],
  },
];

/** Flat list of religion names that have community/caste data available,
 * in the order they should appear in a Religion select. */
export const RELIGIONS_WITH_COMMUNITY = COMMUNITY_DATA.map((r) => r.religion);

/** Full Religion select list used across the site — the community-mapped
 * religions above, plus catch-alls with no caste tier. */
export const RELIGIONS = [...RELIGIONS_WITH_COMMUNITY, "Other"];

/** Returns the sect → group tree for a given religion, or an empty array
 * if the religion has no community data (e.g. "Other"). Used to build a
 * grouped Community/Caste <select> once a Religion is chosen. */
export function getCommunitySects(religion: string): CommunitySect[] {
  return COMMUNITY_DATA.find((r) => r.religion === religion)?.sects ?? [];
}

/** Looks up a single community group by its id, e.g. to show its common
 * surnames as a hint once selected. */
export function getCommunityGroupById(id: string): CommunityGroup | undefined {
  for (const religion of COMMUNITY_DATA) {
    for (const sect of religion.sects) {
      const match = sect.groups.find((g) => g.id === id);
      if (match) return match;
    }
  }
  return undefined;
}
