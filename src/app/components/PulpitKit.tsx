'use client';

import { useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
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

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'architecture', label: 'Sermon Architecture', icon: '🎙️' },
  { id: 'study', label: 'Community Group Study', icon: '👥' },
  { id: 'deck', label: 'Presentation Deck', icon: '📽️' },
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

  return (
    <MotionConfig reducedMotion="user">
      <section className="relative mx-auto my-8 max-w-5xl px-2 sm:px-4">
      {/* Layers-style Ambient Backlight Glow */}
      <div 
        aria-hidden="true"
        className="pointer-events-none absolute -inset-4 -z-10 rounded-[3rem] opacity-70 blur-3xl transition-opacity duration-700"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(245, 158, 11, 0.22) 0%, rgba(14, 31, 56, 0.5) 45%, transparent 75%)'
        }}
      />

      {/* Floating Glassmorphic Container */}
      <div className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-pill/75 p-6 shadow-[0_20px_60px_-15px_rgba(2,8,18,0.55)] backdrop-blur-2xl transition-all duration-300 sm:p-8 md:p-10 print:border-0 print:bg-white print:p-0 print:shadow-none">
        
        {/* Subtle Inner Highlight Border */}
        <div className="pointer-events-none absolute inset-0 rounded-[2.25rem] ring-1 ring-inset ring-white/10" />

        {/* Header & Meta Bar */}
        <div className="relative">
          <KitHeader kit={kit}/>
        </div>

        {/* Action Bar (Export, Print, Copy) */}
        <div className="relative mt-6">
          <KitActionBar kit={kit}/>
        </div>

        {/* Layers-style Floating Segmented Control */}
        <div
          role="tablist"
          aria-label="Pulpit kit sections"
          onKeyDown={handleTabKeyDown}
          className="relative mt-8 flex flex-wrap gap-1.5 rounded-2xl border border-sand/60 bg-pill/70 p-1.5 backdrop-blur-md shadow-inner sm:rounded-full print:hidden"
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
                className={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors duration-200 sm:rounded-full sm:text-sm ${
                  isActive ? 'text-espresso' : 'text-muted hover:text-espresso'
                }`}
              >
                <span className="text-sm opacity-90">{tab.icon}</span>
                <span className="tracking-tight">{tab.label}</span>

                {/* Animated Floating Pill Track */}
                {isActive && (
                  <motion.div
                    layoutId="activePulpitTab"
                    className="absolute inset-0 -z-10 rounded-xl bg-pill shadow-sm ring-1 ring-white/10 sm:rounded-full"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content with Fluid Spring Crossfade */}
        <div className="relative mt-8 min-h-[380px]">
          <AnimatePresence mode="wait">
            {activeTab === 'architecture' && (
              <motion.div
                key="architecture"
                id="kit-panel-architecture"
                role="tabpanel"
                aria-labelledby="kit-tab-architecture"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <KitOutlinePanel kit={kit}/>
              </motion.div>
            )}

            {activeTab === 'study' && (
              <motion.div
                key="study"
                id="kit-panel-study"
                role="tabpanel"
                aria-labelledby="kit-tab-study"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <KitStudyPanel kit={kit}/>
              </motion.div>
            )}

            {activeTab === 'deck' && (
              <motion.div
                key="deck"
                id="kit-panel-deck"
                role="tabpanel"
                aria-labelledby="kit-tab-deck"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-pill-ink">
                    <ListIcon className="h-4 w-4 text-gold"/>
                    Presentation Slides
                  </h4>
                  <span className="text-xs text-muted">16:9 Expository Visual Deck</span>
                </div>
                <KitSlideDeck kit={kit}/>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </section>
    </MotionConfig>
  );
}