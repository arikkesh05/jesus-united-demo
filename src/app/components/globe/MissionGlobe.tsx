'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { GlobeIcon } from '@/app/components/icons';
import { avatarStyleForSeed, normalizeMarkerName } from '@/lib/globeAvatars';
import { GLOBE_KEY_ROTATE_STEP, GLOBE_KEY_ZOOM_FACTOR } from '@/lib/globeCamera';
import {
  HUD_GLASS_PANEL, HUD_COUNTER_BADGE, HUD_HINT, HUD_PREVIEW_CARD,
  INTERACTION_HINT, formatGatheringCounter, formatAmbassadorName,
} from '@/lib/globeHud';
import type { GlobeMarker } from '@/lib/types';
import type { GlobeSceneHandle } from './globeScene';
import GlobeSearch from './GlobeSearch';

/**
 * Mission Globe cinematic stage (Refero motion specification).
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

const CONTROL_CLASS =
  'inline-flex h-11 min-w-11 items-center justify-center rounded-full border border-white/12 bg-slate-900/65 px-3 text-xs font-semibold text-white backdrop-blur-xl transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40';
const MARKER_BUTTON_CLASS =
  'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300';
const CONNECT_PRIMARY_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-300 px-4 text-xs font-bold text-slate-900 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 motion-reduce:transition-none';
const CONNECT_SECONDARY_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-slate-900/65 px-4 text-xs font-semibold text-white backdrop-blur-xl transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 motion-reduce:transition-none';
const CONNECT_NOTICE_CLASS = 'min-h-5 text-xs font-semibold text-cyan-300';

/** Focus-trap cycle set for the connect dialog. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

type ShareNoticeKind = 'copied' | 'failed';

/**
 * Privacy-safe share URL: an opaque marker id only — never coordinates,
 * contact details, or any other personal data (code-review Privacy Lens).
 */
function gatheringShareUrl(markerId: string): string {
  return `${window.location.origin}?gathering=${encodeURIComponent(markerId)}`;
}

/**
 * Resolves the `?gathering={id}` deep link against the server-provided markers.
 * Returns the matched id, or null when absent/invalid — the raw URL value is
 * only ever compared against real marker ids, never rendered or trusted as
 * data (Privacy Lens). Safe for SSR (returns null without touching `window`).
 */
function readDeepLinkGatheringId(available: readonly GlobeMarker[]): string | null {
  if (typeof window === 'undefined') return null;
  const requested =
    new URLSearchParams(window.location.search).get('gathering')?.trim() ?? '';
  if (!requested || requested.length > 128) return null;
  const match = available.find((marker) => marker.id === requested);
  return match ? match.id : null;
}

/**
 * Mission Globe cinematic stage (Refero motion specification).
 *
 * Owns the React side of the WebGL globe: server-safe skeleton, lazy client-only
 * scene boot, keyboard/button controls and the accessible storybook list. The
 * three.js engine itself is loaded with a dynamic `import()` inside an effect, so
 * `three` never runs during SSR and `window` is only ever touched post-mount.
 */
export default function MissionGlobe({ markers, onSelectMarker, className }: MissionGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GlobeSceneHandle | null>(null);
  const notifyRef = useRef(onSelectMarker);
  const [status, setStatus] = useState<GlobeStatus>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [shareNotice, setShareNotice] = useState<ShareNoticeKind | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const connectButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const shareNoticeTimerRef = useRef<number | null>(null);
  // Selections made before the async WebGL boot finishes (deep links) are
  // replayed through the scene once it exists.
  const selectedIdRef = useRef<string | null>(null);
  /** The `?gathering=` deep link is applied at most once, at first scene boot. */
  const deepLinkAppliedRef = useRef(false);

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
            setSelectedId(marker ? marker.id : null);
          },
          onHoverMarker: (markerId) => setHoveredId(markerId),
        });
        sceneRef.current = handle;
        if (!deepLinkAppliedRef.current) {
          // Deep-link init: `?gathering={id}` selects the matching marker — the
          // scene's selection pipeline flies the camera to its centroid — and
          // the React state syncs the docked card. setState is called from this
          // async boot callback (not synchronously in an effect body).
          const deepLinkId = readDeepLinkGatheringId(markers);
          if (deepLinkId !== null) {
            deepLinkAppliedRef.current = true;
            handle.selectMarker(deepLinkId);
            setSelectedId(deepLinkId);
            // Deep-linked visitors land wherever the browser left them — bring
            // the globe into view. Reduced motion skips the smooth glide
            // (motion-compliance invariant).
            const globeEl =
              document.getElementById('mission-globe') ?? containerRef.current;
            globeEl?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
              block: 'center',
            });
          } else if (selectedIdRef.current) {
            // Replay any pending selection that landed before the boot resolved.
            handle.selectMarker(selectedIdRef.current);
          }
        }
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
  // The ref mirror also feeds the async boot's pending-selection replay.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    sceneRef.current?.selectMarker(selectedId);
  }, [selectedId]);

  // Live reduced-motion sync: camera damping/idle spin honor the OS preference
  // without rebuilding the WebGL context (React & WebGL Hygiene Lens).
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => sceneRef.current?.setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const selected = useMemo(
    () => (selectedId ? markers.find((marker) => marker.id === selectedId) ?? null : null),
    [markers, selectedId],
  );
  const hovered = useMemo(
    () => (hoveredId ? markers.find((marker) => marker.id === hoveredId) ?? null : null),
    [markers, hoveredId],
  );

  const cityCount = useMemo(() => new Set(
    markers.map((marker) => marker.city.trim().toLocaleLowerCase()).filter(Boolean),
  ).size, [markers]);

  useEffect(() => {
    notifyRef.current?.(selected);
  }, [selected]);

  const ready = status === 'ready';

  const toggleSelection = useCallback((markerId: string) => {
    setSelectedId((previous) => (previous === markerId ? null : markerId));
  }, []);

  // --- Share (Web Share API -> clipboard fallback) ---------------------------
  const showShareNotice = useCallback((kind: ShareNoticeKind) => {
    setShareNotice(kind);
    if (shareNoticeTimerRef.current !== null) window.clearTimeout(shareNoticeTimerRef.current);
    shareNoticeTimerRef.current = window.setTimeout(() => {
      shareNoticeTimerRef.current = null;
      setShareNotice(null);
    }, 2200);
  }, []);

  useEffect(
    () => () => {
      if (shareNoticeTimerRef.current !== null) window.clearTimeout(shareNoticeTimerRef.current);
    },
    [],
  );

  const shareGathering = useCallback(
    async (markerId: string): Promise<void> => {
      const url = gatheringShareUrl(markerId);
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'Jesus United gathering', url });
          return; // handed to the OS share sheet — it shows its own feedback.
        } catch (error) {
          // A user-cancelled share sheet is a deliberate no-op, not a failure.
          if (error instanceof DOMException && error.name === 'AbortError') return;
          // Any other rejection falls through to the clipboard fallback.
        }
      }
      try {
        if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(url);
        showShareNotice('copied');
      } catch {
        // Permission denied / insecure context: degrade visibly, never throw.
        showShareNotice('failed');
      }
    },
    [showShareNotice],
  );

  // --- Connect dialog (focus trap / Escape / backdrop / restore) -------------
  const openConnectModal = useCallback(() => {
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConnectOpen(true);
  }, []);

  const closeConnectModal = useCallback(() => {
    setConnectOpen(false);
    const invoker = lastFocusedRef.current;
    lastFocusedRef.current = null;
    invoker?.focus();
  }, []);

  // Move focus into the dialog once it mounts.
  useEffect(() => {
    if (!connectOpen) return;
    const frame = window.requestAnimationFrame(() => {
      modalRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [connectOpen]);

  const handleModalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Close the dialog only — never let the stage deselect the ambassador.
      event.stopPropagation();
      closeConnectModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const modal = modalRef.current;
    if (!modal) return;
    const focusables = Array.from(
      modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && modal.contains(active);
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeConnectModal();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setSelectedId(null);
      return;
    }
    if (event.target !== containerRef.current) return;
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
      id="mission-globe"
      className={[
        'overflow-hidden rounded-3xl bg-black text-white',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <div className="relative isolate min-h-[85vh] overflow-hidden bg-black" onKeyDown={handleKeyDown}>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${HUD_GLASS_PANEL} inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold`}>
              <GlobeIcon className="h-3.5 w-3.5 text-cyan-300" />
              Mission Globe
            </span>
            <span className={HUD_COUNTER_BADGE}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              {formatGatheringCounter(markers.length, cityCount)}
            </span>
            {hovered ? (
              <span aria-hidden="true" className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-900">
                {normalizeMarkerName(hovered.first_name)}
              </span>
            ) : null}
            <div className="pointer-events-auto">
              <GlobeSearch
                markers={markers}
                disabled={!ready}
                onSelect={(marker) => {
                  // Same selection path as a direct tap: the scene flies to the
                  // marker's cluster centroid at CLUSTER_FOCUS_DISTANCE, which
                  // lands inside the fan-out window and unfolds the formation.
                  sceneRef.current?.selectMarker(marker.id);
                  setSelectedId(marker.id);
                }}
              />
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
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

        <p id="mission-globe-instructions" className="sr-only">
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
          className="absolute inset-0 touch-none overflow-hidden bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 [&>canvas]:absolute [&>canvas]:inset-0 [&>canvas]:h-full [&>canvas]:w-full"
        >
          {status === 'loading' ? (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
            >
              <span
                aria-hidden="true"
                className="h-8 w-8 animate-spin rounded-full border-2 border-white/12 border-t-cyan-300 motion-reduce:animate-none"
              />
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                Preparing the mission globe&hellip;
              </p>
            </div>
          ) : null}

          {status === 'unavailable' ? (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
            >
              <p className="text-sm font-bold text-white">
                This device could not start the 3D globe.
              </p>
              <p className="text-xs leading-5 text-slate-400">
                Every gathering is still listed below &mdash; the storybook roster works without
                WebGL.
              </p>
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4 sm:p-6">
          <p className={`${HUD_HINT} mb-3 text-center`}>{INTERACTION_HINT}</p>
          {!selected ? (
            <p className="text-center text-xs text-slate-400">Tap a character or choose a gathering below.</p>
          ) : null}
        </div>

        {/*
          Ambassador card — pinned flush to the viewport's bottom-left corner,
          directly on the stage wrapper (no centering or padding wrapper, so
          nothing can push it upward), and hard-capped at 300px so it stays a
          discreet corner card and never crosses the Earth mesh.
        */}
        <div
          aria-hidden={!selected}
          inert={!selected}
          className={[
            HUD_PREVIEW_CARD,
            'pointer-events-auto absolute bottom-6 left-6 right-6 z-30 max-w-75 rounded-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none sm:right-auto sm:w-75',
            selected ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
          ].join(' ')}
        >
          {selected ? (
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="h-12 w-12 shrink-0 rounded-full border border-white/12 bg-cover bg-center"
                style={{ backgroundImage: `url(${avatarStyleForSeed(selected.id).file})` }}
              />
              <div className="min-w-0 flex-1" role="status" aria-live="polite">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Gathering ambassador</p>
                <h3 className="mt-1 wrap-break-word text-lg font-bold tracking-tight">
                  {formatAmbassadorName(normalizeMarkerName(selected.first_name))}
                </h3>
                <p className="mt-1 wrap-break-word text-xs text-slate-300">
                  {selected.city || 'Community gathering'} &middot; {selected.member_count}{' '}
                  {selected.member_count === 1 ? 'believer' : 'believers'}
                </p>
              </div>
              <button type="button" className={CONTROL_CLASS} aria-label="Close ambassador preview"
                onClick={() => { setSelectedId(null); containerRef.current?.focus(); }}>
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
          ) : null}
          {selected ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/12 pt-4">
              <button type="button" ref={connectButtonRef} className={CONNECT_PRIMARY_CLASS}
                onClick={openConnectModal}>
                Connect
              </button>
              <button type="button" className={CONNECT_SECONDARY_CLASS}
                onClick={() => void shareGathering(selected.id)}>
                Share
              </button>
              <span aria-live="polite" role="status" className={CONNECT_NOTICE_CLASS}>
                {shareNotice === 'copied'
                  ? 'Copied!'
                  : shareNotice === 'failed'
                    ? 'Copy blocked — copy the link from the address bar.'
                    : ''}
              </span>
            </div>
          ) : null}
          <p className="mt-4 border-t border-white/12 pt-3 text-[11px] leading-4 text-slate-400">
            Privacy-safe centroid &middot; exact address withheld
          </p>
        </div>

        {connectOpen && selected ? (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm motion-reduce:backdrop-blur-none sm:items-center"
            onClick={handleBackdropClick}
          >
            <div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="connect-dialog-title"
              aria-describedby="connect-dialog-description"
              onKeyDown={handleModalKeyDown}
              className={[
                HUD_PREVIEW_CARD,
                'w-full max-w-sm rounded-3xl p-6 shadow-2xl transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  aria-hidden="true"
                  className="h-12 w-12 shrink-0 rounded-full border border-white/12 bg-cover bg-center"
                  style={{ backgroundImage: `url(${avatarStyleForSeed(selected.id).file})` }}
                />
                <button type="button" className={CONTROL_CLASS} aria-label="Close connect dialog"
                  onClick={closeConnectModal}>
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <h2 id="connect-dialog-title" className="mt-4 text-lg font-bold tracking-tight">
                Connect with {formatAmbassadorName(normalizeMarkerName(selected.first_name))}
              </h2>
              <p id="connect-dialog-description" className="mt-2 text-xs leading-5 text-slate-300">
                {selected.city || 'Community gathering'} &middot; {selected.member_count}{' '}
                {selected.member_count === 1 ? 'believer' : 'believers'}. Contact details are
                never published on the globe &mdash; share the gathering link and a verified
                leader will welcome you in person.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className={CONNECT_PRIMARY_CLASS}
                  onClick={() => void shareGathering(selected.id)}>
                  Copy gathering link
                </button>
                <button type="button" className={CONNECT_SECONDARY_CLASS} onClick={closeConnectModal}>
                  Close
                </button>
              </div>
              <p className="mt-3 min-h-5 text-xs font-semibold text-cyan-300">
                {shareNotice === 'copied'
                  ? 'Copied!'
                  : shareNotice === 'failed'
                    ? 'Copy blocked — copy the link from the address bar.'
                    : ''}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/12 p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          Gatherings on the globe
        </h3>

        {markers.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-white/12 bg-slate-900/65 p-4 text-center text-xs leading-5 text-slate-400">
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
                        ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100'
                        : 'border-white/12 bg-slate-900/65 text-white hover:border-cyan-300/60 hover:bg-slate-800',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden="true"
                      className="h-6 w-6 shrink-0 rounded-full border border-white/12 bg-cover bg-center"
                      style={{ backgroundImage: `url(${avatarStyleForSeed(marker.id).file})` }}
                    />
                    <span>{normalizeMarkerName(marker.first_name)}</span>
                    {marker.city ? (
                      <span className="font-medium text-slate-400">{marker.city}</span>
                    ) : null}
                    <span className="tabular-nums text-slate-400">{marker.member_count}</span>
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
