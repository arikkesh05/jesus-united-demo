"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CloseIcon, HandHeartIcon } from "@/app/components/icons";
import {
  buildDropInPrayerRequest,
  DROP_IN_BODY_MAX,
  DROP_IN_NAME_MAX,
  DROP_IN_TOPICS,
  sanitizeDropInDraft,
  type DropInDraft,
  type DropInErrors,
} from "@/lib/intercessionPulse";
import { submitPrayerRequest } from "@/lib/prayers";

/**
 * Sprint 2 — the anonymous prayer drop-in.
 *
 * A deliberately frictionless sibling to `PrayerSubmissionModal`: one required
 * field, an optional name (anonymous by default), and the five pulse topics.
 * The wall card still receives a title — `deriveDropInTitle` lifts the opening
 * words of the prayer itself — so the quick path produces the same row shape as
 * the full form and both appear identically on the wall.
 *
 * Client-side sanitising runs before the network (`sanitizeDropInDraft`): the
 * draft is stripped of control/bidi characters, whitespace-collapsed, length-
 * capped, and refused outright if it carries a phone number, email, link or
 * handle — a public wall must not be a vector for publishing someone's contact
 * details. The dialog keeps the house a11y contract too: focus in on open, Tab
 * trapped, Escape closes, scroll locked, focus restored to the trigger.
 */

interface PrayerDropInModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after an accepted share so the opener can react (wall refresh, badges). */
  onShared?: () => void;
}

const EMPTY_DRAFT: DropInDraft = {
  body: "",
  authorName: "",
  anonymous: true,
  topics: [],
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LABEL_CLASS = "text-xs font-bold uppercase tracking-[0.14em] text-muted";
const FIELD_CLASS =
  "mt-1.5 min-h-[44px] w-full rounded-3xl border border-white/10 bg-canvas/60 px-4 py-2.5 text-sm text-espresso outline-none transition placeholder:text-muted/80 focus:border-gold focus:ring-2 focus:ring-gold/25 disabled:cursor-not-allowed disabled:bg-pill/60 disabled:text-muted";
const ERROR_TEXT_CLASS = "mt-1 text-xs font-medium text-red-300";
const TOPIC_PILL_CLASS =
  "inline-flex min-h-[44px] items-center rounded-full border px-3.5 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50";

export default function PrayerDropInModal({
  open,
  onClose,
  onShared,
}: PrayerDropInModalProps) {
  const [draft, setDraft] = useState<DropInDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DropInErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [shared, setShared] = useState(false);
  const [mirroredLocally, setMirroredLocally] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Dialog behaviour: focus the prayer field on open, trap Tab cycling inside
   * the dialog, close on Escape, lock page scroll, and restore focus to the
   * trigger when the dialog unmounts.
   */
  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    bodyRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const container = dialogRef.current;
      if (!container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside =
        active instanceof HTMLElement && container.contains(active);

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  /**
   * A fresh draft every time the dialog opens. Mount-gated (the state lands in
   * a microtask, not synchronously in the effect) so the first client render
   * matches the server HTML.
   */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setDraft(EMPTY_DRAFT);
      setErrors({});
      setShared(false);
      setSubmitError(null);
      setMirroredLocally(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const updateBody = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setDraft((current) => ({ ...current, body: value }));
    setErrors((current) =>
      current.body ? { ...current, body: undefined } : current,
    );
  };

  const updateAuthorName = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setDraft((current) => ({ ...current, authorName: value }));
    setErrors((current) =>
      current.authorName ? { ...current, authorName: undefined } : current,
    );
  };

  const toggleAnonymous = () => {
    setDraft((current) => ({ ...current, anonymous: !current.anonymous }));
    setErrors((current) =>
      current.authorName ? { ...current, authorName: undefined } : current,
    );
  };

  const toggleTopic = (topic: string) => {
    setDraft((current) => ({
      ...current,
      topics: current.topics.includes(topic)
        ? current.topics.filter((existing) => existing !== topic)
        : [...current.topics, topic],
    }));
    setErrors((current) =>
      current.topics ? { ...current, topics: undefined } : current,
    );
  };

  /** Clears the dialog back to a blank, anonymous draft. */
  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setShared(false);
    setSubmitError(null);
    setMirroredLocally(false);
  };

  /** A completed share resets so the next open starts fresh. */
  const requestClose = () => {
    if (shared) resetDraft();
    onClose();
  };

  /** Smooth handoff: carry the believer down to the wall where the prayer landed. */
  const scrollToWall = () => {
    const wall = document.getElementById("prayer-wall-section");
    if (!wall) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    wall.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const validation = sanitizeDropInDraft(draft);
    setErrors(validation.errors);
    if (!validation.ok) return;

    setSubmitting(true);
    setSubmitError(null);

    const result = await submitPrayerRequest({
      user_id: "",
      ...buildDropInPrayerRequest(validation.values),
    });

    if (result.ok) {
      setMirroredLocally(result.mode === "guest");
      setShared(true);
      onShared?.();
    } else {
      setSubmitError(
        result.error ?? "The prayer service is unavailable. Please try again.",
      );
    }
    setSubmitting(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        aria-hidden
        className="absolute inset-0 bg-canvas/70 backdrop-blur-sm"
        onClick={requestClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prayer-drop-in-title"
        aria-describedby="prayer-drop-in-description"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-pill/95 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-sand px-6 py-5">
          <div>
            <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
              Intercession Pulse
            </span>
            <h2
              id="prayer-drop-in-title"
              className="mt-3 text-lg font-extrabold tracking-tight text-espresso"
            >
              Drop a Prayer
            </h2>
            <p
              id="prayer-drop-in-description"
              className="mt-1 text-sm leading-6 text-muted"
            >
              One line is enough. It joins the public wall anonymously, and the
              community can pray with you right away.
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close dialog"
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 outline-none transition hover:border-gold/50 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {shared ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold text-canvas shadow-soft">
              <CheckIcon className="h-7 w-7" />
            </span>
            <h3 className="mt-4 text-lg font-extrabold tracking-tight text-espresso">
              Your prayer is on the wall
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
              The community can now see your request and press &ldquo;I
              Prayed&rdquo; to stand with you. &ldquo;Pray for one another, that
              you may be healed&rdquo; (James 5:16).
            </p>
            {mirroredLocally ? (
              <p className="mx-auto mt-3 max-w-sm rounded-2xl border border-gold/30 bg-gold/10 px-4 py-2.5 text-xs font-medium leading-5 text-gold">
                Kept on this device for now &mdash; the community wall will
                carry it as soon as the prayer service is reachable again.
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  requestClose();
                  scrollToWall();
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-gold px-5 text-sm font-bold text-canvas shadow-soft transition hover:bg-gold-deep active:scale-95"
              >
                See it on the wall
              </button>
              <button
                type="button"
                onClick={resetDraft}
                className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-sand bg-pill px-4 text-sm font-bold text-espresso transition hover:border-gold hover:bg-pill"
              >
                Offer another prayer
              </button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              <div>
                <label htmlFor="drop-in-body" className={LABEL_CLASS}>
                  What can we pray for?
                  <span aria-hidden className="text-gold-deep">
                    {" "}
                    *
                  </span>
                </label>
                <textarea
                  ref={bodyRef}
                  id="drop-in-body"
                  name="drop-in-body"
                  rows={4}
                  value={draft.body}
                  onChange={updateBody}
                  maxLength={DROP_IN_BODY_MAX}
                  placeholder='e.g. "Healing for my father before surgery"'
                  aria-required="true"
                  aria-invalid={errors.body ? true : undefined}
                  aria-describedby={
                    errors.body ? "drop-in-body-error" : "drop-in-body-counter"
                  }
                  className={`${FIELD_CLASS} resize-none leading-6`}
                />
                {errors.body ? (
                  <p
                    id="drop-in-body-error"
                    role="alert"
                    className={ERROR_TEXT_CLASS}
                  >
                    {errors.body}
                  </p>
                ) : (
                  <p
                    id="drop-in-body-counter"
                    className="mt-1 text-right text-[11px] font-medium tabular-nums text-muted"
                  >
                    {DROP_IN_BODY_MAX - draft.body.length} characters left
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="drop-in-name" className={LABEL_CLASS}>
                  Your name
                  <span className="ml-1 font-medium normal-case tracking-normal text-muted">
                    (optional)
                  </span>
                </label>
                <input
                  id="drop-in-name"
                  name="drop-in-name"
                  type="text"
                  value={draft.authorName}
                  onChange={updateAuthorName}
                  placeholder="How you would like to be known"
                  autoComplete="name"
                  maxLength={DROP_IN_NAME_MAX}
                  disabled={draft.anonymous}
                  aria-invalid={errors.authorName ? true : undefined}
                  aria-describedby={
                    errors.authorName ? "drop-in-name-error" : undefined
                  }
                  className={FIELD_CLASS}
                />
                {errors.authorName ? (
                  <p
                    id="drop-in-name-error"
                    role="alert"
                    className={ERROR_TEXT_CLASS}
                  >
                    {errors.authorName}
                  </p>
                ) : null}
                <button
                  id="drop-in-anonymous-toggle"
                  type="button"
                  aria-pressed={draft.anonymous}
                  onClick={toggleAnonymous}
                  className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-pill-ink transition hover:text-espresso focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                >
                  <span
                    aria-hidden
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full border transition ${
                      draft.anonymous
                        ? "border-gold bg-gold text-canvas"
                        : "border-sand bg-pill text-transparent"
                    }`}
                  >
                    <CheckIcon className="h-2.5 w-2.5" />
                  </span>
                  Pray anonymously
                </button>
              </div>

              <div
                role="group"
                aria-labelledby="drop-in-topics-label"
                aria-describedby={
                  errors.topics ? "drop-in-topics-error" : undefined
                }
              >
                <span id="drop-in-topics-label" className={LABEL_CLASS}>
                  Topic
                  <span aria-hidden className="text-gold-deep">
                    {" "}
                    *
                  </span>
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DROP_IN_TOPICS.map((topic) => {
                    const selected = draft.topics.includes(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleTopic(topic)}
                        className={`${TOPIC_PILL_CLASS} ${
                          selected
                            ? "border-gold bg-pill text-pill-ink"
                            : "border-sand bg-pill text-muted hover:border-gold/50"
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
                {errors.topics ? (
                  <p
                    id="drop-in-topics-error"
                    role="alert"
                    className={ERROR_TEXT_CLASS}
                  >
                    {errors.topics}
                  </p>
                ) : null}
              </div>

              <p className="rounded-2xl border border-sand bg-pill px-4 py-3 text-xs leading-5 text-pill-ink">
                If you are in immediate crisis, please reach a pastor, a trusted
                local church, or emergency services right away &mdash; this wall
                is for community prayer, not emergency care.
              </p>

              {submitError ? (
                <p
                  role="alert"
                  className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300"
                >
                  {submitError}
                </p>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-white/10 bg-pill/95 p-6 pt-4 backdrop-blur-xl">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={requestClose}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-sand bg-pill px-4 py-2.5 text-sm font-bold text-espresso transition hover:border-gold hover:bg-pill"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-canvas transition hover:bg-gold-deep hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <HandHeartIcon className="h-4 w-4" />
                  {submitting ? "Dropping…" : "Drop it on the wall"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
