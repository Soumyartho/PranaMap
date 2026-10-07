/** Static copy for the landing page. Figures and sources come from the PranaMap blueprint. */

export type LoopStep = { key: string; title: string; body: string };
export type Stat = { value: number; prefix?: string; suffix?: string; tail?: string; label: string; source: string };
export type Feature = { title: string; body: string; icon: FeatureIcon };
export type FeatureIcon = "offline" | "voice" | "explain" | "flag" | "route" | "packet" | "loop" | "map";
export type Audience = { role: string; gets: string; points: string[] };

export const navLinks = [
  { href: "#loop", label: "The loop" },
  { href: "#problem", label: "The gap" },
  { href: "#features", label: "Features" },
  { href: "#who", label: "Who it serves" },
];

export const hero = {
  word: "PRANA",
  eyebrow: "IEMH4-HC-01 · Rural health access",
  tagline: "Early risk. The right door. Care, completed.",
  kicker: "The pitch",
  title: "A village becomes a live health map.",
  body:
    "An ASHA worker screens a household in about two minutes, even with no network. PranaMap scores each person's risk, routes them to the nearest facility that can actually treat them, and tracks whether they got there.",
  facts: [
    { value: "~2 min", label: "per household screening" },
    { value: "0 bars", label: "of signal needed in the field" },
    { value: "14 days", label: "to close every high-risk loop" },
  ],
};

export const statement =
  "India built the rails: a screening programme, a national telemedicine network and a digital health ID. What rural patients still lack is the layer between them — scoring at the doorstep, routing to the right door, and follow-through until care is received.";

/** Words in the statement drawn in the accent colour. */
export const statementAccents = new Set(["layer", "doorstep,", "door,", "follow-through"]);

export const loopSteps: LoopStep[] = [
  {
    key: "Capture",
    title: "Capture at the doorstep",
    body: "Voice-first, offline-first screening that follows the government's own CBAC checklist, so ASHAs never learn a new workflow.",
  },
  {
    key: "Score",
    title: "Score, and say why",
    body: "Explainable risk for diabetes, hypertension, heart disease, anaemia and TB — each with a plain-language reason, never a black box.",
  },
  {
    key: "Route",
    title: "Route to the right door",
    body: "The nearest PHC or tele-doctor that is open, staffed and equipped for that specific risk. Then the slot is booked.",
  },
  {
    key: "Follow",
    title: "Follow through",
    body: "Reminders, missed-referral alerts and repeat-visit nudges, escalating until the visit outcome returns to the ASHA's phone.",
  },
  {
    key: "Map",
    title: "Map the whole block",
    body: "A PHC and district view of risk clusters, outbreaks, and the villages quietly falling through the cracks.",
  },
];

export const stats: Stat[] = [
  {
    value: 67,
    suffix: "%",
    label: "of specialist posts at rural community health centres sit vacant.",
    source: "Health Dynamics of India 2022-23",
  },
  {
    value: 36000,
    label: "people depend on an average rural primary health centre.",
    source: "Rural Health Statistics 2021-22",
  },
  {
    value: 136,
    suffix: "M",
    label: "Indians live with prediabetes — the pool we can still catch early.",
    source: "ICMR-INDIAB",
  },
  {
    value: 48,
    tail: "/127",
    label: "internet subscribers per 100 people, rural against urban. Offline-first is a requirement.",
    source: "TRAI Q1 2026",
  },
];

export const features: Feature[] = [
  { icon: "offline", title: "Offline-first", body: "The phone is the source of truth during a visit. Every screening is encrypted, queued and synced when signal returns." },
  { icon: "voice", title: "Voice-first", body: "Spoken prompts in Hindi, Bengali and English. Vitals by voice with read-back, or a big-number keypad." },
  { icon: "explain", title: "Explainable risk", body: "Guideline scores doctors already trust — CBAC, IDRS, WHO/ISH — with the top three reasons in plain words." },
  { icon: "flag", title: "Red flags first", body: "Crisis blood pressure, chest pain and stroke signs trigger an emergency script before any model runs." },
  { icon: "route", title: "Right-door routing", body: "Picks the nearest facility that is open, staffed and equipped for this risk, by real travel time." },
  { icon: "packet", title: "Pre-consult packet", body: "Every referral arrives with vitals, trend, risk drivers and red flags — not a one-word note." },
  { icon: "loop", title: "Loop-closure engine", body: "Timers, escalation and no-show rescue until the visit outcome comes back. Measured, every time." },
  { icon: "map", title: "Live risk map", body: "Hexagon clusters for PHC and district officers, with small-count privacy built in from day one." },
];

export const audiences: Audience[] = [
  {
    role: "ASHA worker",
    gets: "A two-minute guided screening in her own language.",
    points: ["Spoken prompts, big buttons", "A ranked Today list", "Proof of every completed referral"],
  },
  {
    role: "PHC medical officer",
    gets: "Pre-triaged patients who arrive with context.",
    points: ["Structured pre-consult packet", "Drag-and-drop triage board", "Alerts with escalation timers"],
  },
  {
    role: "District health officer",
    gets: "Every village on one live map.",
    points: ["Risk clusters and outbreaks", "Screening blind spots", "Loop-closure rate by block"],
  },
];

export const closing = {
  word: "CARE",
  front: "Where the loop closes.",
  title: "Close the loop on rural care.",
  body: "From first contact to completed care, measured by one number: the share of high-risk people who see a clinician within 14 days.",
  primary: { href: "#top", label: "Launch the ASHA app" },
  secondary: { href: "#loop", label: "See how it works" },
};
