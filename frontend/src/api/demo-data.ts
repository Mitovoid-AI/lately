// Demo content: sample reels, notes and stacks, set in US cities. Each card's text describes
// the photo it uses (the photos are bundled in assets/stitch/). Built relative to "now" so
// relative dates ("2d", "1w") always read the same. Creator handles are plainly samples
// ("sample.coffee"): a made-up reel is never credited to a name that could be a real account.
import { Asset } from "expo-asset";

import type { Category, SaveDetail } from "./contract";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Bundled image → URI (works on web and native). */
function img(mod: number): string {
  return Asset.fromModule(mod).uri;
}

// Photo notes (what each file shows), so the copy below stays true to it:
//   devDesk     dark desk, monitor with an editor and a GitHub search page, keyboard, mug
//   momos       bamboo steamer of dumplings and a bowl of chili sauce, warm busy restaurant
//   momosHero   plate of steamed momos with tomato chutney and cilantro, brick wall behind
//   manali      hiker with poles on a misty stone trail, forest and snow peaks behind
//   visaDesk    man at a laptop with a list on screen, brass lamp, notebook, mug
//   kyotoCafe   Japanese-style coffee bar, barista pouring from a gooseneck kettle
//   espressoBar bright cafe with brick walls, espresso machine, bookshelf, latte and a book
//   dripCoffee  barista pouring a pour-over on a scale, bag of Ethiopia beans
//   ideMonitor  night desk with a code editor on a monitor, lamp, keyboard, notebook
//   boots       leather hiking boots and wool socks on a mossy log in a foggy conifer forest
//   mistForest  same foggy forest and mossy log
//   yoga        woman in a low lunge with one arm reaching up, cork mat, bright apartment
//   linen       flat lay: linen shirt, wide-leg trousers, crossbody bag, tote, mules, sunglasses
//   toast       poached egg on sourdough with microgreens, mug and window behind
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
    caption: "My exact Notion board for the job hunt: statuses, follow-ups, referrals.",
    category: "Career & Jobs",
    thumbnail_url: IMAGES.visaDesk,
    creator: "sample.career",
    summary: "A Notion board with one row per application, a follow-up date column and a referral tracker.",
    steps: ["Duplicate the template", "Add a follow-up date to every row", "Review the board every Friday"],
    tags: ["notion", "jobsearch", "productivity"],
    places: [],
  },
  {
    title: "Poached egg toast worth the Sunday line in Ballard",
    caption: "Sourdough, microgreens and a runny yolk. Go before the 10am rush.",
    category: "Food & Places",
    thumbnail_url: IMAGES.toast,
    creator: "sample.weekends",
    summary: "A Sunday brunch spot known for sourdough toast with a poached egg and microgreens; the line builds after 10am.",
    steps: ["Go before 10am", "Order the poached egg toast", "Walk the Sunday market afterward"],
    tags: ["seattle", "brunch", "sourdough"],
    places: [{ name: "Ballard Brunch Counter", address: "Ballard, Seattle, WA", maps_url: null }],
  },
  {
    title: "10-minute desk stretch flow",
    caption: "Do this between meetings. Neck, shoulders and hips, no equipment.",
    category: "Fitness",
    thumbnail_url: IMAGES.yoga,
    creator: "sample.mobility",
    summary: "A short standing routine for neck, shoulders and hips that fits between meetings.",
    steps: ["Neck rolls ×5", "Doorway chest stretch 30s", "Low lunge with an overhead reach, 5 per side"],
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
      creator: "sample.dev",
      summary:
        "Five GitHub search operators (stars:, pushed:, topic:, label: and language:) that surface active, well-maintained repos fast.",
      steps: ["Search stars:>500 pushed:>2026-01-01", "Filter by topic", 'Filter label:"good first issue"'],
      tags: ["github", "opensource", "devtools"],
    },
    {
      ...base,
      id: "s-momo",
      source_url: "https://www.instagram.com/reel/MomoPt1/",
      shortcode: "MomoPt1",
      note: "dinner to try",
      created_at: ago(5 * DAY),
      title: "Hole-in-the-wall momo spot in Jackson Heights",
      caption: "This tiny momo place in Jackson Heights is a hidden gem. Steamed momos, fiery tomato chutney, cash only.",
      category: "Food & Places",
      thumbnail_url: IMAGES.momos,
      hero_url: IMAGES.momosHero,
      creator: "sample.foodie",
      summary:
        "Steamed Himalayan momos with tomato chutney. Cash only, about $15 for two.",
      steps: ["Cash only", "Order the steamed momos", "$15 for two"],
      tags: ["momos", "streetfood", "budget", "nycfood"],
      places: [{ name: "Momo Point", address: "Jackson Heights, Queens, NY", maps_url: null }],
    },
    {
      ...base,
      id: "s-manali",
      source_url: "https://www.instagram.com/reel/Rainier3/",
      shortcode: "Rainier3",
      note: "hike in june",
      created_at: ago(7 * DAY),
      title: "Mount Rainier in 3 days on $400",
      caption: "Day-by-day Rainier itinerary: Narada Falls, the Skyline Trail, Sunrise and Tipsoo Lake.",
      category: "Food & Places",
      thumbnail_url: IMAGES.manali,
      creator: "sample.trails",
      summary:
        "A three-day budget plan: Longmire and Narada Falls on day one, the Skyline Trail from Paradise on day two, Sunrise and Tipsoo Lake on day three.",
      steps: ["Book a campsite a month ahead", "Fill the tank before the park gate", "Start the Skyline Trail by 7am"],
      tags: ["rainier", "hiking", "budgettravel"],
      places: [{ name: "Mount Rainier National Park", address: "Ashford, WA", maps_url: null }],
    },
    {
      ...base,
      id: "s-visa",
      source_url: "https://www.instagram.com/reel/JrDevList/",
      shortcode: "JrDevList",
      note: "repo for job search",
      created_at: ago(14 * DAY),
      title: "Remote-friendly companies hiring junior devs: a GitHub list",
      caption: "A maintained GitHub list of remote-friendly companies that hire junior developers, sorted by role.",
      category: "Career & Jobs",
      thumbnail_url: IMAGES.visaDesk,
      creator: "sample.career",
      summary: "An open-source GitHub list of remote-friendly companies that hire junior developers, filterable by role and tech stack.",
      steps: ["Star the repo", "Filter by your stack", "Check the company's careers page before you apply"],
      tags: ["remote", "jobs", "github"],
    },
    {
      ...base,
      id: "s-pending",
      source_url: "https://www.instagram.com/reel/C8xYz12/",
      shortcode: "C8xYz12",
      status: "pending",
      media_status: "pending",
      note: "hike in june",
      created_at: ago(1 * MIN),
      ready_at: now + 45_000,
      title: "Hiking boots under $150 that actually grip",
      caption: "Tested 4 budget hiking boots on wet trails. Only one survived.",
      category: "Fitness",
      thumbnail_url: IMAGES.boots,
      creator: "sample.trails",
      summary: "A wet-trail test of four budget hiking boots; the winner has a deep lug sole and costs $139.",
      steps: ["Look for 4mm+ lugs", "Size up half a size", "Break them in for a week"],
      tags: ["hiking", "boots", "budget"],
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
      creator: "sample.mobility",
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
      title: "Kyoto-style pour-over bar hidden in Southeast Portland",
      caption: "One barista, a handful of seats, and the best pour-over in Portland.",
      category: "Food & Places",
      thumbnail_url: IMAGES.kyotoCafe,
      creator: "sample.coffee",
      summary: "A tiny Japanese-style coffee bar with single-origin pour-overs; weekday mornings are quiet.",
      steps: ["Go on a weekday morning", "Order the Ethiopian pour-over", "No laptops at the bar"],
      tags: ["coffee", "pourover", "cafe", "portland"],
      places: [{ name: "Kissa Coffee Bar", address: "Southeast Portland, OR", maps_url: null }],
    },
    {
      ...base,
      id: "s-espresso",
      source_url: "https://www.instagram.com/reel/Espr20s/",
      shortcode: "Espr20s",
      note: "work from cafe",
      created_at: ago(20 * DAY),
      title: "The espresso bar with a 20-seat reading room",
      caption: "Quiet reading room in the back, plugs at every seat, great flat white.",
      category: "Food & Places",
      thumbnail_url: IMAGES.espressoBar,
      creator: "sample.cafe",
      summary: "An espresso bar with a quiet reading room and shelves of books; good wifi and power at every seat.",
      steps: ["Grab a back table, it's the quietest", "Wifi password is on the receipt", "Closes at 9pm"],
      tags: ["cafe", "wfh", "coffee"],
      places: [{ name: "Brickline Espresso", address: "RiNo, Denver, CO", maps_url: null }],
    },
    {
      ...base,
      id: "s-ide",
      source_url: "https://www.instagram.com/reel/FastApi9/",
      shortcode: "FastApi9",
      note: "for my side project",
      created_at: ago(9 * DAY),
      title: "FastAPI tips you'll wish you knew sooner",
      caption: "Lifespan events, dependency overrides in tests, and response_model_exclude_none.",
      category: "Dev & Tools",
      thumbnail_url: IMAGES.ideMonitor,
      creator: "sample.dev",
      summary: "Three FastAPI features that clean up real apps: lifespan handlers, dependency overrides and response models.",
      steps: ["Move startup code into lifespan", "Override auth deps in tests", "Use response_model everywhere"],
      tags: ["fastapi", "python", "backend"],
    },
    {
      ...base,
      id: "s-forest",
      source_url: "https://www.instagram.com/reel/HohMist7/",
      shortcode: "HohMist7",
      note: "hike in june",
      created_at: ago(38 * DAY),
      title: "Hoh Rain Forest trail in the morning mist",
      caption: "The Hall of Mosses loop when the fog rolls in. Boots on, under an hour, mostly flat.",
      category: "Food & Places",
      thumbnail_url: IMAGES.mistForest,
      creator: "sample.trails",
      summary: "A short, flat loop through moss-draped old-growth forest in Olympic National Park; best early, before the fog lifts.",
      steps: ["Start before 8am", "Carry a rain shell", "Stay on the trail, the moss is fragile"],
      tags: ["hoh", "hike", "mist"],
      places: [{ name: "Hoh Rain Forest", address: "Olympic National Park, WA", maps_url: null }],
    },
    {
      ...base,
      id: "s-drip",
      source_url: "https://www.instagram.com/reel/Drip3Mn/",
      shortcode: "Drip3Mn",
      note: "try this weekend",
      created_at: ago(40 * DAY),
      title: "Pour-over at home: the 3-minute recipe",
      caption: "15g coffee, 250g water at 200°F, 3 minutes. That's it.",
      category: "Watch Later",
      thumbnail_url: IMAGES.dripCoffee,
      creator: "sample.barista",
      summary: "A simple pour-over ratio (15 g coffee to 250 g water at 200 °F) finished in three minutes.",
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
      title: "Thoracic opener for desk backs: 6 minutes",
      caption: "Six minutes, no equipment. Your upper back will thank you.",
      category: "Fitness",
      thumbnail_url: IMAGES.yoga,
      creator: "sample.mobility",
      summary: "A six-minute floor routine that opens the upper back after long desk days.",
      steps: ["Open books ×10 each side", "Low lunge with an overhead reach ×8", "Child's pose reach 60s"],
      tags: ["mobility", "thoracic", "stretching", "morning"],
    },
    {
      ...base,
      id: "s-linen",
      source_url: "https://www.instagram.com/reel/Linen9P/",
      shortcode: "Linen9P",
      note: "outfit ideas",
      created_at: ago(50 * DAY),
      title: "Neutral linen capsule: 9 pieces, 20 outfits",
      caption: "Nine linen pieces in three neutrals that mix into twenty outfits.",
      category: "Style & Vibes",
      thumbnail_url: IMAGES.linen,
      creator: "sample.style",
      summary: "A nine-piece capsule in cream, sand and tan: a linen shirt, wide-leg trousers, mules and a few bags that mix into twenty outfits.",
      steps: ["Pick three neutrals: cream, sand and tan", "Start with a linen shirt and wide-leg trousers", "Add cream mules and a woven crossbody"],
      tags: ["linen", "capsule", "neutral"],
    },
  ];

  const stacks: DemoStack[] = [
    { id: "st-cafes", name: "Food and coffee", category: "Food & Places", save_ids: ["s-momo", "s-kyoto", "s-espresso", "s-drip"], updated_at: ago(2 * DAY) },
    { id: "st-jobs", name: "Job hunt", category: "Career & Jobs", save_ids: ["s-visa", "s-github"], updated_at: ago(3 * DAY) },
    { id: "st-manali", name: "Pacific Northwest trip", category: "Food & Places", save_ids: ["s-manali", "s-forest", "s-pending"], updated_at: ago(7 * DAY) },
    { id: "st-mobility", name: "Mobility routine", category: "Fitness", save_ids: ["s-yoga", "s-partial"], updated_at: ago(4 * DAY) },
    { id: "st-dev", name: "Dev tools", category: "Dev & Tools", save_ids: ["s-github", "s-ide"], updated_at: ago(2 * DAY) },
    { id: "st-outfits", name: "Outfit ideas", category: "Style & Vibes", save_ids: ["s-linen"], updated_at: ago(5 * DAY) },
  ];

  return { saves, stacks };
}
