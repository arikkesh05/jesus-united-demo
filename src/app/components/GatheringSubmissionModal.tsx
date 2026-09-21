'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CloseIcon } from '@/app/components/icons';
import { submitGathering } from '@/lib/gatheringsSubmissions';
import type { GatheringSubmissionData } from '@/lib/types';

interface GatheringSubmissionModalProps {
  open: boolean;
  onClose: () => void;
}

interface FormValues {
  name: string;
  city: string;
  country: string;
  denomination: string;
  meetingTimes: string;
  address: string;
  coordinates: string;
  submitterName: string;
  submitterEmail: string;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY_FORM: FormValues = {
  name: '',
  city: '',
  country: '',
  denomination: '',
  meetingTimes: '',
  address: '',
  coordinates: '',
  submitterName: '',
  submitterEmail: '',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LABEL_CLASS = 'text-xs font-bold uppercase tracking-[0.14em] text-muted';
const FIELD_CLASS =
  'mt-1.5 w-full rounded-full border border-sand bg-pill px-4 py-2.5 text-sm text-espresso outline-none transition placeholder:text-muted/60 focus:border-gold focus:ring-2 focus:ring-gold/25';
const ERROR_TEXT_CLASS = 'mt-1 text-xs font-medium text-red-700';

/** Parses an optional "latitude, longitude" input; `null` when not usable. */
function parseCoordinates(value: string): { latitude: number; longitude: number } | null {
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0].trim());
  const longitude = Number(parts[1].trim());
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.name.trim() === '') errors.name = 'Gathering name is required.';
  if (values.city.trim() === '') errors.city = 'City is required.';
  if (values.country.trim() === '') errors.country = 'Country is required.';
  if (values.meetingTimes.trim() === '') errors.meetingTimes = 'Meeting times are required.';
  if (values.address.trim() === '') errors.address = 'An address is required.';
  if (values.coordinates.trim() !== '' && parseCoordinates(values.coordinates) === null) {
    errors.coordinates = 'Use "latitude, longitude" — e.g. 30.2672, -97.7431.';
  }
  if (values.submitterName.trim() === '') errors.submitterName = 'Your name is required.';
  if (values.submitterEmail.trim() === '') {
    errors.submitterEmail = 'Your email is required.';
  } else if (!EMAIL_PATTERN.test(values.submitterEmail.trim())) {
    errors.submitterEmail = 'Enter a valid email address.';
  }

  return errors;
}

export default function GatheringSubmissionModal({ open, onClose }: GatheringSubmissionModalProps) {
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  /** A completed submission resets so the next open starts from a fresh form. */
  const requestClose = () => {
    if (submitted) {
      setSubmitted(false);
      setValues(EMPTY_FORM);
      setErrors({});
      setSubmitError(null);
    }
    onClose();
  };

  const updateField =
    (field: keyof FormValues) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setValues((current) => ({ ...current, [field]: value }));
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some((message) => message !== undefined)) return;

    setSubmitting(true);
    setSubmitError(null);

    const coordinates =
      values.coordinates.trim() === '' ? null : parseCoordinates(values.coordinates);
    const address = [values.address.trim(), values.city.trim(), values.country.trim()]
      .filter(Boolean)
      .join(', ');
    const submitterName = values.submitterName.trim();
    const submitterEmail = values.submitterEmail.trim();

    const gatheringData: GatheringSubmissionData = {
      name: values.name.trim(),
      meeting_time: values.meetingTimes.trim(),
      address,
      leader_name: submitterName,
      description:
        values.denomination.trim() === ''
          ? null
          : `Denomination / type: ${values.denomination.trim()}`,
      contact_email: submitterEmail,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    };

    const result = await submitGathering({
      submitter_name: submitterName,
      submitter_email: submitterEmail,
      gathering_data: gatheringData,
    });

    if (result.ok) {
      setSubmitted(true);
    } else {
      setSubmitError(result.error ?? 'The submission service is unavailable. Please try again.');
    }
    setSubmitting(false);
  };

  if (!open) return null;

  const fieldError = (field: keyof FormValues) => errors[field];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        aria-hidden
        className="absolute inset-0 bg-canvas/40 backdrop-blur-[2px]"
        onClick={requestClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gathering-submission-title"
        aria-describedby="gathering-submission-description"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-sand bg-canvas shadow-lift"
      >
        <div className="flex items-start justify-between gap-4 border-b border-sand px-6 py-5">
          <div>
            <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
              Community Submission
            </span>
            <h2
              id="gathering-submission-title"
              className="mt-3 text-lg font-extrabold tracking-tight text-espresso"
            >
              Share a Gathering
            </h2>
            <p
              id="gathering-submission-description"
              className="mt-1 text-sm leading-6 text-muted"
            >
              Tell us about a church or fellowship so believers near you can find it. Our team
              reviews every submission before it appears on the map.
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close dialog"
            className="shrink-0 rounded-full border border-sand bg-pill p-2 text-muted transition hover:border-gold/50 hover:bg-pill hover:text-espresso"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold text-canvas shadow-soft">
              <CheckIcon className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-lg font-extrabold text-espresso">Submission received</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
              Thank you for helping believers gather. We will review{' '}
              <strong className="font-bold text-espresso">{values.name.trim()}</strong> and email
              you at <strong className="font-bold text-espresso">{values.submitterEmail.trim()}</strong>{' '}
              once it is approved.
            </p>
            <button
              type="button"
              onClick={requestClose}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-canvas transition hover:bg-gold-deep hover:shadow-md"
            >
              Done
            </button>
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5">
            <div className="grid gap-4">
              <SubmissionField
                id="gs-name"
                label="Gathering name"
                required
                placeholder="e.g. Grace Fellowship Austin"
                value={values.name}
                onChange={updateField('name')}
                error={fieldError('name')}
                inputRef={firstFieldRef}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <SubmissionField
                  id="gs-city"
                  label="City"
                  required
                  placeholder="Austin"
                  autoComplete="address-level2"
                  value={values.city}
                  onChange={updateField('city')}
                  error={fieldError('city')}
                />
                <SubmissionField
                  id="gs-country"
                  label="Country"
                  required
                  placeholder="United States"
                  autoComplete="country-name"
                  value={values.country}
                  onChange={updateField('country')}
                  error={fieldError('country')}
                />
              </div>

              <SubmissionField
                id="gs-denomination"
                label="Denomination / type"
                placeholder="e.g. Non-denominational, Baptist, Charismatic"
                value={values.denomination}
                onChange={updateField('denomination')}
              />

              <SubmissionField
                id="gs-meeting"
                label="Meeting times"
                required
                placeholder="e.g. Sundays at 10:00 AM"
                value={values.meetingTimes}
                onChange={updateField('meetingTimes')}
                error={fieldError('meetingTimes')}
              />

              <SubmissionField
                id="gs-address"
                label="Street address"
                required
                placeholder="123 Main Street"
                autoComplete="street-address"
                value={values.address}
                onChange={updateField('address')}
                error={fieldError('address')}
              />

              <SubmissionField
                id="gs-coordinates"
                label="Coordinates"
                placeholder="e.g. 30.2672, -97.7431"
                value={values.coordinates}
                onChange={updateField('coordinates')}
                error={fieldError('coordinates')}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <SubmissionField
                  id="gs-submitter-name"
                  label="Your name"
                  required
                  autoComplete="name"
                  value={values.submitterName}
                  onChange={updateField('submitterName')}
                  error={fieldError('submitterName')}
                />
                <SubmissionField
                  id="gs-submitter-email"
                  label="Your email"
                  required
                  type="email"
                  autoComplete="email"
                  value={values.submitterEmail}
                  onChange={updateField('submitterEmail')}
                  error={fieldError('submitterEmail')}
                />
              </div>

              {submitError ? (
                <p
                  role="alert"
                  className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {submitError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={requestClose}
                  className="inline-flex items-center justify-center rounded-full border border-sand bg-pill px-4 py-2.5 text-sm font-bold text-espresso transition hover:border-gold hover:bg-pill"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-canvas transition hover:bg-gold-deep hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Submitting…' : 'Submit for review'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface SubmissionFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

function SubmissionField({
  id,
  label,
  value,
  onChange,
  error,
  required,
  placeholder,
  type = 'text',
  autoComplete,
  inputRef,
}: SubmissionFieldProps) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
        {required ? (
          <span aria-hidden className="text-gold-deep">
            {' '}*
          </span>
        ) : null}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={FIELD_CLASS}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className={ERROR_TEXT_CLASS}>
          {error}
        </p>
      ) : null}
    </div>
  );
}