"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import GatheringCard from "@/app/components/GatheringCard";
import GatheringSubmissionModal from "@/app/components/GatheringSubmissionModal";
import { MapPinIcon, PlusIcon } from "@/app/components/icons";
import type { Gathering } from "@/lib/types";

interface GatheringMapProps {
  gatherings: Gathering[];
}

const METRO_LABEL = "Austin, TX Metro";

/** One centroid filter: "all" plus one entry per distinct city. */
interface HubFilter {
  id: string;
  label: string;
  match: string | null; // null matches every gathering
}

/** Lower-cased haystack so the search box matches name, city/area, address, leader, or schedule. */
function buildSearchIndex(gathering: Gathering): string {
  return [
    gathering.name,
    gathering.address,
    gathering.leader_name,
    gathering.meeting_time,
    gathering.description ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Derives the centroid filter list from the gatherings' cities ("All Hubs" first). */
function buildHubFilters(gatherings: Gathering[]): HubFilter[] {
  const cities: string[] = [];
  for (const gathering of gatherings) {
    // Addresses are composed "street, city, country" by the data layer; the
    // second segment is the city label when present.
    const city = gathering.address.split(",")[1]?.trim() ?? "";
    if (city !== "" && !cities.includes(city)) cities.push(city);
  }

  return [
    { id: "all", label: "All Hubs", match: null },
    ...cities.map((city) => ({
      id: `hub-${city.toLowerCase()}`,
      label: city,
      match: city.toLowerCase(),
    })),
  ];
}

export default function GatheringMap({ gatherings }: GatheringMapProps) {
  const [query, setQuery] = useState("");
  const [activeHub, setActiveHub] = useState("all");
  const [submissionOpen, setSubmissionOpen] = useState(false);

  const hubFilters = useMemo(() => buildHubFilters(gatherings), [gatherings]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const hub =
      hubFilters.find((filter) => filter.id === activeHub) ?? hubFilters[0];

    return gatherings.filter((gathering) => {
      if (hub?.match && !buildSearchIndex(gathering).includes(hub.match))
        return false;
      if (needle === "") return true;
      return buildSearchIndex(gathering).includes(needle);
    });
  }, [gatherings, query, activeHub, hubFilters]);

  return (
    <MotionConfig reducedMotion="user">
      <div>
        <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-pill/75 p-4 shadow-xl backdrop-blur-2xl sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div className="w-full sm:max-w-xs">
            <label
              htmlFor="gathering-search"
              className="text-xs font-bold uppercase tracking-[0.18em] text-muted"
            >
              Find a gathering
            </label>
            <input
              id="gathering-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, city, or area"
              className="mt-2 min-h-[44px] w-full rounded-full border border-white/10 bg-canvas/60 px-4 py-2.5 text-sm text-espresso outline-none transition placeholder:text-muted/80 focus:border-gold focus:ring-2 focus:ring-gold/25"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-pill/70 px-3 py-1 text-xs font-bold text-slate-200">
              <MapPinIcon className="h-3.5 w-3.5 text-gold" />
              {METRO_LABEL}
            </span>
            <span aria-live="polite" className="text-xs font-medium text-muted">
              {filtered.length} of {gatherings.length} gatherings
            </span>
            <motion.button
              type="button"
              onClick={() => setSubmissionOpen(true)}
              whileTap={{ scale: 0.96 }}
              whileHover={{ y: -1 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-canvas shadow-lg shadow-gold/20 outline-none transition hover:bg-gold-deep focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Submit a Gathering
            </motion.button>
          </div>
        </div>

        {/* Interactive centroid filters — gliding spring pill (layoutId) */}
        {gatherings.length > 0 && hubFilters.length > 1 ? (
          <div
            role="tablist"
            aria-label="Filter gatherings by hub"
            className="mt-4 inline-flex max-w-full flex-wrap gap-1 overflow-x-auto rounded-full border border-white/10 bg-pill/75 p-1 backdrop-blur-2xl"
          >
            {hubFilters.map((filter) => {
              const isActive = filter.id === activeHub;
              return (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveHub(filter.id)}
                  className={`relative min-h-[44px] shrink-0 rounded-full px-4 py-2 text-xs font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold/50 ${
                    isActive ? "text-canvas" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="gathering-filter-pill"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 32,
                      }}
                      className="absolute inset-0 rounded-full bg-gold shadow-lg shadow-gold/20"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="relative">{filter.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {gatherings.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-pill/60 p-8 text-center shadow-xl backdrop-blur-2xl">
            <p className="text-sm font-bold text-espresso">
              No gatherings published yet
            </p>
            <p className="mt-1 text-sm leading-6 text-muted">
              New fellowships will appear here as soon as they are added to the
              map.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-pill/60 p-8 text-center shadow-xl backdrop-blur-2xl">
            <p className="text-sm font-bold text-espresso">
              No gatherings match &ldquo;{query.trim()}&rdquo;
            </p>
            <p className="mt-1 text-sm leading-6 text-muted">
              Try a different name, city, or area &mdash; or clear the search to
              browse them all.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/10 bg-pill/70 px-4 py-2 text-xs font-bold text-espresso outline-none transition hover:border-gold hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              Clear search
            </button>
          </div>
        ) : (
          <motion.ul
            layout
            className="mt-6 grid list-none grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {filtered.map((gathering) => (
                <motion.li
                  key={gathering.id}
                  layout
                  initial={{ opacity: 0, scale: 0.94, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 16 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="flex min-w-0"
                >
                  <GatheringCard gathering={gathering} />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}

        <GatheringSubmissionModal
          open={submissionOpen}
          onClose={() => setSubmissionOpen(false)}
        />
      </div>
    </MotionConfig>
  );
}
