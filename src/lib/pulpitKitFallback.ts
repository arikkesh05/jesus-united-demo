import type { PulpitKit } from "@/lib/types";

/**
 * Local fallback kit for this Sunday, used when the `pulpit_kits` table is
 * unreachable or still pending. It mirrors the live table shape so the Module 3
 * UI always has a complete kit to render.
 */
export const FALLBACK_PULPIT_KIT: PulpitKit = {
  id: "fallback-grace-in-the-wilderness",
  title: "Grace in the Wilderness",
  theme: "Daily Bread and Living Water",
  series_name: "Wilderness Formation",
  scripture_passages: ["Exodus 16:1-18", "John 6:35-40"],
  outline: [
    {
      section: "I. The Wilderness of Want",
      subtext:
        "Israel grumbles for bread while God is already preparing manna in plain sight.",
    },
    {
      section: "II. Bread That Cannot Be Stored",
      subtext:
        "Daily dependence exposes our instinct to self-secure instead of trusting.",
    },
    {
      section: "III. The True Bread From Heaven",
      subtext:
        "Jesus reinterprets the manna as a sign pointing directly to Himself.",
    },
  ],
  talking_points: [
    "Miracles in the wilderness are rarely early, but they are never late.",
    "God gives enough for today so that we keep returning to Him tomorrow.",
    "The wilderness is not punishment; it is formation.",
  ],
  discussion_questions: [
    "Where are you tempted to hoard control instead of trusting God for daily provision?",
    'What would "daily bread" look like for your household this week?',
    "Who in our church family is in a wilderness season right now, and how can we carry it with them?",
    "What is one grumbling you need to trade for gratitude before Sunday?",
    "How does John 6 change the way you read Exodus 16?",
  ],
  key_quote:
    "The wilderness is where God proves that His presence, not our provision, is the point.",
  call_to_action:
    "Name one area of scarcity in your week, then pray over it daily and trust God for today rather than for the whole year.",
  estimated_minutes: 35,
  target_sunday: "2026-09-20",
  created_at: "2026-09-15T08:55:53.399007+00:00",
};
