'use client';

import { useState, type KeyboardEvent } from 'react';
import KitActionBar from '@/app/components/KitActionBar';
import KitHeader from '@/app/components/KitHeader';
import KitOutlinePanel from '@/app/components/KitOutlinePanel';
import KitSlideDeck from '@/app/components/KitSlideDeck';
import KitStudyPanel from '@/app/components/KitStudyPanel';
import { ListIcon } from '@/app/components/icons';
import type { PulpitKit as PulpitKitModel } from '@/lib/types';

interface PulpitKitProps {
  kit: PulpitKitModel;
}

type TabId = 'architecture' | 'study' | 'deck';

const TABS: { id: TabId; label: string }[] = [
  { id: 'architecture', label: 'Sermon Architecture' },
  { id: 'study', label: 'Community Group Study' },
  { id: 'deck', label: 'Presentation Deck' },
];

export default function PulpitKit({ kit }: PulpitKitProps) {
  const [activeTab, setActiveTab] = useState<TabId>('architecture');

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    setActiveTab(TABS[(index + offset + TABS.length) % TABS.length].id);
  };

  // Printing reveals every panel so the exported view holds the whole kit.
  const panelClass = (tab: TabId) =>
    `${activeTab === tab ? 'block' : 'hidden'} print:block print-force-visible`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 print:border-0 print:p-0 print:shadow-none sm:print:p-0">
      <KitHeader kit={kit} />
      <KitActionBar kit={kit} />

      <div
        role="tablist"
        aria-label="Pulpit kit sections"
        onKeyDown={handleTabKeyDown}
        className="mt-5 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 print:hidden"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              id={`kit-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`kit-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={
                isActive
                  ? 'flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 transition-all duration-200 sm:text-sm'
                  : 'flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition-all duration-200 hover:bg-white/60 hover:text-slate-800 sm:text-sm'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id="kit-panel-architecture"
        role="tabpanel"
        aria-labelledby="kit-tab-architecture"
        className={`mt-5 ${panelClass('architecture')}`}
      >
        <KitOutlinePanel kit={kit} />
      </div>

      <div
        id="kit-panel-study"
        role="tabpanel"
        aria-labelledby="kit-tab-study"
        className={`mt-5 ${panelClass('study')}`}
      >
        <KitStudyPanel kit={kit} />
      </div>

      <div
        id="kit-panel-deck"
        role="tabpanel"
        aria-labelledby="kit-tab-deck"
        className={`mt-5 ${panelClass('deck')}`}
      >
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
          <ListIcon className="h-4 w-4" />
          Slide Preview
        </h4>
        <KitSlideDeck kit={kit} />
      </div>
    </div>
  );
}