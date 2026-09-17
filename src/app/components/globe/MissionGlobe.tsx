'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { GlobeIcon } from '@/app/components/icons';
import { avatarStyleForSeed, normalizeMarkerName } from '@/lib/globeAvatars';
import { GLOBE_KEY_ROTATE_STEP, GLOBE_KEY_ZOOM_FACTOR } from '@/lib/globeCamera';
import type { GlobeMarker } from '@/lib/types';
import type { GlobeSceneHandle } from './globeScene';

/**
 * Mission Globe index card (Phase 2 — Task 3.2).
 *
 * Owns the React side of the WebGL globe: server-safe skeleton, lazy client-only
 * scene boot, keyboard/button controls and the accessible storybook list. The
 * three.js engine itself is loaded with a dynamic `import()` inside an effect, so
 * `three` never runs during SSR and `window` is only ever touched post-mount.
 */

interface MissionGlobeProps {
  /** Privacy-safe marker payload from `getPublicGatheringMarkers()`. */
  markers: readonly GlobeMarker[];
  onSelectMarker?: (marker: GlobeMarker | null) => void;
  className?: string;
}

type GlobeStatus = 'loading' | 'ready' | 'unavailable';

const PILL_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-3 py-1 text-xs font-bold text-pill-ink';
const CONTROL_CLASS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-sand bg-white px-2.5 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-40';
const MARKER_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50';

export default function MissionGlobe({ markers, onSelectMarker, className }: MissionGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GlobeSceneHandle | null>(null);
  const notifyRef = useRef(onSelectMarker);
  const [status, setStatus] = useState<GlobeStatus>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Latest-ref pattern: the scene must not be rebuilt when the parent passes a
  // fresh callback identity.
  useEffect(() => {
    notifyRef.current = onSelectMarker;
  }, [onSelectMarker]);

  // Boot the WebGL scene once per marker payload, on the client only.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    let handle: GlobeSceneHandle | null = null;

    void import('./globeScene')
      .then((module) => {
        if (!active) return;
        handle = module.createGlobeScene(container, {
          markers,
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          onSelectMarker: (marker) => {
            notifyRef.current?.(marker);
            setSelectedId(marker ? marker.id : null);
          },
          onHoverMarker: (markerId) => setHoveredId(markerId),
        });
        sceneRef.current = handle;
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('unavailable');
      });

    return () => {
      active = false;
      sceneRef.current = null;
      handle?.dispose();
      handle = null;
    };
  }, [markers]);

  // React -> scene: the accessible list, the buttons and Escape all land here.
  useEffect(() => {
    sceneRef.current?.selectMarker(selectedId);
  }, [selectedId]);

  const selected = useMemo(
    () => (selectedId ? markers.find((marker) => marker.id === selectedId) ?? null : null),
    [markers, selectedId],
  );
  const hovered = useMemo(
    () => (hoveredId ? markers.find((marker) => marker.id === hoveredId) ?? null : null),
    [markers, hoveredId],
  );

  const ready = status === 'ready';

  const toggleSelection = useCallback((markerId: string) => {
    setSelectedId((previous) => (previous === markerId ? null : markerId));
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const handle = sceneRef.current;
    if (!handle) return;

    switch (event.key) {
      case 'ArrowLeft':
        handle.nudgeOrbit(-GLOBE_KEY_ROTATE_STEP, 0);
        break;
      case 'ArrowRight':
        handle.nudgeOrbit(GLOBE_KEY_ROTATE_STEP, 0);
        break;
      case 'ArrowUp':
        handle.nudgeOrbit(0, GLOBE_KEY_ROTATE_STEP);
        break;
      case 'ArrowDown':
        handle.nudgeOrbit(0, -GLOBE_KEY_ROTATE_STEP);
        break;
      case '+':
      case '=':
        handle.nudgeZoom(1 / GLOBE_KEY_ZOOM_FACTOR);
        break;
      case '-':
      case '_':
        handle.nudgeZoom(GLOBE_KEY_ZOOM_FACTOR);
        break;
      case 'Escape':
        setSelectedId(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      className={[
        'rounded-3xl border border-sand bg-white p-4 shadow-soft sm:p-5',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={PILL_CLASS}>
            <GlobeIcon className="h-3.5 w-3.5" />
            Mission Globe
          </span>
          <span className="inline-flex items-center rounded-full border border-sand bg-white px-3 py-1 text-xs font-bold tabular-nums text-muted">
            {markers.length === 0
              ? 'Awaiting gatherings'
              : `${markers.length} ${markers.length === 1 ? 'gathering' : 'gatherings'} mapped`}
          </span>
          {hovered ? (
            <span
              aria-hidden="true"
              className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-pill px-3 py-1 text-xs font-bold text-pill-ink"
            >
              {normalizeMarkerName(hovered.first_name)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => sceneRef.current?.nudgeZoom(1 / GLOBE_KEY_ZOOM_FACTOR)}
            disabled={!ready}
            aria-label="Zoom in"
            className={CONTROL_CLASS}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => sceneRef.current?.nudgeZoom(GLOBE_KEY_ZOOM_FACTOR)}
            disabled={!ready}
            aria-label="Zoom out"
            className={CONTROL_CLASS}
          >
            &minus;
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              sceneRef.current?.resetView();
            }}
            disabled={!ready}
            className={CONTROL_CLASS}
          >
            Reset view
          </button>
        </div>
      </div>

      <p id="mission-globe-instructions" className="mt-3 text-xs leading-5 text-muted">
        Drag to spin the globe, scroll or pinch to zoom, then tap a character to meet that gathering.
        Arrow keys orbit, <span className="font-bold">+</span> and{' '}
        <span className="font-bold">&minus;</span> zoom. Every marker is a privacy-safe centroid
        &mdash; never a street address.
      </p>

      <div
        ref={containerRef}
        role="group"
        aria-label="Interactive 3D globe of church gatherings"
        aria-describedby="mission-globe-instructions"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative mt-4 aspect-[4/3] w-full touch-none overflow-hidden rounded-3xl border border-sand bg-[radial-gradient(circle_at_50%_45%,#FFFFFF_0%,#FAF7EE_55%,#F6EFE2_100%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 sm:aspect-[16/9] [&>canvas]:absolute [&>canvas]:inset-0 [&>canvas]:h-full [&>canvas]:w-full"
      >
        {status === 'loading' ? (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
          >
            <span
              aria-hidden="true"
              className="h-8 w-8 animate-spin rounded-full border-2 border-sand border-t-gold"
            />
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
              Preparing the mission globe&hellip;
            </p>
          </div>
        ) : null}

        {status === 'unavailable' ? (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
          >
            <p className="text-sm font-bold text-espresso">
              This device could not start the 3D globe.
            </p>
            <p className="text-xs leading-5 text-muted">
              Every gathering is still listed below &mdash; the storybook roster works without
              WebGL.
            </p>
          </div>
        ) : null}
      </div>

      {selected ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-3xl border border-sand bg-pill/60 p-3"
        >
          <span
            aria-hidden="true"
            className="h-10 w-10 shrink-0 rounded-full border border-sand bg-cover bg-center"
            style={{ backgroundImage: `url(${avatarStyleForSeed(selected.id).file})` }}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-espresso">
              {normalizeMarkerName(selected.first_name)}
            </p>
            <p className="text-xs text-muted">
              {selected.city || 'Community gathering'} &middot; {selected.member_count}{' '}
              {selected.member_count === 1 ? 'believer' : 'believers'}
            </p>
          </div>
          <p className="ml-auto text-[11px] leading-4 text-muted">
            Privacy-safe centroid &middot; exact address withheld
          </p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">
          Tap a character on the globe &mdash; or a name below &mdash; to meet the gathering.
        </p>
      )}

      <div className="mt-5">
        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
          Gatherings on the globe
        </h3>

        {markers.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-sand bg-canvas p-4 text-center text-xs leading-5 text-muted">
            No approved gatherings are on the globe yet. Approved gatherings appear here as
            storybook characters.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {markers.map((marker) => {
              const isSelected = marker.id === selectedId;
              return (
                <li key={marker.id}>
                  <button
                    type="button"
                    onClick={() => toggleSelection(marker.id)}
                    aria-pressed={isSelected}
                    className={[
                      MARKER_BUTTON_CLASS,
                      isSelected
                        ? 'border-gold bg-pill text-pill-ink'
                        : 'border-sand bg-white text-espresso hover:border-gold hover:bg-pill',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden="true"
                      className="h-6 w-6 shrink-0 rounded-full border border-sand bg-cover bg-center"
                      style={{ backgroundImage: `url(${avatarStyleForSeed(marker.id).file})` }}
                    />
                    <span>{normalizeMarkerName(marker.first_name)}</span>
                    {marker.city ? (
                      <span className="font-medium text-muted">{marker.city}</span>
                    ) : null}
                    <span className="tabular-nums text-muted">{marker.member_count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}