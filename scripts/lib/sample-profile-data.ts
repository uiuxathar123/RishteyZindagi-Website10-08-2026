/**
 * Sample-profile generator for LOCAL development and QA only (see scripts/seed-sample-profiles.ts).
 *
 * Builds believable, internally consistent member profiles: name, community, mother tongue, city, education,
 * profession, income, diet, family and "about me" all fit together (a Syrian Christian from Kochi speaks Malayalam,
 * a Jat Sikh in Toronto earns in CAD, a Jain family is vegetarian...). Every person is invented; any likeness to a
 * real person is coincidental. Deterministic: the same seed always produces the same people.
 */

import { drawAvatar } from "../../src/lib/avatar/defaultAvatar";

export type Gender = "MALE" | "FEMALE";

/** Small deterministic PRNG (mulberry32), so a re-run produces the same profiles. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const chance = (p: number) => next() < p;
  const weighted = <T>(xs: ReadonlyArray<readonly [T, number]>): T => {
    const total = xs.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [v, w] of xs) if ((r -= w) <= 0) return v;
    return xs[xs.length - 1][0];
  };
  return { next, int, pick, chance, weighted };
}
export type Rng = ReturnType<typeof rng>;

// ---------------------------------------------------------------------------------------------------- personas

interface Community {
  /** Exact `communities.name` in the reference data. */
  name: string;
  surnames: string[];
}

interface Persona {
  key: string;
  weight: number;
  religion: string;
  motherTongue: string;
  communities: Community[];
  /** "ISO:City" — exact `cities.name` under the country's ISO code. */
  cities: string[];
  first: { MALE: string[]; FEMALE: string[] };
  /** Sikh names carry Singh / Kaur before the family name. */
  middle?: { MALE: string; FEMALE: string };
  diet: ReadonlyArray<readonly ["VEGETARIAN" | "NON_VEGETARIAN" | "EGGETARIAN" | "JAIN" | "VEGAN", number]>;
}

const NRI_GULF = ["AE:Dubai", "AE:Abu Dhabi", "AE:Sharjah", "SA:Riyadh", "SA:Jeddah", "SA:Dammam"];
const NRI_WEST = ["GB:London", "GB:Birmingham", "GB:Manchester", "US:New York", "US:San Francisco", "US:Dallas", "US:Chicago", "CA:Toronto", "AU:Sydney", "AU:Melbourne"];

export const PERSONAS: Persona[] = [
  {
    key: "north-hindu",
    weight: 18,
    religion: "Hindu",
    motherTongue: "Hindi",
    communities: [
      { name: "Brahmin › North Indian Brahmin", surnames: ["Sharma", "Mishra", "Tiwari", "Pandey", "Dubey", "Shukla", "Tripathi", "Upadhyay"] },
      { name: "Kshatriya / Rajput › Rajput / Kshatriya", surnames: ["Rathore", "Chauhan", "Shekhawat", "Tomar", "Parmar", "Sisodia"] },
      { name: "Vaishya / Bania › Bania / Merchant", surnames: ["Agarwal", "Gupta", "Goel", "Bansal", "Mittal", "Garg", "Singhal"] },
      { name: "Other Backward Class (OBC) › Yadav", surnames: ["Yadav"] },
      { name: "Other Backward Class (OBC) › Kurmi / Kushwaha / Koeri", surnames: ["Verma", "Kushwaha", "Sachan", "Katiyar"] },
      { name: "Other Backward Class (OBC) › Jat", surnames: ["Chaudhary", "Malik", "Dahiya", "Sangwan", "Tomar"] },
    ],
    cities: ["IN:Delhi", "IN:Lucknow", "IN:Kanpur", "IN:Jaipur", "IN:Bhopal", "IN:Indore", "IN:Patna", "IN:Chandigarh", "IN:Bengaluru", "IN:Pune", ...NRI_WEST.slice(3, 7)],
    first: {
      MALE: ["Aarav", "Rohan", "Vikram", "Ankit", "Saurabh", "Nikhil", "Abhishek", "Gaurav", "Kunal", "Aditya", "Pranav", "Shubham", "Varun", "Harsh", "Mayank", "Utkarsh", "Akshay", "Siddhant"],
      FEMALE: ["Ananya", "Shreya", "Neha", "Pooja", "Ritika", "Kavya", "Ishita", "Aditi", "Sakshi", "Nidhi", "Tanvi", "Priyanka", "Shivani", "Aakriti", "Muskan", "Vaishnavi", "Garima", "Pallavi"],
    },
    diet: [["VEGETARIAN", 6], ["EGGETARIAN", 2], ["NON_VEGETARIAN", 3]],
  },
  {
    key: "marathi",
    weight: 8,
    religion: "Hindu",
    motherTongue: "Marathi",
    communities: [
      { name: "Other Backward Class (OBC) › Other OBC communities", surnames: ["Patil", "Jadhav", "Pawar", "Shinde", "More", "Gaikwad"] },
      { name: "Vaishya / Bania › Bania / Merchant", surnames: ["Shete", "Lodha", "Kothari"] },
    ],
    cities: ["IN:Mumbai", "IN:Pune", "IN:Nagpur", "IN:Thane", "IN:Navi Mumbai"],
    first: {
      MALE: ["Siddharth", "Omkar", "Aniket", "Tejas", "Prathamesh", "Sagar", "Chinmay", "Ninad", "Rohit", "Amey"],
      FEMALE: ["Sayali", "Rutuja", "Snehal", "Gauri", "Mrunal", "Pallavi", "Ketaki", "Manasi", "Prajakta", "Shruti"],
    },
    diet: [["VEGETARIAN", 3], ["NON_VEGETARIAN", 5], ["EGGETARIAN", 2]],
  },
  {
    key: "gujarati",
    weight: 8,
    religion: "Hindu",
    motherTongue: "Gujarati",
    communities: [{ name: "Vaishya / Bania › Bania / Merchant", surnames: ["Patel", "Shah", "Mehta", "Desai", "Parikh", "Trivedi", "Thakkar", "Bhatt"] }],
    cities: ["IN:Ahmedabad", "IN:Surat", "IN:Mumbai", "GB:London", "GB:Leeds", "US:New York", "US:Chicago", "CA:Toronto"],
    first: {
      MALE: ["Hardik", "Parth", "Dhruv", "Harsh", "Chirag", "Jay", "Karan", "Nisarg", "Mihir", "Yash"],
      FEMALE: ["Krupa", "Hetal", "Dhwani", "Riddhi", "Jinal", "Khushi", "Foram", "Nirali", "Bansari", "Pooja"],
    },
    diet: [["VEGETARIAN", 8], ["EGGETARIAN", 1], ["NON_VEGETARIAN", 1]],
  },
  {
    key: "jain",
    weight: 5,
    religion: "Jain",
    motherTongue: "Gujarati",
    communities: [{ name: "Merchant communities › Agarwal / Oswal / Porwal and related", surnames: ["Shah", "Jain", "Doshi", "Sanghvi", "Mehta", "Kothari", "Bafna"] }],
    cities: ["IN:Mumbai", "IN:Ahmedabad", "IN:Surat", "IN:Indore", "IN:Pune", "GB:London"],
    first: {
      MALE: ["Rishabh", "Parshva", "Saurabh", "Ankit", "Jinesh", "Vardhman", "Harshil"],
      FEMALE: ["Vidhi", "Jinal", "Khushboo", "Mansi", "Prachi", "Shreya", "Siddhi"],
    },
    diet: [["JAIN", 8], ["VEGETARIAN", 2]],
  },
  {
    key: "tamil",
    weight: 6,
    religion: "Hindu",
    motherTongue: "Tamil",
    communities: [
      { name: "Brahmin › South Indian Brahmin", surnames: ["Iyer", "Iyengar", "Subramanian", "Raman", "Venkatesh", "Krishnan"] },
      { name: "Other Backward Class (OBC) › Other OBC communities", surnames: ["Murugan", "Selvam", "Pandian", "Rajendran"] },
    ],
    cities: ["IN:Chennai", "IN:Bengaluru", "US:San Francisco", "US:Seattle", "US:Dallas", "AU:Sydney"],
    first: {
      MALE: ["Karthik", "Arjun", "Vignesh", "Pradeep", "Santhosh", "Ashwin", "Hari", "Sriram", "Balaji"],
      FEMALE: ["Divya", "Lakshmi", "Keerthana", "Meenakshi", "Nandhini", "Swathi", "Janani", "Harini", "Aishwarya"],
    },
    diet: [["VEGETARIAN", 6], ["NON_VEGETARIAN", 3], ["EGGETARIAN", 1]],
  },
  {
    key: "telugu",
    weight: 6,
    religion: "Hindu",
    motherTongue: "Telugu",
    communities: [{ name: "Other Backward Class (OBC) › Other OBC communities", surnames: ["Reddy", "Rao", "Naidu", "Chowdary", "Varma", "Goud"] }],
    cities: ["IN:Hyderabad", "IN:Bengaluru", "US:Dallas", "US:Houston", "US:San Francisco", "US:Chicago"],
    first: {
      MALE: ["Sai Kiran", "Venkat", "Srikanth", "Ravi Teja", "Harsha", "Naveen", "Sandeep", "Pavan"],
      FEMALE: ["Sravani", "Harika", "Bhavana", "Sindhu", "Mounika", "Lavanya", "Keerthi", "Pranathi"],
    },
    diet: [["NON_VEGETARIAN", 6], ["VEGETARIAN", 3], ["EGGETARIAN", 1]],
  },
  {
    key: "kannada",
    weight: 4,
    religion: "Hindu",
    motherTongue: "Kannada",
    communities: [
      { name: "Brahmin › South Indian Brahmin", surnames: ["Bhat", "Rao", "Hegde", "Joshi"] },
      { name: "Other Backward Class (OBC) › Other OBC communities", surnames: ["Gowda", "Shetty", "Naik"] },
    ],
    cities: ["IN:Bengaluru", "IN:Pune", "US:Seattle"],
    first: {
      MALE: ["Pavan", "Darshan", "Manjunath", "Rakesh", "Shreyas", "Chethan", "Vinay"],
      FEMALE: ["Spoorthi", "Rashmi", "Deepika", "Sahana", "Pallavi", "Bhoomika", "Chaitra"],
    },
    diet: [["VEGETARIAN", 5], ["NON_VEGETARIAN", 4], ["EGGETARIAN", 1]],
  },
  {
    key: "malayali-hindu",
    weight: 4,
    religion: "Hindu",
    motherTongue: "Malayalam",
    communities: [{ name: "Other Backward Class (OBC) › Other OBC communities", surnames: ["Nair", "Menon", "Pillai", "Kurup", "Warrier", "Nambiar"] }],
    cities: ["IN:Kochi", "IN:Bengaluru", "AE:Dubai", "AE:Abu Dhabi", "SA:Riyadh"],
    first: {
      MALE: ["Arun", "Vishnu", "Anand", "Sreejith", "Akhil", "Nithin", "Rahul"],
      FEMALE: ["Anjali", "Aswathy", "Parvathy", "Gayathri", "Athira", "Lakshmi", "Devika"],
    },
    diet: [["NON_VEGETARIAN", 6], ["VEGETARIAN", 3], ["EGGETARIAN", 1]],
  },
  {
    key: "kerala-christian",
    weight: 4,
    religion: "Christian",
    motherTongue: "Malayalam",
    communities: [{ name: "Syrian / St. Thomas Christian (Kerala) › Syrian / St. Thomas Christians", surnames: ["Thomas", "Mathew", "Varghese", "Joseph", "Kurian", "George", "Abraham"] }],
    cities: ["IN:Kochi", "IN:Bengaluru", "AE:Dubai", "SA:Jeddah", "GB:Manchester", "AU:Melbourne", "CA:Toronto"],
    first: {
      MALE: ["Joel", "Abin", "Jibin", "Tom", "Ashwin", "Alan", "Jerin", "Kevin"],
      FEMALE: ["Anu", "Riya", "Neenu", "Merin", "Sneha", "Ann Mary", "Teena", "Rose"],
    },
    diet: [["NON_VEGETARIAN", 9], ["EGGETARIAN", 1]],
  },
  {
    key: "catholic",
    weight: 3,
    religion: "Christian",
    motherTongue: "Konkani",
    communities: [{ name: "Goan / Mangalorean Catholic › Catholic communities", surnames: ["D'Souza", "Pinto", "Fernandes", "Lobo", "Rodrigues", "D'Mello", "Saldanha"] }],
    cities: ["IN:Mumbai", "IN:Bengaluru", "IN:Pune", "AE:Dubai", "GB:London", "CA:Toronto"],
    first: {
      MALE: ["Rohan", "Jason", "Clive", "Brian", "Ryan", "Glen", "Nigel"],
      FEMALE: ["Rhea", "Sharon", "Melissa", "Joanne", "Natasha", "Sonia", "Leona"],
    },
    diet: [["NON_VEGETARIAN", 9], ["EGGETARIAN", 1]],
  },
  {
    key: "bengali",
    weight: 6,
    religion: "Hindu",
    motherTongue: "Bengali",
    communities: [
      { name: "Brahmin › Bengali Brahmin", surnames: ["Banerjee", "Chatterjee", "Mukherjee", "Ganguly", "Bhattacharya", "Chakraborty"] },
      { name: "Other Backward Class (OBC) › Other OBC communities", surnames: ["Das", "Saha", "Mondal", "Pal"] },
    ],
    cities: ["IN:Kolkata", "IN:Bengaluru", "IN:Delhi", "IN:Pune", "US:New York", "GB:London"],
    first: {
      MALE: ["Arnab", "Sourav", "Debanjan", "Ritwik", "Aniruddha", "Sayan", "Subhojit", "Indranil"],
      FEMALE: ["Moumita", "Ankita", "Sreyashi", "Rituparna", "Sayantani", "Ishani", "Debolina", "Tanushree"],
    },
    diet: [["NON_VEGETARIAN", 8], ["EGGETARIAN", 1], ["VEGETARIAN", 1]],
  },
  {
    key: "sikh",
    weight: 8,
    religion: "Sikh",
    motherTongue: "Punjabi",
    middle: { MALE: "Singh", FEMALE: "Kaur" },
    communities: [
      { name: "Jat Sikh › Jat clans", surnames: ["Gill", "Sandhu", "Dhillon", "Grewal", "Sidhu", "Brar", "Randhawa"] },
      { name: "Khatri / Arora Sikh › Khatri / Arora", surnames: ["Kohli", "Sethi", "Arora", "Chadha", "Anand", "Bedi"] },
      { name: "General › Singh / Kaur", surnames: ["Bhatia", "Ahluwalia", "Bajwa"] },
    ],
    cities: ["IN:Chandigarh", "IN:Delhi", "CA:Toronto", "CA:Vancouver", "CA:Calgary", "GB:Birmingham", "GB:London", "AU:Melbourne", "US:New York"],
    first: {
      MALE: ["Harpreet", "Gurpreet", "Jaskaran", "Manpreet", "Amandeep", "Karanveer", "Navjot", "Arshdeep", "Gurjot"],
      FEMALE: ["Simran", "Harleen", "Navneet", "Jasleen", "Gurleen", "Prabhjot", "Manmeet", "Ravneet", "Amrit"],
    },
    diet: [["VEGETARIAN", 4], ["NON_VEGETARIAN", 5], ["EGGETARIAN", 1]],
  },
  {
    key: "muslim-sunni",
    weight: 12,
    religion: "Muslim",
    motherTongue: "Urdu",
    communities: [
      { name: "Sunni — Ashraf › Sheikh", surnames: ["Shaikh", "Siddiqui", "Farooqui", "Usmani"] },
      { name: "Sunni — Ashraf › Syed / Sayyed / Mir", surnames: ["Syed", "Hashmi", "Bukhari", "Mir"] },
      { name: "Sunni — Ashraf › Pathan / Khan", surnames: ["Khan", "Pathan", "Yusufzai", "Durrani"] },
      { name: "Sunni — Ashraf › Mughal", surnames: ["Mirza", "Baig", "Beg"] },
      { name: "Sunni — Ajlaf › Ansari / Momin / Julaha", surnames: ["Ansari", "Momin"] },
      { name: "Sunni — Ajlaf › Qureshi / Qasab", surnames: ["Qureshi"] },
    ],
    cities: ["IN:Hyderabad", "IN:Lucknow", "IN:Delhi", "IN:Mumbai", "IN:Bhopal", "IN:Bengaluru", "IN:Kolkata", ...NRI_GULF, "GB:London", "GB:Birmingham", "US:Chicago"],
    first: {
      MALE: ["Ayaan", "Faisal", "Imran", "Sameer", "Arif", "Zaid", "Rehan", "Adnan", "Shoaib", "Danish", "Salman", "Farhan", "Aamir", "Owais"],
      FEMALE: ["Ayesha", "Zoya", "Sana", "Mehreen", "Alina", "Hiba", "Nida", "Fatima", "Areeba", "Sadia", "Uzma", "Rubina", "Huma", "Iqra"],
    },
    diet: [["NON_VEGETARIAN", 10]],
  },
  {
    key: "muslim-shia",
    weight: 3,
    religion: "Muslim",
    motherTongue: "Urdu",
    communities: [{ name: "Shia (Twelver) › Various Ashraf & others", surnames: ["Rizvi", "Zaidi", "Naqvi", "Jafri", "Abidi", "Kazmi"] }],
    cities: ["IN:Lucknow", "IN:Hyderabad", "IN:Delhi", "IN:Mumbai", "AE:Dubai"],
    first: {
      MALE: ["Haider", "Abbas", "Mehdi", "Raza", "Ali", "Kumail", "Hasan"],
      FEMALE: ["Zehra", "Fizza", "Zainab", "Kaneez", "Masooma", "Sakina", "Rida"],
    },
    diet: [["NON_VEGETARIAN", 10]],
  },
  {
    key: "bohra",
    weight: 2,
    religion: "Muslim",
    motherTongue: "Gujarati",
    communities: [{ name: "Bohra (Dawoodi Bohra — Ismaili) › Community specific", surnames: ["Lokhandwala", "Bootwala", "Merchant", "Saifee", "Kapadia", "Rangwala"] }],
    cities: ["IN:Mumbai", "IN:Surat", "IN:Pune", "AE:Dubai"],
    first: {
      MALE: ["Mustafa", "Huzaifa", "Taher", "Murtaza", "Burhanuddin", "Hatim"],
      FEMALE: ["Batul", "Insiya", "Rashida", "Sakina", "Tasneem", "Zahra"],
    },
    diet: [["NON_VEGETARIAN", 9], ["EGGETARIAN", 1]],
  },
];

// ---------------------------------------------------------------------------------------------------- careers

interface Career {
  profession: string;
  educations: string[];
  /** Annual income band, lakh INR, for a mid-career person in India. */
  lakh: [number, number];
  traits: string[];
}

const CAREERS: Career[] = [
  { profession: "Software Engineer", educations: ["Bachelor's — Engineering", "Master's — Engineering"], lakh: [9, 35], traits: ["build products used by thousands of people", "work on cloud platforms", "lead a small engineering team"] },
  { profession: "Data Scientist / Analyst", educations: ["Master's — Science", "Bachelor's — Engineering", "MBA"], lakh: [10, 32], traits: ["work with data to solve business problems", "build forecasting models for a retail company"] },
  { profession: "Doctor", educations: ["Bachelor's — Medicine (MBBS)"], lakh: [12, 40], traits: ["work at a multi-speciality hospital", "am pursuing my post-graduation alongside practice"] },
  { profession: "Chartered Accountant", educations: ["CA / CS / CMA", "Bachelor's — Commerce"], lakh: [10, 30], traits: ["work in audit and taxation", "handle finance for a mid-sized firm"] },
  { profession: "Lawyer", educations: ["Bachelor's — Law"], lakh: [8, 28], traits: ["practise corporate law", "work with a law firm on commercial disputes"] },
  { profession: "Architect", educations: ["Other Professional Degree"], lakh: [6, 20], traits: ["design homes and small commercial spaces", "run a small design studio with two friends"] },
  { profession: "Teacher / Professor", educations: ["Master's — Arts", "Master's — Science", "Doctorate (PhD)"], lakh: [5, 15], traits: ["teach at a reputed college", "love mentoring students"] },
  { profession: "Banking Professional", educations: ["MBA", "Bachelor's — Commerce", "Master's — Commerce"], lakh: [7, 24], traits: ["work in relationship management at a private bank", "work in credit risk"] },
  { profession: "Marketing Professional", educations: ["MBA", "Bachelor's — Arts"], lakh: [7, 25], traits: ["handle brand marketing for a consumer company", "work in digital marketing"] },
  { profession: "Human Resources Professional", educations: ["MBA", "Master's — Arts"], lakh: [6, 18], traits: ["work in talent acquisition", "look after people and culture at a tech company"] },
  { profession: "Civil Engineer", educations: ["Bachelor's — Engineering", "Master's — Engineering"], lakh: [6, 18], traits: ["work on infrastructure projects", "manage construction sites"] },
  { profession: "Mechanical Engineer", educations: ["Bachelor's — Engineering", "Master's — Engineering"], lakh: [6, 20], traits: ["work in automotive design", "work in manufacturing operations"] },
  { profession: "Designer", educations: ["Other Professional Degree", "Bachelor's — Arts"], lakh: [5, 18], traits: ["work as a UI/UX designer", "design interiors for homes"] },
  { profession: "Consultant", educations: ["MBA", "Bachelor's — Engineering"], lakh: [12, 40], traits: ["work in management consulting", "advise companies on strategy"] },
  { profession: "Business Owner / Entrepreneur", educations: ["Bachelor's — Commerce", "MBA"], lakh: [10, 45], traits: ["run our family business", "started my own business a few years ago"] },
  { profession: "Government Employee", educations: ["Bachelor's — Science", "Master's — Arts", "Bachelor's — Commerce"], lakh: [6, 14], traits: ["work in a central government department", "work with a public sector bank"] },
  { profession: "Civil Servant (IAS/IPS/etc.)", educations: ["Master's — Arts", "Bachelor's — Engineering"], lakh: [10, 18], traits: ["serve in the civil services"] },
  { profession: "Pharmacist", educations: ["Other Professional Degree", "Bachelor's — Science"], lakh: [4, 12], traits: ["work with a pharmaceutical company", "manage a hospital pharmacy"] },
  { profession: "Nurse", educations: ["Diploma — Medical", "Bachelor's — Science"], lakh: [4, 10], traits: ["work as a staff nurse in a hospital"] },
  { profession: "Sales Professional", educations: ["MBA", "Bachelor's — Commerce"], lakh: [6, 20], traits: ["lead enterprise sales", "work in B2B sales"] },
];

/** Local currency and a rough India-lakh → local multiplier for NRI cities. */
const CURRENCY: Record<string, { code: string; perLakh: number; floor: number }> = {
  IN: { code: "INR", perLakh: 100_000, floor: 300_000 },
  AE: { code: "AED", perLakh: 4_400, floor: 72_000 },
  SA: { code: "SAR", perLakh: 4_500, floor: 72_000 },
  GB: { code: "GBP", perLakh: 2_600, floor: 30_000 },
  US: { code: "USD", perLakh: 3_200, floor: 58_000 },
  CA: { code: "CAD", perLakh: 4_100, floor: 55_000 },
  AU: { code: "AUD", perLakh: 4_600, floor: 68_000 },
};

const HOBBIES = [
  "reading", "travelling", "cooking", "long drives", "trekking", "photography", "badminton", "cricket", "music", "playing the guitar",
  "painting", "yoga", "running", "swimming", "board games", "trying new cafes", "gardening", "classical dance", "watching old films", "cycling",
];
const PARENT_JOBS_F = ["Retired government officer", "Businessman", "Retired bank manager", "Doctor", "Professor", "Engineer", "Runs a family business", "Retired army officer", "Chartered accountant"];
const PARENT_JOBS_M = ["Homemaker", "Teacher", "Retired teacher", "Doctor", "Bank officer", "Homemaker", "Runs a boutique", "Homemaker"];

function cityLabel(c: string) {
  return c.split(":")[1];
}

function joinList(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function aboutMe(r: Rng, p: { gender: Gender; first: string; city: string; career: Career; hobbies: string[]; familyType: string; siblings: number; nri: boolean }) {
  const partnerPossessive = p.gender === "MALE" ? "her" : "his";
  const openers = [
    `Hi, I'm ${p.first}. I live in ${p.city} and work as a ${p.career.profession.toLowerCase()}.`,
    `I'm ${p.first}, based in ${p.city}. Professionally, I ${r.pick(p.career.traits)}.`,
    `Thank you for visiting my profile. I'm a ${p.career.profession.toLowerCase()} living in ${p.city}.`,
    `I'm a simple, family-oriented person from ${p.city}, working as a ${p.career.profession.toLowerCase()}.`,
  ];
  const work = [
    `At work I ${r.pick(p.career.traits)}, and I genuinely enjoy what I do.`,
    `I ${r.pick(p.career.traits)} and value a healthy balance between work and family time.`,
    `My work keeps me busy, but I always make time for the people who matter.`,
  ];
  const free = [
    `In my free time I enjoy ${joinList(p.hobbies)}.`,
    `Weekends usually mean ${joinList(p.hobbies)}, or simply time at home with family.`,
    `I love ${joinList(p.hobbies)}, and I'm always happy to learn something new.`,
  ];
  const family = [
    `I come from a ${p.familyType === "JOINT" ? "warm joint" : "close-knit"} family${p.siblings ? ` and have ${p.siblings === 1 ? "one sibling" : `${p.siblings} siblings`}` : ""}.`,
    `Family means a lot to me; my parents have always encouraged us to be independent and grounded.`,
    `We are a ${p.familyType === "JOINT" ? "joint" : "nuclear"} family with simple values and a lot of laughter at home.`,
  ];
  const nri = p.nri ? [`I have been living abroad for a few years, but I'm deeply connected to my roots and visit India often.`] : [];
  const looking = [
    `I'm looking for a kind, understanding partner who values honesty and family, and with whom I can share both responsibilities and fun.`,
    `I hope to meet someone respectful and easy-going — a friend first — and build a happy home together.`,
    `I'd like a partner who is caring, ambitious in ${partnerPossessive} own way, and believes in growing together.`,
    `Looking for a well-educated, grounded partner who respects both families and loves to laugh.`,
  ];
  return [r.pick(openers), r.pick(work), r.pick(free), r.pick(family), ...(p.nri && r.chance(0.7) ? nri : []), r.pick(looking)].join(" ");
}

// ---------------------------------------------------------------------------------------------------- person

export interface SampleProfile {
  index: number;
  name: string;
  email: string;
  mobile: string;
  gender: Gender;
  dateOfBirth: string;
  heightCm: number;
  religion: string;
  community: string;
  motherTongue: string;
  countryIso: string;
  city: string;
  education: string;
  profession: string;
  maritalStatus: string;
  incomeCurrency: string;
  incomeMinAmount: number;
  incomeMaxAmount: number;
  incomeRange: string;
  aboutMe: string;
  lifestyle: { diet: string; smoking: string; drinking: string };
  familyDetails: { familyType: string; familyValues: string; fatherOccupation: string; motherOccupation: string; siblings: number; notes?: string };
  preferences: { ageMin: number; ageMax: number; heightMinCm: number; heightMaxCm: number; sameCommunity: boolean; countries: string[] };
  avatar: { skin: number; hair: number; bg: number; outfit: number; style: "turban" | "beard" | "short" | "long" | "bun" | "hijab" };
  lastActiveDaysAgo: number;
}

export const SAMPLE_EMAIL_DOMAIN = "seed.rishteyzindagi.local";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

export function generateProfiles(count: number, seed = 20261021): SampleProfile[] {
  const r = rng(seed);
  const out: SampleProfile[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; out.length < count; i++) {
    const gender: Gender = out.length % 2 === 0 ? "FEMALE" : "MALE";
    const persona = r.weighted(PERSONAS.map((p) => [p, p.weight] as const));
    const community = r.pick(persona.communities);
    const first = r.pick(persona.first[gender]);
    const surname = r.pick(community.surnames);
    const name = persona.middle ? `${first} ${persona.middle[gender]} ${surname}` : `${first} ${surname}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);

    const cityCode = r.pick(persona.cities);
    const [iso] = cityCode.split(":");
    const nri = iso !== "IN";
    // Indian government jobs are not held abroad; nursing is a less common choice for men.
    const allowNurse = gender === "FEMALE" || r.chance(0.3);
    const career = r.pick(
      CAREERS.filter((c) => !(nri && (c.profession === "Government Employee" || c.profession === "Civil Servant (IAS/IPS/etc.)")) && (allowNurse || c.profession !== "Nurse"))
    );
    const age = gender === "FEMALE" ? r.int(24, 33) : r.int(26, 36);
    const now = new Date();
    const dob = new Date(Date.UTC(now.getUTCFullYear() - age, r.int(0, 11), r.int(1, 28)));
    if (dob > new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()))) dob.setUTCFullYear(dob.getUTCFullYear() - 1);
    const height = gender === "FEMALE" ? r.int(152, 170) : r.int(166, 188);

    // income scales with age inside the career's band; NRI incomes in local currency, rounded nicely
    const seniority = Math.min(1, Math.max(0, (age - 24) / 12));
    const [lo, hi] = career.lakh;
    const midLakh = lo + (hi - lo) * (0.25 + 0.6 * seniority) * (0.85 + r.next() * 0.3);
    const cur = CURRENCY[iso];
    const factor = nri ? 1.6 : 1; // NRI roles usually pay more in real terms
    const round = (n: number) => (cur.code === "INR" ? Math.round(n / 100_000) * 100_000 : Math.round(n / 5_000) * 5_000);
    const minAmt = Math.max(round(midLakh * 0.85 * cur.perLakh * factor), cur.floor);
    const maxAmt = Math.max(round(midLakh * 1.2 * cur.perLakh * factor), round(minAmt * 1.35));
    const fmt = (n: number) => n.toLocaleString(cur.code === "INR" ? "en-IN" : "en-US");
    const incomeRange = `${cur.code} ${fmt(minAmt)} – ${fmt(maxAmt)} per year`;

    const hobbies = Array.from(new Set([r.pick(HOBBIES), r.pick(HOBBIES), r.pick(HOBBIES)])).slice(0, r.int(2, 3));
    const familyType = r.weighted([["NUCLEAR", 7], ["JOINT", 3]] as const);
    const siblings = r.weighted([[0, 2], [1, 5], [2, 3], [3, 1]] as const);
    const diet = r.weighted(persona.diet);
    const drinking = persona.religion === "Muslim" || persona.religion === "Jain" ? "NO" : r.weighted([["NO", nri ? 4 : 7], ["OCCASIONALLY", nri ? 5 : 3]] as const);
    const smoking = r.weighted([["NO", 19], ["OCCASIONALLY", 1]] as const);
    const maritalStatus = r.weighted([["Never Married", 92], ["Divorced", 6], ["Widowed", 2]] as const);

    const sibNotes = siblings
      ? r.pick([
          `${siblings === 1 ? "One" : siblings === 2 ? "Two" : "Three"} ${siblings === 1 ? (r.chance(0.5) ? "elder sister" : "younger brother") : "siblings"}, ${r.pick(["married and settled", "working", "studying"])}.`,
          `${r.chance(0.5) ? "Elder brother" : "Younger sister"} lives in ${cityLabel(r.pick([...persona.cities, "IN:Bengaluru", "IN:Mumbai"]))}.`,
        ])
      : "Only child.";

    const avatarStyle: SampleProfile["avatar"]["style"] =
      gender === "MALE"
        ? persona.religion === "Sikh" && r.chance(0.85)
          ? "turban"
          : persona.religion === "Muslim" && r.chance(0.45)
            ? "beard"
            : r.chance(0.2)
              ? "beard"
              : "short"
        : persona.religion === "Muslim" && r.chance(0.35)
          ? "hijab"
          : r.chance(0.3)
            ? "bun"
            : "long";

    const n = out.length + 1;
    out.push({
      index: n,
      name,
      email: `${slug(first)}.${slug(surname)}.${String(n).padStart(3, "0")}@${SAMPLE_EMAIL_DOMAIN}`,
      // 10-digit, starts with 6 — a block no real seed or test uses (tests use 9xxxxxxxxx).
      mobile: `6${String(200000000 + n).padStart(9, "0")}`,
      gender,
      dateOfBirth: dob.toISOString().slice(0, 10),
      heightCm: height,
      religion: persona.religion,
      community: community.name,
      motherTongue: persona.motherTongue,
      countryIso: iso,
      city: cityLabel(cityCode),
      education: r.pick(career.educations),
      profession: career.profession,
      maritalStatus,
      incomeCurrency: cur.code,
      incomeMinAmount: minAmt,
      incomeMaxAmount: maxAmt,
      incomeRange,
      aboutMe: aboutMe(r, { gender, first, city: cityLabel(cityCode), career, hobbies, familyType, siblings, nri }),
      lifestyle: { diet, smoking, drinking },
      familyDetails: {
        familyType,
        familyValues: r.weighted([["TRADITIONAL", 3], ["MODERATE", 6], ["LIBERAL", 2]] as const),
        fatherOccupation: r.pick(PARENT_JOBS_F),
        motherOccupation: r.pick(PARENT_JOBS_M),
        siblings,
        notes: sibNotes,
      },
      preferences: {
        ageMin: gender === "FEMALE" ? age : Math.max(21, age - 7),
        ageMax: gender === "FEMALE" ? age + 6 : age + 1,
        heightMinCm: gender === "FEMALE" ? height + 2 : 150,
        heightMaxCm: gender === "FEMALE" ? 195 : height - 1,
        sameCommunity: r.chance(0.45),
        countries: nri ? [iso, "IN"] : r.chance(0.3) ? ["IN", "AE", "US", "GB", "CA"] : ["IN"],
      },
      avatar: { skin: r.int(0, 5), hair: r.int(0, 3), bg: r.int(0, 7), outfit: r.int(0, 7), style: avatarStyle },
      lastActiveDaysAgo: r.weighted([[0, 3], [1, 3], [3, 3], [6, 2], [12, 1]] as const),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- avatar

/** A flat illustrated portrait (no real person's likeness), drawn by the same generator the website uses. */
export function avatarSvg(p: SampleProfile): string {
  return drawAvatar({
    gender: p.gender,
    ...p.avatar,
    bindi: p.gender === "FEMALE" && (p.religion === "Hindu" || p.religion === "Jain"),
    cross: p.religion === "Christian",
  });
}
