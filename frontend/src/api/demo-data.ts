// Demo content: the sample reels, notes and stacks from the Stitch designs.
// Built relative to "now" so relative dates ("2d", "1w") always read the same.
import { Image } from "react-native";

import type { Category, SaveDetail } from "./contract";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function img(mod: number): string {
  return Image.resolveAssetSource(mod)?.uri ?? String(mod);
}

export const IMAGES = {
  avatar: img(require("../../assets/stitch/avatar-aanya.jpg")),
  devDesk: img(require("../../assets/stitch/lib-dev-desk.jpg")),
  momos: img(require("../../assets/stitch/lib-momos.jpg")),
  momosHero: img(require("../../assets/stitch/detail-momos.jpg")),
  manali: img(require("../../assets/stitch/lib-manali.jpg")),
  visaDesk: img(require("../../assets/stitch/lib-visa-desk.jpg")),
  kyotoCafe: img(require("../../assets/stitch/stacks-kyoto-cafe.jpg")),
  espressoBar: img(require("../../assets/stitch/stacks-espresso-bar.jpg")),
  dripCoffee: img(require("../../assets/stitch/stacks-drip-coffee.jpg")),
  ideMonitor: img(require("../../assets/stitch/stacks-ide-monitor.jpg")),
  boots: img(require("../../assets/stitch/stacks-trekking-boots.jpg")),
  mistForest: img(require("../../assets/stitch/stacks-mist-forest.jpg")),
  yoga: img(require("../../assets/stitch/stacks-yoga.jpg")),
  linen: img(require("../../assets/stitch/stacks-linen-outfit.jpg")),
  toast: img(require("../../assets/stitch/signup-toast.jpg")),
};

/** Seeded saves can carry a separate, larger hero image for the detail screen. */
export interface DemoSave extends SaveDetail {
  hero_url?: string;
  /** When a pending save turns into a card (ms epoch). */
  ready_at?: number;
}

export interface DemoStack {
  id: string;
  name: string;
  category: Category | null;
  save_ids: string[];
  updated_at: string;
}

export interface DemoSeed {
  saves: DemoSave[];
  stacks: DemoStack[];
}

type Content = Pick<
  SaveDetail,
  "title" | "caption" | "category" | "thumbnail_url" | "creator" | "summary" | "steps" | "tags" | "places"
>;

/** Content a newly saved demo reel turns into once its "processing" finishes. */
export const EXTRA_CONTENT: Content[] = [
  {
    title: "Notion setup that tracks every job application",
    caption: "My exact Notion board for the job hunt — statuses, follow-ups, referrals.",
    category: "Career & Jobs",
    thumbnail_url: IMAGES.visaDesk,
    creator: "careerwithkaran",
    summary: "A Notion board with one row per application, a follow-up date column and a referral tracker.",
    steps: ["Duplicate the template", "Add a follow-up date to every row", "Review the board every Friday"],
    tags: ["notion", "jobsearch", "productivity"],
    places: [],
  },
  {
    title: "Sunday farmers market in Bandra",
    caption: "Sourdough, cold brew and 40 stalls of local produce every Sunday morning.",
    category: "Food & Places",
    thumbnail_url: IMAGES.toast,
    creator: "mumbaiweekends",
    summary: "A weekly market with bakeries, coffee roasters and organic produce; go before 10am.",
    steps: ["Go before 10am", "Bring a tote", "Try the sourdough stall at the entrance"],
    tags: ["mumbai", "market", "brunch"],
    places: [{ name: "Bandra Farmers Market", address: "Bandra West, Mumbai", maps_url: null }],
  },
  {
    title: "10-minute desk stretch flow",
    caption: "Do this between meetings. Neck, shoulders, hips — no mat needed.",
    category: "Fitness",
    thumbnail_url: IMAGES.yoga,
    creator: "mobilitywithmeera",
    summary: "A short standing routine for neck, shoulders and hips that fits between meetings.",
    steps: ["Neck rolls ×5", "Doorway chest stretch 30s", "Standing hip circles ×10"],
    tags: ["mobility", "desk", "stretch"],
    places: [],
  },
];

export function buildDemoSeed(now: number): DemoSeed {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const base = {
    shortcode: null,
    channel: "app_share" as const,
    media_status: "ready" as const,
    places: [],
    status: "enriched" as const,
  };
  const saves: DemoSave[] = [
    {
      ...base,
      id: "s-github",
      source_url: "https://www.instagram.com/reel/GhTrick5/",
      shortcode: "GhTrick5",
      note: "job search tips",
      created_at: ago(2 * DAY),
      title: "5 GitHub search tricks to find great repos",
      caption: "Stop scrolling GitHub trending. Use these 5 search operators instead.",
      category: "Dev & Tools",
      thumbnail_url: IMAGES.devDesk,
      creator: "devwithriya",
      summary:
        "Five GitHub search operators — stars:, pushed:, topic:, good-first-issues and language: — that surface active, well-maintained repos fast.",
      steps: ["Search stars:>500 pushed:>2026-01-01", "Add topic:job-search", 'Filter label:"good first issue"'],
      tags: ["github", "opensource", "devtools"],
    },
    {
      ...base,
      id: "s-momo",
      source_url: "https://www.instagram.com/reel/MomoPt1/",
      shortcode: "MomoPt1",
      note: "cafe to try",
      created_at: ago(5 * DAY),
      title: "Hole-in-the-wall momo spot in Koramangala",
      caption:
        "This tiny momo place in Koramangala is a hidden gem 🥟 Jhol momos, fire roasted tomato chutney, cash only.",
      category: "Food & Places",
      thumbnail_url: IMAGES.momos,
      hero_url: IMAGES.momosHero,
      creator: "bangalorefoodie",
      summary:
        "A cozy hidden gem serving authentic Darjeeling and Tibetan momos with fire roasted tomato chutney. Known for quick service, street-side ambiance, and budget-friendly platters.",
      steps: ["Cash only", "Try the jhol momo", "≈ ₹150 for two"],
      tags: ["momos", "streetfood", "budget", "bangaloreeats"],
      places: [{ name: "Momo Point", address: "Koramangala 5th Block", maps_url: null }],
    },
    {
      ...base,
      id: "s-manali",
      source_url: "https://www.instagram.com/reel/Manali4D/",
      shortcode: "Manali4D",
      note: "trek in june",
      created_at: ago(7 * DAY),
      title: "Manali in 4 days on ₹12k",
      caption: "Day-by-day Manali itinerary: Old Manali cafes, Solang Pass trek, Jogini falls.",
      category: "Food & Places",
      thumbnail_url: IMAGES.manali,
      creator: "himalayan.trails",
      summary:
        "A four-day budget plan: Old Manali on day one, Solang Pass trek on day two, Jogini falls and Vashisht on day three, Naggar castle on the way out.",
      steps: ["Book the Volvo from Delhi a week ahead", "Stay in Old Manali", "Start the Solang trek by 7am"],
      tags: ["manali", "trek", "budgettravel"],
      places: [{ name: "Solang Pass", address: "Manali, Himachal Pradesh", maps_url: null }],
    },
    {
      ...base,
      id: "s-visa",
      source_url: "https://www.instagram.com/reel/VisaList/",
      shortcode: "VisaList",
      note: "repo for job search",
      created_at: ago(14 * DAY),
      title: "Companies that sponsor visas — GitHub list",
      caption: "This open-source list tracks 600+ companies that sponsor work visas, by country.",
      category: "Career & Jobs",
      thumbnail_url: IMAGES.visaDesk,
      creator: "careerwithkaran",
      summary: "An open-source GitHub list of companies that sponsor work visas, filterable by country and role.",
      steps: ["Star the repo", "Filter by your country", "Cross-check on the company careers page"],
      tags: ["visa", "jobs", "github"],
    },
    {
      ...base,
      id: "s-pending",
      source_url: "https://www.instagram.com/reel/C8xYz12/",
      shortcode: "C8xYz12",
      status: "pending",
      media_status: "pending",
      note: "trek in june",
      created_at: ago(1 * MIN),
      ready_at: now + 45_000,
      title: "Trek shoes under ₹3k that actually grip",
      caption: "Tested 4 budget trek shoes on wet Himalayan trails. Only one survived.",
      category: "Fitness",
      thumbnail_url: IMAGES.boots,
      creator: "himalayan.trails",
      summary: "A wet-trail test of four budget trekking shoes; the winner has a deep lug sole and costs ₹2,799.",
      steps: ["Look for 4mm+ lugs", "Size up half a size", "Break them in for a week"],
      tags: ["trekking", "shoes", "budget"],
    },
    {
      ...base,
      id: "s-partial",
      source_url: "https://www.instagram.com/reel/Mob30D3/",
      shortcode: "Mob30D3",
      status: "partial",
      media_status: "partial",
      note: null,
      created_at: ago(8 * DAY),
      title: null,
      caption: "Day 3 of the 30-day mobility challenge…\nHips and thoracic spine today. Save this for your mornings.",
      category: "Fitness",
      thumbnail_url: null,
      creator: "mobilitywithmeera",
      summary: null,
      steps: null,
      tags: null,
    },
    {
      ...base,
      id: "s-kyoto",
      source_url: "https://www.instagram.com/reel/KyotoPO/",
      shortcode: "KyotoPO",
      note: "coffee date spot",
      created_at: ago(12 * DAY),
      title: "Kyoto-style pour-over bar hidden in Indiranagar",
      caption: "Eight seats, one barista, the best pour-over in Bangalore.",
      category: "Food & Places",
      thumbnail_url: IMAGES.kyotoCafe,
      creator: "bangalorefoodie",
      summary: "A tiny Japanese-style coffee bar with single-origin pour-overs; weekday mornings are quiet.",
      steps: ["Go on a weekday morning", "Order the Ethiopian pour-over", "No laptops at the bar"],
      tags: ["coffee", "pourover", "cafe"],
      places: [{ name: "Kissa Coffee Bar", address: "Indiranagar 12th Main", maps_url: null }],
    },
    {
      ...base,
      id: "s-espresso",
      source_url: "https://www.instagram.com/reel/Espr20s/",
      shortcode: "Espr20s",
      note: "work from cafe",
      created_at: ago(20 * DAY),
      title: "The espresso bar with a 20-seat reading room",
      caption: "Quiet upstairs reading room, plugs at every seat, great flat white.",
      category: "Food & Places",
      thumbnail_url: IMAGES.espressoBar,
      creator: "workfromcafe",
      summary: "An espresso bar with a quiet upstairs reading room — good wifi and power at every seat.",
      steps: ["Upstairs is silent", "Wifi password on the receipt", "Closes at 9pm"],
      tags: ["cafe", "wfh", "coffee"],
    },
    {
      ...base,
      id: "s-ide",
      source_url: "https://www.instagram.com/reel/FastApi9/",
      shortcode: "FastApi9",
      note: "for lately backend",
      created_at: ago(9 * DAY),
      title: "FastAPI tips you'll wish you knew sooner",
      caption: "Lifespan events, dependency overrides in tests, and response_model_exclude_none.",
      category: "Dev & Tools",
      thumbnail_url: IMAGES.ideMonitor,
      creator: "devwithriya",
      summary: "Three FastAPI features that clean up real apps: lifespan handlers, dependency overrides and response models.",
      steps: ["Move startup code into lifespan", "Override auth deps in tests", "Use response_model everywhere"],
      tags: ["fastapi", "python", "backend"],
    },
    {
      ...base,
      id: "s-forest",
      source_url: "https://www.instagram.com/reel/Solang7/",
      shortcode: "Solang7",
      note: "trek in june",
      created_at: ago(38 * DAY),
      title: "Solang Pass trail in the monsoon mist",
      caption: "The forest trail above Solang when the clouds roll in. 3 hours return.",
      category: "Food & Places",
      thumbnail_url: IMAGES.mistForest,
      creator: "himalayan.trails",
      summary: "A three-hour forest trail above Solang valley; best early morning before the clouds settle.",
      steps: ["Start before 8am", "Carry a rain shell", "Turn back at the meadow"],
      tags: ["solang", "trek", "monsoon"],
      places: [{ name: "Solang Valley", address: "Manali, Himachal Pradesh", maps_url: null }],
    },
    {
      ...base,
      id: "s-drip",
      source_url: "https://www.instagram.com/reel/Drip3Mn/",
      shortcode: "Drip3Mn",
      note: "try this weekend",
      created_at: ago(40 * DAY),
      title: "Drip coffee at home: the 3-minute recipe",
      caption: "15g coffee, 250g water at 93°C, 3 minutes. That's it.",
      category: "Watch Later",
      thumbnail_url: IMAGES.dripCoffee,
      creator: "homebarista.in",
      summary: "A simple pour-over ratio — 15 g coffee to 250 g water at 93 °C — finished in three minutes.",
      steps: ["15g medium-fine coffee", "Bloom 30s with 50g water", "Pour to 250g by 3:00"],
      tags: ["coffee", "recipe", "homebrew"],
    },
    {
      ...base,
      id: "s-yoga",
      source_url: "https://www.instagram.com/reel/Thorac6/",
      shortcode: "Thorac6",
      note: "do every morning",
      created_at: ago(45 * DAY),
      title: "Thoracic opener for desk backs — 6 minutes",
      caption: "Six minutes, no equipment. Your upper back will thank you.",
      category: "Fitness",
      thumbnail_url: IMAGES.yoga,
      creator: "mobilitywithmeera",
      summary: "A six-minute floor routine that opens the upper back after long desk days.",
      steps: ["Open books ×10 each side", "Thread the needle ×8", "Child's pose reach 60s"],
      tags: ["mobility", "thoracic", "morning"],
    },
    {
      ...base,
      id: "s-linen",
      source_url: "https://www.instagram.com/reel/Linen9P/",
      shortcode: "Linen9P",
      note: "outfit ideas",
      created_at: ago(50 * DAY),
      title: "Autumn linen capsule: 9 pieces, 20 outfits",
      caption: "Nine linen pieces in four neutrals that mix into twenty outfits.",
      category: "Style & Vibes",
      thumbnail_url: IMAGES.linen,
      creator: "slowwardrobe",
      summary: "A nine-piece neutral linen capsule that mixes into twenty outfits for autumn.",
      steps: ["Pick four neutrals", "Two trousers, three shirts, one overshirt", "One pair of neutral sneakers"],
      tags: ["linen", "capsule", "neutral"],
    },
  ];

  const stacks: DemoStack[] = [
    { id: "st-cafes", name: "Cafes to try", category: "Food & Places", save_ids: ["s-momo", "s-kyoto", "s-espresso", "s-drip"], updated_at: ago(2 * DAY) },
    { id: "st-jobs", name: "Job hunt", category: "Career & Jobs", save_ids: ["s-visa", "s-github"], updated_at: ago(3 * DAY) },
    { id: "st-manali", name: "Manali trip", category: "Food & Places", save_ids: ["s-manali", "s-forest", "s-pending"], updated_at: ago(7 * DAY) },
    { id: "st-mobility", name: "Mobility routine", category: "Fitness", save_ids: ["s-yoga", "s-partial"], updated_at: ago(4 * DAY) },
    { id: "st-dev", name: "Dev tools", category: "Dev & Tools", save_ids: ["s-github", "s-ide"], updated_at: ago(2 * DAY) },
    { id: "st-outfits", name: "Outfit ideas", category: "Style & Vibes", save_ids: ["s-linen"], updated_at: ago(5 * DAY) },
  ];

  return { saves, stacks };
}
