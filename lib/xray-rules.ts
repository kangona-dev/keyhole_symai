// Form X-ray: flags rental application questions that regulators say agents
// don't need. Rules are plain patterns so the check is instant, explainable
// and works with no AI or network.

const OAIC = "Privacy Commissioner determination on 2Apply, April 2026";
const NSW = "NSW renter privacy law, 2026";

export type XrayRule = {
  id: string;
  label: string;
  reason: string;
  source: string;
  pattern: RegExp;
};

export const XRAY_RULES: XrayRule[] = [
  {
    id: "gender",
    label: "Gender",
    reason: "Gender isn't reasonably necessary to assess a rental application.",
    source: OAIC,
    pattern: /\b(gender|sex|pronouns?)\b/i,
  },
  {
    id: "children",
    label: "Children or dependants",
    reason: "Details about children or dependants shouldn't be collected.",
    source: `${NSW} · ${OAIC}`,
    pattern: /\b(child|children|kids?|dependants?|dependents?|son|daughter)\b/i,
  },
  {
    id: "student",
    label: "Student status",
    reason: "Student status isn't reasonably necessary.",
    source: OAIC,
    pattern: /\b(student|studying|enrolled|enrolment|enrollment)\b/i,
  },
  {
    id: "bankruptcy",
    label: "Bankruptcy status",
    reason: "Bankruptcy status was flagged as unnecessary to collect.",
    source: OAIC,
    pattern: /bankrupt/i,
  },
  {
    id: "retirement",
    label: "Retirement status",
    reason: "Retirement status isn't reasonably necessary.",
    source: OAIC,
    pattern: /\bretire/i,
  },
  {
    id: "living-history",
    label: "Previous living history",
    reason: "Details of previous living arrangements were flagged as unnecessary.",
    source: OAIC,
    pattern: /(living (history|situation|arrangements?)|lived with|who (do|did|have) you (live|lived)|reason for (leaving|moving)|why are you (leaving|moving))/i,
  },
  {
    id: "property",
    label: "Property ownership",
    reason: "Owning (or planning to own) a home or investment property isn't reasonably necessary.",
    source: OAIC,
    pattern: /(\bown\b.*\b(property|properties|home|house|apartment|unit)\b|investment propert|home ?owner|property owner)/i,
  },
  {
    id: "other-applications",
    label: "Other rental applications",
    reason: "Whether you've applied for other properties isn't reasonably necessary.",
    source: OAIC,
    pattern: /(\b(applied|applying|applications?)\b.*\b(other|another|elsewhere|more)\b|\bother\b.*\b(applications?|properties)\b)/i,
  },
  {
    id: "assistance",
    label: "Bond or rent assistance",
    reason: "Bond or rent assistance status was flagged as unnecessary.",
    source: OAIC,
    pattern: /((rent|rental|bond)\s+(assistance|loan|help|subsid)|centrelink|government (assistance|support|payments?))/i,
  },
  {
    id: "citizenship",
    label: "Citizenship or visa",
    reason: "Citizenship and visa expiry weren't reasonably necessary to collect.",
    source: OAIC,
    pattern: /(\b(citizen|citizenship|visa|residency|permanent resident|nationality|immigration)\b|stay in australia|leave australia|in australia (until|for)|how long (will|are) you (be )?(staying|in australia))/i,
  },
  {
    id: "social-media",
    label: "Social media",
    reason: "Agents can't ask for your social media accounts.",
    source: NSW,
    pattern: /(social media|instagram|facebook|tiktok|linkedin|twitter|snapchat|\bx profile\b)/i,
  },
  {
    id: "photo",
    label: "Personal photos",
    reason: "Agents can't ask for personal photos of you.",
    source: NSW,
    pattern: /(\b(photo|photograph|picture|image)\b.*\b(you|yourself|applicant|face)\b|\b(selfie|headshot)\b)/i,
  },
  {
    id: "tattoos",
    label: "Tattoos",
    reason: "Agents can't ask about tattoos.",
    source: NSW,
    pattern: /tattoo/i,
  },
];

export type XrayResult = {
  question: string;
  flagged: boolean;
  rule?: { id: string; label: string; reason: string; source: string };
};

/** Removes list numbering like "4." or "4)" from the start of a line. */
export function cleanQuestion(line: string): string {
  return line.replace(/^\s*(\d+[\.\)]|[-*•])\s*/, "").trim();
}

export function parseQuestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(cleanQuestion)
    .filter((q) => q.length > 0);
}

export function xrayQuestion(question: string): XrayResult {
  const hit = XRAY_RULES.find((r) => r.pattern.test(question));
  if (!hit) return { question, flagged: false };
  return {
    question,
    flagged: true,
    rule: { id: hit.id, label: hit.label, reason: hit.reason, source: hit.source },
  };
}

export function xrayForm(questions: string[]): XrayResult[] {
  return questions.map(xrayQuestion);
}

export const DEMO_FORM = `Full name
Phone number
Email address
Gender
Date of birth
Current address
Weekly income
Employer name
Are you currently a student?
When does your stay in Australia end?
Number and ages of children who will live with you
Do you own any other property?
Have you applied for any other properties this week?
Do you receive rent assistance?
Link to your Instagram or Facebook profile
Upload a recent photo of yourself
Have you ever been declared bankrupt?
Previous landlord reference
Preferred move-in date
Any pets?
Do you have any visible tattoos?`;
