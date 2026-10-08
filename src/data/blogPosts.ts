export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  coverImage: string;
  coverImageAlt: string;
  author: string;
  publishedAt: string;
  readTimeMinutes: number;
  category: string;
  content: string[];
}

/** Demo content-marketing dataset for the public Blog (`(marketing)/blog`).
 * The UI reads through `blogService` (see src/services/blogService.ts);
 * swap this array for a real CMS/API response with no component changes
 * required. Cover photos reuse the same licensed Pexels IDs already
 * referenced elsewhere in this codebase (Hero.tsx, profiles.ts) at varying
 * crop dimensions, per the Pexels License comment convention below. */
export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "how-to-write-a-profile-bio-that-attracts-the-right-match",
    title: "How to Write a Profile Bio That Attracts the Right Match",
    excerpt:
      "Your bio is the first conversation you have with a stranger — before either of you has said a word. Here's how to make it count.",
    // Pexels License — free for commercial use. Photo: "Romantic Couple in
    // Traditional Attire on Steps" by Dhanush N,
    // https://www.pexels.com/photo/37181698/ — reused here at a wider crop
    // as generic warm lifestyle imagery; swap for an approved brand asset
    // with no other changes needed.
    coverImage:
      "https://images.pexels.com/photos/37181698/pexels-photo-37181698.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop",
    coverImageAlt: "Bride and groom in traditional Indian attire sitting together outdoors, smiling.",
    author: "RishteyZindagi Editorial Team",
    publishedAt: "2026-08-18",
    readTimeMinutes: 6,
    category: "Profile Tips",
    content: [
      "A good matrimonial bio does one job well: it gives someone enough of the real you to want to know more. Not a résumé, not a wish list of qualities you're hoping for in return — just an honest, specific picture of who you are and how you live.",
      "Start with substance over adjectives. Writing \"I am fun-loving and family-oriented\" tells a reader almost nothing, because everyone writes that. Instead, show it: \"Sunday mornings usually mean badminton with my brother, then helping my mother with the week's grocery list — I like a routine with people in it.\" The second version says the same thing, but a reader can actually picture your life.",
      "Talk about your work the way you'd describe it to a friend, not a recruiter. What do you actually do day to day, and what part of it do you enjoy? A software engineer who mentions \"I like the puzzle-solving part more than the meetings\" is more memorable than a job title alone. This also naturally signals your pace of life and what a partner should expect to fit around.",
      "Be specific about values, not just words like 'traditional' or 'modern.' Those two words mean different things to every family. If faith, festivals, or family involvement matter to you, say what that looks like in practice — do you visit your parents every weekend, do you want a partner who's comfortable with a joint family setup, is a simple registered wedding fine with you versus a larger family celebration? Specificity here saves both of you time later.",
      "Mention what you're looking for, briefly and kindly. One or two lines about the kind of partnership you want — companionship, shared decision-making, someone who's close to their own family too — is far more useful than a long checklist of preferred height, education, and income. Those filters belong in your partner preferences settings, not your bio; the bio is where a person decides if they like you, not whether you meet a spec.",
      "Keep humor light and self-aware, never self-deprecating in a way that undersells you. A small, true detail — you make questionable puns, you've never successfully kept a houseplant alive, you have strong opinions about filter coffee — does more to make you approachable than trying to sound impressive.",
      "Proofread it out loud. Bios that are written the way you'd actually speak read as more trustworthy than ones stitched together from phrases that sound borrowed. If a line makes you cringe reading it aloud, a stranger will feel that too.",
      "Finally, treat your bio as a living document. As your career, city, or family situation changes, update it — a bio that's a year out of date is a small but real signal to someone reading closely. A few honest, well-chosen sentences will always outperform a long list of adjectives, because they let the right person recognize themselves in what you've written.",
    ],
  },
  {
    slug: "nri-matchmaking-bridging-distance-and-culture",
    title: "NRI Matchmaking: Bridging Distance and Culture",
    excerpt:
      "Searching for a life partner across time zones and continents brings its own questions. Here's how NRI members and their families navigate it well.",
    coverImage:
      "https://images.pexels.com/photos/7580994/pexels-photo-7580994.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop",
    coverImageAlt: "Smiling man in a black dress shirt, studio portrait.",
    author: "RishteyZindagi Editorial Team",
    publishedAt: "2026-08-04",
    readTimeMinutes: 7,
    category: "NRI Guidance",
    content: [
      "For members living in the UAE, Saudi Arabia, Qatar, Kuwait, and beyond, matrimonial search carries an extra layer of planning that members based in India often don't have to think about: time zones, travel logistics, visa timelines, and the practical question of where a couple will eventually settle.",
      "Start by getting genuinely clear — with yourself and your family — on the geography question before you begin serious conversations. Are you looking for someone who will relocate to join you abroad, someone based in India who's open to eventually moving, or are you open to a long-distance-then-together arrangement while paperwork is sorted? Stating this plainly and early in conversations saves everyone real disappointment down the line.",
      "Video calls should happen earlier than they might for a locally-based match, and more than once. A single scripted call rarely tells you much; several relaxed conversations — including one where a parent or sibling from each side joins — build a much truer picture, and they matter more when an in-person meeting requires flights and leave approval.",
      "Cultural fit across geography deserves its own honest conversation. Two people from the same religion and community can still have very different day-to-day lives if one has spent fifteen years in Doha and the other has never left their hometown. Talk openly about festivals, food, language at home, and how connected each of you wants to stay to extended family — these adjust more than most people expect once a couple actually starts living together.",
      "Loop family in deliberately, not just as a formality. Many NRI matches move faster once both families are aligned, because visa sponsorship, engagement timing, and travel all depend on coordinated planning. A family that's informed early can help rather than scramble later — treat their involvement as a practical asset, not just tradition for its own sake.",
      "Be upfront about the realities of the life you're offering, and ask the same in return: cost of living, work hours in your industry and country, how often home visits are realistic, and what support looks like for a partner adjusting to a new country. A little candor here, before commitments are made, builds far more trust than a rosier picture that meets reality only after the wedding.",
      "Verification matters even more across borders, where a face-to-face meeting with a family may not happen until quite late in the process. Lean on verified profiles, ask for references where appropriate, and don't rush past due diligence just because scheduling another call is hard.",
      "Distance is a logistics problem, not a character flaw in the match. Thousands of couples on RishteyZindagi have built strong, lasting partnerships that began across a screen and several time zones — with patience, honesty, and a shared plan, the geography sorts itself out.",
    ],
  },
  {
    slug: "10-questions-to-ask-before-meeting-in-person",
    title: "10 Questions to Ask Before Meeting In Person",
    excerpt:
      "Before you plan a first meeting, a few honest questions in chat can save both of you time — and tell you a lot about how well you'll get along.",
    coverImage:
      "https://images.pexels.com/photos/7580640/pexels-photo-7580640.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop",
    coverImageAlt: "Smiling businessman in a blue dress shirt holding papers.",
    author: "RishteyZindagi Editorial Team",
    publishedAt: "2026-07-21",
    readTimeMinutes: 5,
    category: "Getting Started",
    content: [
      "Chatting before a first meeting isn't small talk to get through — it's genuinely useful information gathering, for both of you. A thoughtful set of questions can tell you more in twenty minutes than an hour of polite pleasantries at a café.",
      "1. What does a typical week look like for you? This tells you about pace of life, work demands, and how much time a relationship realistically fits into right now — far more revealing than asking about hobbies in the abstract.",
      "2. How involved is your family in decisions like this one? Answers here range widely, and knowing where someone sits helps you calibrate expectations for how much you'll be talking to parents versus each other.",
      "3. Where do you see yourself living in the next five years? Especially relevant for NRI matches or anyone whose career might involve relocation — better to know early than assume.",
      "4. How do you handle disagreements? Not a trick question — you're listening for self-awareness, not a perfect answer. Someone who says \"I need a bit of space before I can talk it through calmly\" is telling you something useful about how conflict will actually feel.",
      "5. What does your ideal weekend look like? A simple question that surfaces a lot about energy levels, social preferences, and lifestyle compatibility.",
      "6. How do you feel about combining finances, or keeping things separate? Not a conversation for the first message, necessarily, but worth raising before things get serious — money habits are a leading source of friction later.",
      "7. What matters most to you about faith or tradition in daily life, versus at festivals and milestones? People define \"religious\" and \"traditional\" very differently — specifics matter more than labels.",
      "8. Have you been in a serious relationship before, and what did you learn from it? Asked kindly, this isn't about the past for its own sake — it's about what someone has figured out about themselves.",
      "9. What's something you're currently working on — for yourself, not for a relationship? Career goals, a skill, health, family responsibilities. It tells you what someone is building their life around right now.",
      "10. What would make you feel like this first meeting went well? A surprisingly clarifying question — it often reveals whether someone is looking for a quick decision or a comfortable, low-pressure conversation, so you can match your own expectations to theirs.",
      "None of these need to come as a rapid-fire interview — spread them naturally across a few conversations. The goal isn't to interrogate, it's to walk into that first coffee already knowing you're speaking the same language about what matters.",
    ],
  },
  {
    slug: "understanding-horoscope-matching-tradition-meets-modern-choice",
    title: "Understanding Horoscope Matching: Tradition Meets Modern Choice",
    excerpt:
      "For many families, horoscope compatibility is an important part of the process. Here's what it typically involves — and how to approach it thoughtfully alongside your own judgment.",
    coverImage:
      "https://images.pexels.com/photos/7580948/pexels-photo-7580948.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop",
    coverImageAlt: "Smiling woman seated at an office desk.",
    author: "RishteyZindagi Editorial Team",
    publishedAt: "2026-07-05",
    readTimeMinutes: 6,
    category: "Tradition & Family",
    content: [
      "For a meaningful number of families on RishteyZindagi, horoscope or kundli matching remains an important step in evaluating a potential match — one more lens through which to consider compatibility, alongside conversation, family input, and personal preference.",
      "At its core, most horoscope matching systems compare birth charts across a set of factors — commonly grouped as guna milan in the Vedic tradition — covering areas like temperament, health, and long-term compatibility. Families place different amounts of weight on this: for some it's a deciding factor, for others a confirming one alongside everything else they already feel good about, and for others it isn't part of the process at all.",
      "If horoscope matching is important to your family, it helps to say so early and plainly rather than letting it come up awkwardly later. A simple line in conversation — \"horoscope matching is something my family likes to do before we move forward\" — sets expectations without pressure, and most people appreciate directness over guessing.",
      "It's equally fine if it isn't part of your process. Plenty of successful matches on the platform have been built entirely on compatibility of values, lifestyle, and genuine connection, with no horoscope step at all. Neither approach is more \"serious\" than the other — they're simply different frameworks families use to feel confident about a decision.",
      "When families do weigh it heavily, it's worth having a candid conversation about what happens if the chart comparison comes back with a caution rather than a clear match. Some families treat this as a firm stop, others consult a knowledgeable priest or astrologer for context and remedies, and others weigh it alongside everything else they've observed about the couple's actual compatibility. Knowing your own family's position before you're in that moment avoids a difficult surprise.",
      "If you do want a horoscope comparison done, it's worth finding someone your family trusts and respects — a family priest, a well-regarded astrologer, or a temple you already have a relationship with — rather than a stranger's quick online tool, especially for a decision this significant.",
      "Whatever role horoscope matching plays for you, it works best as one input among several rather than the only one. The conversations you have, the time you spend getting to know someone, and how you each show up for family and daily life together will always tell you things no chart can. Tradition and personal judgment aren't in competition here — most families find they work best side by side.",
    ],
  },
  {
    slug: "involving-your-family-in-the-search-without-losing-your-voice",
    title: "Involving Your Family in the Search Without Losing Your Voice",
    excerpt:
      "Family involvement is one of the things that makes Indian matrimony distinct — and meaningful. Here's how to keep it collaborative rather than one-sided.",
    coverImage:
      "https://images.pexels.com/photos/7580822/pexels-photo-7580822.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop",
    coverImageAlt: "Smiling woman in a blazer against a white background.",
    author: "RishteyZindagi Editorial Team",
    publishedAt: "2026-06-22",
    readTimeMinutes: 6,
    category: "Tradition & Family",
    content: [
      "One thing that sets matrimonial search apart from casual dating is that, for most of our members, it's genuinely a family process — not because anyone is being overruled, but because marriage in most of our members' lives connects two families, not just two people. Done well, that involvement is a strength. Done poorly, it can drown out your own judgment. Here's how to keep the balance.",
      "Set the terms of involvement early, gently, and clearly. A short conversation with your parents about how you'd like to work together — \"I'd love your help shortlisting and I'll always want your read on someone, but I'd like to be the one who decides if there's a connection\" — prevents a lot of friction later, because everyone knows the shape of their role from the start.",
      "Use your family's strengths deliberately. Parents and elders are often genuinely good at certain parts of this process — reading a family's reputation and values, asking practical questions you might not think to ask, and offering perspective on long-term compatibility from having watched marriages unfold over decades. Let them lead on those parts.",
      "Reserve chemistry and daily-life compatibility as your call. No one else can tell you how comfortable you feel talking to someone, whether you laugh at the same things, or whether your day-to-day rhythms fit together — that judgment belongs to you, and it's worth saying so kindly but firmly if a family member's enthusiasm is running ahead of your own.",
      "When you disagree with a family member's view on a match, lead with specifics rather than a flat no. \"I appreciated their family's values, but I didn't feel we connected when we spoke\" gives your parents something concrete to work with, and shows you're taking the process seriously rather than dismissing their effort.",
      "If you're managing a joint profile — where a parent or sibling also has login access or reviews matches — agree in advance on what gets shared and what stays private, especially around conversations that haven't led anywhere yet. A little structure here avoids the awkwardness of a family member weighing in on a match you'd already quietly moved on from.",
      "And if your family's expectations and your own are pulling in genuinely different directions, don't let that go unspoken for long. These conversations are rarely comfortable, but they tend to go better sooner — with patience and respect — than after months of a process that isn't reflecting what you actually want.",
      "The families who navigate this best treat it as a genuine partnership: parents bringing experience and perspective, you bringing the parts of yourself only you can know. Neither voice has to be the only one in the room for the process to feel respectful, or for it to work.",
    ],
  },
  {
    slug: "red-flags-vs-real-concerns-a-practical-guide",
    title: "Red Flags vs. Real Concerns: A Practical Guide",
    excerpt:
      "Not every mismatch is a warning sign, and not every warning sign is obvious at first. Here's how to tell the difference with a clear head.",
    coverImage:
      "https://images.pexels.com/photos/7580984/pexels-photo-7580984.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop",
    coverImageAlt: "Smiling man in a black dress shirt leaning on a desk.",
    author: "RishteyZindagi Editorial Team",
    publishedAt: "2026-06-08",
    readTimeMinutes: 7,
    category: "Safety & Trust",
    content: [
      "In any matrimonial search, you'll come across small mismatches that don't matter and, occasionally, real warning signs that do. Learning to tell the two apart — calmly, without either dismissing genuine concerns or over-reading harmless ones — is one of the most useful skills you can bring to the process.",
      "Start with the everyday mismatches that aren't red flags at all: different taste in food, one of you being more of a homebody, disagreeing on how often to visit extended family, or simply feeling neutral rather than excited after a first conversation. These are normal parts of getting to know someone, not evidence anything is wrong — many strong matches start lukewarm and grow from there once genuine conversation begins.",
      "A real concern, by contrast, tends to repeat or compound rather than being a one-off. One vague answer about someone's job isn't much on its own; several vague or shifting answers across different conversations, especially about verifiable things like education, employment, or marital history, is worth taking seriously.",
      "Pressure is one of the clearest signals worth paying attention to — pressure to move faster than you're comfortable with, to share financial information early, to keep the relationship secret from your own family, or to meet in person before you've had a real conversation. Genuine interest is patient with your pace; pressure to override it is worth noticing.",
      "Inconsistency between what someone says and what their behavior shows is another real signal. Someone who describes themselves as family-oriented but is consistently dismissive or vague whenever family comes up in conversation is giving you useful information — believe the pattern, not just the profile.",
      "Requests for money, gifts, or financial details — in any form, at any stage — are never a normal part of matrimonial conversation and should be treated as a serious concern, not an awkward misunderstanding. Report this immediately using the report option on the profile.",
      "A mismatch in verified information — photos that don't match a video call, an employer or degree that doesn't check out when politely asked about, a profile that seems copied from elsewhere — is also worth pausing on. It's fair, and normal, to ask direct clarifying questions here; someone with nothing to hide will usually welcome the chance to reassure you.",
      "If something feels off and you can't quite name why, that instinct deserves attention too, even before you've identified a specific red flag. You don't owe anyone continued conversation to be polite. Slow down, ask direct questions, involve your family or a trusted friend in reviewing what you're seeing, and use RishteyZindagi's report and support tools whenever something crosses from an odd feeling into an actual concern.",
      "The goal isn't suspicion for its own sake — most people on the platform are exactly who they say they are, here for exactly the reason you are. It's simply about trusting genuine mismatches to work themselves out in conversation, while taking real warning signs seriously the first time they appear, not the third.",
    ],
  },
];
