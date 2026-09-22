'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CloseIcon, HandHeartIcon } from '@/app/components/icons';
import { PRAYER_TOPICS, submitPrayerRequest, type PrayerRequestInsert } from '@/lib/prayers';

/** Optional seed for the form, e.g. the Examen-to-intercession bridge. */
export type PrayerSubmissionSeed = Partial<
  Pick<FormValues, 'anonymous' | 'body' | 'title' | 'topics'>
>;

interface PrayerSubmissionModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful share so the opener can react (badges, refetch). */
  onSubmitted?: () => void;
  /**
   * Pre-filled values applied every time the dialog opens. Passed from the
   * Examen-to-intercession bridge so a morning reflection arrives ready to send.
   */
  seed?: PrayerSubmissionSeed;
  /** Optional handoff action offered after a successful share (e.g. view the wall). */
  onViewWall?: () => void;
}

interface FormValues {
  authorName: string;
  title: string;
  body: string;
  anonymous: boolean;
  topics: string[];
}

type FormErrors = Partial<Record<'authorName' | 'title' | 'body' | 'topics', string>>;

const EMPTY_FORM: FormValues = {
  authorName: '',
  title: '',
  body: '',
  anonymous: false,
  topics: [],
};

const MAX_TITLE_LENGTH = 120;
const MIN_BODY_LENGTH = 10;
const MAX_BODY_LENGTH = 1000;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LABEL_CLASS = 'text-xs font-bold uppercase tracking-[0.14em] text-muted';
const FIELD_CLASS =
  'mt-1.5 min-h-[44px] w-full rounded-3xl border border-white/10 bg-canvas/60 px-4 py-2.5 text-sm text-espresso outline-none transition placeholder:text-muted/80 focus:border-gold focus:ring-2 focus:ring-gold/25 disabled:cursor-not-allowed disabled:bg-pill/60 disabled:text-muted';
const ERROR_TEXT_CLASS = 'mt-1 text-xs font-medium text-red-300';
const TOPIC_PILL_CLASS =
  'inline-flex min-h-[44px] items-center rounded-full border px-3.5 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 aria-pressed:border-gold/60 aria-pressed:bg-gold/10 aria-pressed:text-gold aria-[pressed=false]:border-white/10 aria-[pressed=false]:bg-white/5 aria-[pressed=false]:text-slate-300 hover:border-gold/50';

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.anonymous && values.authorName.trim() === '') {
    errors.authorName = 'Your name is required — or choose "Remain Anonymous".';
  }
  if (values.title.trim() === '') {
    errors.title = 'A short title is required.';
  } else if (values.title.trim().length > MAX_TITLE_LENGTH) {
    errors.title = `Keep the title under ${MAX_TITLE_LENGTH} characters.`;
  }
  if (values.body.trim() === '') {
    errors.body = 'Share your prayer request.';
  } else if (values.body.trim().length < MIN_BODY_LENGTH) {
    errors.body = 'Please share a few more words so others can pray meaningfully.';
  } else if (values.body.trim().length > MAX_BODY_LENGTH) {
    errors.body = `Keep the prayer under ${MAX_BODY_LENGTH} characters.`;
  }
  if (values.topics.length === 0) {
    errors.topics = 'Choose at least one topic.';
  }

  return errors;
}

export default function PrayerSubmissionModal({
  open,
  onClose,
  onSubmitted,
  seed,
  onViewWall,
}: PrayerSubmissionModalProps) {
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** True when the share was kept on this device instead of the cloud. */
  const [mirroredLocally, setMirroredLocally] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  /**
   * Dialog behaviour: focus the first field on open, trap Tab cycling inside
   * the dialog, close on Escape, lock page scroll, and restore focus to the
   * trigger when the dialog unmounts.
   */
  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstFieldRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = dialogRef.current;
      if (!container) return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && container.contains(active);

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

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  /**
   * Seeds the form every time the dialog opens: bridge-suggested values when
   * provided, otherwise a blank slate. Mount-gated so the server HTML and the
   * first client render agree (no hydration mismatch).
   */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setValues({
        ...EMPTY_FORM,
        ...seed,
        // A seeded reflection can exceed the field limits; trim so a shared
        // bridge reflection arrives ready to send rather than pre-invalid.
        title: (seed?.title ?? '').slice(0, MAX_TITLE_LENGTH),
        body: (seed?.body ?? '').slice(0, MAX_BODY_LENGTH),
      });
      setErrors({});
      setSubmitted(false);
      setSubmitError(null);
      setMirroredLocally(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, seed]);

  /** A completed submission resets so the next open starts from a fresh form. */
  const requestClose = () => {
    if (submitted) {
      setSubmitted(false);
      setValues({
        ...EMPTY_FORM,
        ...seed,
        title: (seed?.title ?? '').slice(0, MAX_TITLE_LENGTH),
        body: (seed?.body ?? '').slice(0, MAX_BODY_LENGTH),
      });
      setErrors({});
      setSubmitError(null);
      setMirroredLocally(false);
    }
    onClose();
  };

  const updateField =
    (field: 'authorName' | 'title' | 'body') =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setValues((current) => ({ ...current, [field]: value }));
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    };

  const toggleAnonymous = () => {
    setValues((current) => ({ ...current, anonymous: !current.anonymous }));
    setErrors((current) => (current.authorName ? { ...current, authorName: undefined } : current));
  };

  const toggleTopic = (topic: string) => {
    setValues((current) => ({
      ...current,
      topics: current.topics.includes(topic)
        ? current.topics.filter((existing) => existing !== topic)
        : [...current.topics, topic],
    }));
    setErrors((current) => (current.topics ? { ...current, topics: undefined } : current));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some((message) => message !== undefined)) return;

    setSubmitting(true);
    setSubmitError(null);

    const prayer: PrayerRequestInsert = {
      user_id: '',
      author_name: values.anonymous ? '' : values.authorName.trim(),
      title: values.title.trim(),
      body: values.body.trim(),
      topics: values.topics,
      is_public: true,
      is_answered: false,
      answered_note: null,
    };

    const result = await submitPrayerRequest(prayer);

    if (result.ok) {
      setMirroredLocally(result.mode === 'guest');
      setSubmitted(true);
      onSubmitted?.();
    } else {
      setSubmitError(result.error ?? 'The prayer service is unavailable. Please try again.');
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
        aria-labelledby="prayer-submission-title"
        aria-describedby="prayer-submission-description"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-pill/95 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-sand px-6 py-5">
          <div>
            <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
              Prayer Wall
            </span>
            <h2
              id="prayer-submission-title"
              className="mt-3 text-lg font-extrabold tracking-tight text-espresso"
            >
              Share a Prayer
            </h2>
            <p
              id="prayer-submission-description"
              className="mt-1 text-sm leading-6 text-muted"
            >
              Your request joins the public wall so the whole community can stand with you in
              prayer.
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

        {submitted ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold text-canvas shadow-soft">
              <CheckIcon className="h-7 w-7" />
            </span>
            <h3 className="mt-4 text-lg font-extrabold tracking-tight text-espresso">
              Your prayer is on the wall
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
              The community can now see your request and press &ldquo;I Prayed&rdquo; to stand
              with you. &ldquo;Pray for one another, that you may be healed&rdquo; (James 5:16).
            </p>
            {mirroredLocally ? (
              <p className="mx-auto mt-3 max-w-sm rounded-2xl border border-gold/30 bg-gold/10 px-4 py-2.5 text-xs font-medium leading-5 text-gold">
                Kept on this device for now &mdash; the community wall will carry it as soon as
                the prayer service is reachable again.
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
              {onViewWall ? (
                <button
                  type="button"
                  onClick={() => {
                    requestClose();
                    onViewWall();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-gold px-5 text-sm font-bold text-canvas shadow-soft transition hover:bg-gold-deep active:scale-95"
                >
                  See it on the wall
                </button>
              ) : null}
              <button
                type="button"
                onClick={requestClose}
                className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-sand bg-pill px-4 text-sm font-bold text-espresso transition hover:border-gold hover:bg-pill"
              >
                Back to the wall
              </button>
            </div>
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              <div>
                <label htmlFor="prayer-author-name" className={LABEL_CLASS}>
                  Author name
                  <span aria-hidden className="text-gold-deep">
                    {' '}*
                  </span>
                </label>
                <input
                  ref={firstFieldRef}
                  id="prayer-author-name"
                  name="prayer-author-name"
                  type="text"
                  value={values.authorName}
                  onChange={updateField('authorName')}
                  placeholder="How you would like to be known"
                  autoComplete="name"
                  disabled={values.anonymous}
                  aria-required={!values.anonymous || undefined}
                  aria-invalid={errors.authorName ? true : undefined}
                  aria-describedby={errors.authorName ? 'prayer-author-name-error' : undefined}
                  className={FIELD_CLASS}
                />
                {errors.authorName ? (
                  <p id="prayer-author-name-error" role="alert" className={ERROR_TEXT_CLASS}>
                    {errors.authorName}
                  </p>
                ) : null}
                <button
                  id="prayer-anonymous-toggle"
                  type="button"
                  aria-pressed={values.anonymous}
                  onClick={toggleAnonymous}
                  className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-pill-ink transition hover:text-espresso focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                >
                  <span
                    aria-hidden
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full border transition ${
                      values.anonymous
                        ? 'border-gold bg-gold text-canvas'
                        : 'border-sand bg-pill text-transparent'
                    }`}
                  >
                    <CheckIcon className="h-2.5 w-2.5" />
                  </span>
                  Remain Anonymous
                </button>
              </div>

              <div>
                <label htmlFor="prayer-title" className={LABEL_CLASS}>
                  Title
                  <span aria-hidden className="text-gold-deep">
                    {' '}*
                  </span>
                </label>
                <input
                  id="prayer-title"
                  name="prayer-title"
                  type="text"
                  value={values.title}
                  onChange={updateField('title')}
                  placeholder="A short summary, e.g. &quot;Healing for my father&quot;"
                  maxLength={MAX_TITLE_LENGTH}
                  aria-required="true"
                  aria-invalid={errors.title ? true : undefined}
                  aria-describedby={errors.title ? 'prayer-title-error' : undefined}
                  className={FIELD_CLASS}
                />
                {errors.title ? (
                  <p id="prayer-title-error" role="alert" className={ERROR_TEXT_CLASS}>
                    {errors.title}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="prayer-body" className={LABEL_CLASS}>
                  Prayer request
                  <span aria-hidden className="text-gold-deep">
                    {' '}*
                  </span>
                </label>
                <textarea
                  id="prayer-body"
                  name="prayer-body"
                  value={values.body}
                  onChange={updateField('body')}
                  rows={5}
                  maxLength={MAX_BODY_LENGTH}
                  placeholder="Share the details you would like the community to pray for…"
                  aria-required="true"
                  aria-invalid={errors.body ? true : undefined}
                  aria-describedby={errors.body ? 'prayer-body-error' : undefined}
                  className={`${FIELD_CLASS} resize-y`}
                />
                {errors.body ? (
                  <p id="prayer-body-error" role="alert" className={ERROR_TEXT_CLASS}>
                    {errors.body}
                  </p>
                ) : null}
              </div>

              <div
                role="group"
                aria-labelledby="prayer-topics-label"
                aria-describedby={errors.topics ? 'prayer-topics-error' : undefined}
              >
                <span id="prayer-topics-label" className={LABEL_CLASS}>
                  Topic
                  <span aria-hidden className="text-gold-deep">
                    {' '}*
                  </span>
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRAYER_TOPICS.map((topic) => {
                    const selected = values.topics.includes(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleTopic(topic)}
                        className={`${TOPIC_PILL_CLASS} ${
                          selected
                            ? 'border-gold bg-pill text-pill-ink'
                            : 'border-sand bg-pill text-muted'
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
                {errors.topics ? (
                  <p id="prayer-topics-error" role="alert" className={ERROR_TEXT_CLASS}>
                    {errors.topics}
                  </p>
                ) : null}
              </div>

              <p className="rounded-2xl border border-sand bg-pill px-4 py-3 text-xs leading-5 text-pill-ink">
                If you are in immediate crisis, please reach a pastor, a trusted local church, or
                emergency services right away &mdash; this wall is for community prayer, not
                emergency care.
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
                  {submitting ? 'Sharing…' : 'Share on the wall'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}