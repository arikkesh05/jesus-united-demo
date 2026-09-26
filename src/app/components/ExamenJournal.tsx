"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import {
  DROP_IN_TOPICS,
  buildDropInPrayerRequest,
  sanitizeDropInDraft,
} from "@/lib/intercessionPulse";
import {
  EXAMEN_ANSWER_MAX,
  EXAMEN_STEPS,
  EXAMEN_STEP_IDS,
  JOURNAL_BURDEN_MAX,
  draftIsStale,
  emptyExamenAnswers,
  examenProgress,
  examenStepById,
  journalEntrySummary,
  nextExamenStepId,
  previousExamenStepId,
  sealExamen,
  shareableBurden,
  type ExamenProgress,
  type ExamenStep,
  type ExamenStepId,
  type JournalDraft,
  type JournalEntry,
  type RhythmStreak,
} from "@/lib/altarRhythms";
import {
  appendJournalEntry,
  clearAltarJournal,
  clearJournalDraft,
  journalEntries,
  journalStreak,
  loadJournalDraft,
  markJournalEntryShared,
  saveJournalDraft,
  sealedExamenFor,
  staleJournalDrafts,
} from "@/lib/altarJournal";
import { submitPrayerRequest } from "@/lib/prayers";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  FlameIcon,
  HandHeartIcon,
  LockIcon,
  MoonIcon,
} from "@/app/components/icons";

/**
 * The interactive Examen (Altar OS v2).
 *
 * The old evening panel was a textarea and a "mark complete" button: one flat
 * field, no memory, and a checkbox standing in for a day of prayer. This is the
 * five-step Ignatian examen made real — one step at a time, a draft that
 * autosaves to the device, a rhythm count that is a mercy rather than a threat,
 * and one deliberate door out to the public wall.
 *
 * Two rules run through every decision here:
 *
 *  1. **The journal is private.** Storage is `localStorage` only
 *      (`src/lib/altarJournal.ts`); nothing in this component writes the Examen
 *      to Supabase, and the only text that can ever reach the community is the
 *      single *burden* line, sent deliberately through the same sanitiser and
 *      privacy screen as the drop-in dialog.
 *  2. **Nothing gates the writing.** The liturgical hour is explained, never
 *      enforced; a step can be skipped; an unfinished exam can be resumed after
 *      a reload or on the next day. The rhythm is the goal, the streak is not.
 */

type SaveState = "idle" | "saving" | "saved" | "blocked";
type ShareState = "idle" | "sharing" | "shared";

/** The Examen is the evening rhythm; the store is keyed by phase. */
const PHASE = "evening" as const;

/** How many sealed altars the history list keeps visible. */
const HISTORY_LIMIT = 3;

/** The answer field's id — also how step changes move the keyboard. */
const EXAMEN_FIELD_ID = "altar-examen-answer";

export interface ExamenJournalProps {
  /**
   * The dawn-rolled altar day (`altarDayKey`). Empty until the parent has
   * mounted, because a server-rendered clock would hydrate into a mismatch —
   * the component renders a quiet skeleton until the key arrives.
   */
  dateKey: string;
  /** Grace-Season test from the habit engine; injected so the streak agrees. */
  isResting?: (dateKey: string) => boolean;
  /** Fired on seal so the Altar OS can mirror the day to its own state. */
  onSealed?: (entry: JournalEntry) => void;
}

export default function ExamenJournal({
  dateKey,
  isResting,
  onSealed,
}: ExamenJournalProps) {
  const [stepId, setStepId] = useState<ExamenStepId>(EXAMEN_STEP_IDS[0]);
  const [answers, setAnswers] = useState(emptyExamenAnswers);
  const [burden, setBurden] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [sealed, setSealed] = useState<JournalEntry | null>(null);
  const [history, setHistory] = useState<JournalEntry[]>([]);
  const [streak, setStreak] = useState<RhythmStreak | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [staleDraft, setStaleDraft] = useState<JournalDraft | null>(null);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareTopic, setShareTopic] = useState<string>(DROP_IN_TOPICS[4]);
  const [shareNotice, setShareNotice] = useState("");
  const [shareError, setShareError] = useState("");

  /**
   * The parent's resting-day test is read through a ref: it is usually a fresh
   * arrow on every render, and the streak must not recompute (let alone
   * re-render) when only that identity changes.
   */
  const isRestingRef = useRef(isResting);
  useEffect(() => {
    isRestingRef.current = isResting;
  }, [isResting]);

  const restingTest = useCallback(
    (key: string) => isRestingRef.current?.(key) === true,
    [],
  );

  /** Re-reads the sealed history and the rhythm count from the device. */
  const refresh = useCallback(
    (todayKey: string) => {
      setHistory(journalEntries().slice(0, HISTORY_LIMIT));
      setStreak(journalStreak(todayKey, restingTest));
    },
    [restingTest],
  );

  // Hydration: the sealed altar for the day wins; otherwise an unfinished draft
  // is restored exactly where the cursor left it. The read lands in a microtask
  // (the same shape as the wall's async beacon fetch) so this component never
  // re-renders the visitor's own typing twice in one pass.
  useEffect(() => {
    if (dateKey === "") return undefined;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const existing = sealedExamenFor(dateKey, PHASE);
      setSealed(existing);
      setAnswers(emptyExamenAnswers());
      setBurden("");
      setRecovered(false);
      setSaveState("idle");
      setShareState(existing?.sharedToWall === true ? "shared" : "idle");
      setShareNotice("");
      setShareError("");

      if (existing === null) {
        const draft = loadJournalDraft(dateKey, PHASE);
        if (draft !== null) {
          setAnswers(draft.answers);
          setBurden(draft.burden);
          setStepId(draft.stepId);
          setRecovered(true);
        }
      }
      setStaleDraft(
        staleJournalDrafts(dateKey).find(
          (draft) => draft.dateKey !== dateKey,
        ) ?? null,
      );
      refresh(dateKey);
    });
    return () => {
      active = false;
    };
  }, [dateKey, refresh]);

  /**
   * Autosave. Debounced so a keystroke does not hit storage, and it writes only
   * once something true has been written — an empty altar is not a draft. A
   * refused write (private mode, full quota) is reported honestly in the status
   * line instead of pretending the day is safe.
   */
  useEffect(() => {
    if (dateKey === "" || sealed !== null) return undefined;
    if (!examenProgress(answers, burden).canSeal) return undefined;

    const timer = setTimeout(() => {
      const stored = saveJournalDraft({
        dateKey,
        phase: PHASE,
        stepId,
        answers,
        burden,
      });
      setSaveState(stored === null ? "blocked" : "saved");
    }, 700);
    return () => clearTimeout(timer);
  }, [answers, burden, stepId, dateKey, sealed]);

  const progress = examenProgress(answers, burden);
  const stepIndex = EXAMEN_STEP_IDS.indexOf(stepId);
  const step = examenStepById(stepId);
  const canSeal = progress.canSeal && sealed === null;

  /**
   * Typing is what starts a save, so the status line moves on the keystroke
   * (an event, not a render side-effect) and the debounce below only decides
   * whether the draft actually reached the device.
   */
  const handleAnswer = (value: string) => {
    const next = { ...answers, [stepId]: value };
    setAnswers(next);
    setSaveState(examenProgress(next, burden).canSeal ? "saving" : "idle");
  };

  const handleBurden = (value: string) => {
    setBurden(value);
    setSaveState(
      examenProgress(answers, value).canSeal ? "saving" : "idle",
    );
  };

  /**
   * Moving steps keeps the keyboard where the writing is. The field is reached
   * by its id (the same pattern the drop-in dialog uses) so no ref has to
   * travel through the panel's props.
   */
  const goToStep = (next: ExamenStepId | null) => {
    if (next === null) return;
    setStepId(next);
    if (typeof document === "undefined") return;
    const field = document.getElementById(EXAMEN_FIELD_ID);
    if (field instanceof HTMLTextAreaElement) field.focus();
  };

  const handleSeal = () => {
    if (dateKey === "" || !canSeal) return;
    const entry = sealExamen({
      dateKey,
      phase: PHASE,
      answers,
      burden,
    });
    if (entry === null) return;

    appendJournalEntry(entry);
    setSealed(entry);
    setAnswers(emptyExamenAnswers());
    setBurden("");
    setStepId(EXAMEN_STEP_IDS[0]);
    setRecovered(false);
    setSaveState("idle");
    setShareState(entry.sharedToWall ? "shared" : "idle");
    setShareNotice("");
    setShareError("");
    refresh(dateKey);
    onSealed?.(entry);
  };

  /**
   * The one door out of the private journal. The burden goes through
   * `sanitizeDropInDraft` — the wall's own privacy screen — so a phone number
   * or a link in a private line is caught before it can be published, exactly
   * as it would be in the drop-in dialog.
   */
  const handleShare = async () => {
    if (sealed === null || shareState === "sharing") return;
    const body = shareableBurden(sealed);
    if (body === "") {
      setShareError("That line is too short to pray on. Write the burden first.");
      return;
    }

    const validation = sanitizeDropInDraft({
      body,
      authorName: "",
      anonymous: true,
      topics: [shareTopic],
    });
    if (!validation.ok) {
      setShareError(
        validation.errors.body ??
          validation.errors.topics ??
          "This line cannot be shared as it stands.",
      );
      return;
    }

    setShareState("sharing");
    setShareError("");
    setShareNotice("");
    const result = await submitPrayerRequest({
      user_id: "",
      ...buildDropInPrayerRequest(validation.values),
    });

    if (result.ok) {
      markJournalEntryShared(dateKey, PHASE, true);
      setShareState("shared");
      setShareNotice(
        result.mode === "guest"
          ? "Carried onto the wall from this device — the community can pray with you now."
          : "Carried onto the prayer wall. Believers can pray with you now.",
      );
    } else {
      setShareState("idle");
      setShareError(
        result.error ?? "The prayer service is unavailable. Please try again.",
      );
    }
  };

  /** Opens the examen again; re-sealing replaces the day, by design. */
  const handleRewrite = () => {
    setSealed(null);
    setAnswers(emptyExamenAnswers());
    setBurden("");
    setStepId(EXAMEN_STEP_IDS[0]);
    setShareState("idle");
    setShareNotice("");
    setShareError("");
  };

  /** Restores an earlier day's unfinished draft — offered, never assumed. */
  const handleRestoreDraft = (draft: JournalDraft) => {
    setAnswers(draft.answers);
    setBurden(draft.burden);
    setStepId(draft.stepId);
    setRecovered(true);
    setStaleDraft(null);
  };

  const handleDismissDraft = (draft: JournalDraft) => {
    clearJournalDraft(draft.dateKey, draft.phase);
    setStaleDraft(null);
  };

  /** The right to be forgotten: one call, and the device keeps nothing. */
  const handleErase = () => {
    clearAltarJournal();
    setSealed(null);
    setAnswers(emptyExamenAnswers());
    setBurden("");
    setStepId(EXAMEN_STEP_IDS[0]);
    setStaleDraft(null);
    setRecovered(false);
    setShareState("idle");
    setShareNotice("");
    setShareError("");
    refresh(dateKey);
  };

  const saveNotice =
    saveState === "saving"
      ? "Saving on this device…"
      : saveState === "saved"
        ? "Draft saved on this device — a reload cannot lose it."
        : saveState === "blocked"
          ? "This browser will not store a draft, so nothing autosaves here. What you have written is still on this page."
          : progress.canSeal
            ? "Your draft saves automatically on this device."
            : "Nothing written yet — the autosave begins with your first line.";

  // No altar day yet means the clock has not been read: a server render must
  // never guess today's date, so the panel waits rather than hydrate wrongly.
  if (dateKey === "") {
    return (
      <div
        className={`${cardClass} p-4 text-sm text-muted`}
        role="status"
        aria-live="polite"
      >
        Opening your private journal…
      </div>
    );
  }

  return (
    <ExamenJournalPanel
      dateKey={dateKey}
      step={step}
      stepId={stepId}
      stepIndex={stepIndex}
      answers={answers}
      burden={burden}
      progress={progress}
      saveNotice={saveNotice}
      recovered={recovered}
      staleDraft={staleDraft}
      stale={staleDraft !== null && draftIsStale(staleDraft, dateKey)}
      sealed={sealed}
      history={history}
      streak={streak}
      shareTopic={shareTopic}
      shareState={shareState}
      shareNotice={shareNotice}
      shareError={shareError}
      canSeal={canSeal}
      onAnswer={handleAnswer}
      onBurden={handleBurden}
      onStep={goToStep}
      onBack={() => goToStep(previousExamenStepId(stepId))}
      onNext={() => goToStep(nextExamenStepId(stepId))}
      onSeal={handleSeal}
      onShare={handleShare}
      onTopic={setShareTopic}
      onRestoreDraft={handleRestoreDraft}
      onDismissDraft={handleDismissDraft}
      onRewrite={handleRewrite}
      onErase={handleErase}
    />
  );
}

// ---------------------------------------------------------------------------
// Presentation — Midnight Gethsemane tokens, 44px targets, no new palette
// ---------------------------------------------------------------------------

const eyebrowClass =
  "text-xs font-bold uppercase tracking-[0.18em] text-pill-ink";
const cardClass = "rounded-2xl border border-sand bg-pill shadow-soft";
const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-bold text-canvas transition hover:bg-gold-deep hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-sand bg-pill px-5 py-3 text-sm font-bold text-espresso transition hover:border-gold disabled:opacity-50";
const quietButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-muted transition hover:text-gold-deep";
const fieldClass =
  "w-full rounded-2xl border border-sand bg-canvas/60 px-4 py-3 text-sm leading-6 text-espresso outline-none transition placeholder:text-muted/80 focus:border-gold focus:ring-2 focus:ring-gold/25";

interface ExamenJournalPanelProps {
  dateKey: string;
  step: ExamenStep;
  stepId: ExamenStepId;
  /** Zero-based position in the five-step rail. */
  stepIndex: number;
  answers: Record<ExamenStepId, string>;
  burden: string;
  progress: ExamenProgress;
  saveNotice: string;
  /** True when an unfinished draft was picked back up on mount. */
  recovered: boolean;
  staleDraft: JournalDraft | null;
  /** The offered draft belongs to an earlier altar day. */
  stale: boolean;
  sealed: JournalEntry | null;
  history: JournalEntry[];
  streak: RhythmStreak | null;
  shareTopic: string;
  shareState: ShareState;
  shareNotice: string;
  shareError: string;
  canSeal: boolean;
  onAnswer: (value: string) => void;
  onBurden: (value: string) => void;
  onStep: (id: ExamenStepId) => void;
  onBack: () => void;
  onNext: () => void;
  onSeal: () => void;
  onShare: () => void;
  onTopic: (topic: string) => void;
  onRestoreDraft: (draft: JournalDraft) => void;
  onDismissDraft: (draft: JournalDraft) => void;
  onRewrite: () => void;
  onErase: () => void;
}
/**
 * The panel: privacy badge, rhythm count, recovery notices, then either the
 * stepper or the sealed reading. Every live region here is a single line and
 * announced politely — five textareas appearing on step change would drown a
 * screen reader if each one announced itself.
 */
function ExamenJournalPanel(props: ExamenJournalPanelProps) {
  const { streak, sealed, staleDraft } = props;

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-sand ${cardClass} px-3 py-1 text-xs font-bold text-pill-ink`}
        >
          <LockIcon className="h-3.5 w-3.5" />
          Private journal — stays on this device
        </span>
        {streak !== null ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-gold-deep">
            {streak.restingToday ? (
              <MoonIcon className="h-3.5 w-3.5" />
            ) : (
              <FlameIcon className="h-3.5 w-3.5" />
            )}
            {streak.days} {streak.days === 1 ? "day" : "days"} of rhythm
          </span>
        ) : null}
      </div>
      {streak !== null ? (
        <p className="mt-2 text-xs text-muted">{streak.label}</p>
      ) : null}

      {props.recovered ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 rounded-2xl border border-gold/25 bg-gold/10 px-4 py-3 text-xs font-medium text-pill-ink"
        >
          Your unfinished examen was restored — you left off at{" "}
          <span className="font-bold">{props.step.label}</span>. Nothing was
          lost, and the draft kept saving while you were away.
        </p>
      ) : null}

      {staleDraft !== null ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand bg-pill px-4 py-3">
          <p className="text-xs text-muted">
            {props.stale ? "An earlier day" : "Another rhythm"} left an
            unfinished draft ({staleDraft.dateKey}). Bring it back in, or
            let it go — either is fine.
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => props.onRestoreDraft(staleDraft)}
              className={quietButton}
            >
              Restore it
            </button>
            <button
              type="button"
              onClick={() => props.onDismissDraft(staleDraft)}
              className={quietButton}
            >
              <CloseIcon className="h-3.5 w-3.5" />
              Let it go
            </button>
          </div>
        </div>
      ) : null}

      {sealed === null ? (
        <ExamenStepper {...props} />
      ) : (
        <ExamenSealed {...props} />
      )}

      <ExamenHistory entries={props.history} onErase={props.onErase} />
    </div>
  );
}
/** The five-step writing surface: rail, one prompt, one field, the burden. */
function ExamenStepper(props: ExamenJournalPanelProps) {
  const answer = props.answers[props.stepId] ?? "";

  return (
    <MotionConfig reducedMotion="user">
      <div className="mt-4">
        {/* Step rail — buttons, not links: the rail is a position, not a page. */}
        <ol
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Examen steps"
        >
          {EXAMEN_STEPS.map((item, index) => {
            const isCurrent = item.id === props.stepId;
            const isAnswered = (props.answers[item.id] ?? "").trim() !== "";
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => props.onStep(item.id)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-bold transition ${
                    isCurrent
                      ? "border-gold bg-gold text-canvas"
                      : "border-sand bg-pill text-muted hover:border-gold hover:text-pill-ink"
                  }`}
                >
                  <span className="tabular-nums">{index + 1}</span>
                  <span>{item.label}</span>
                  {isAnswered ? (
                    <CheckIcon className="h-3.5 w-3.5" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>

        <motion.div
          key={props.stepId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className={`${cardClass} mt-3 p-5`}
        >
          <p className={eyebrowClass}>
            Step {props.stepIndex + 1} of {EXAMEN_STEPS.length} ·{" "}
            {props.step.label}
          </p>
          <p
            id="altar-examen-prompt"
            className="mt-2 text-base font-bold leading-7 text-espresso"
          >
            {props.step.prompt}
          </p>
          <p className="mt-1 text-xs text-muted">{props.step.hint}</p>
          <label htmlFor="altar-examen-answer" className="sr-only">
            {props.step.label} — your answer
          </label>
          <textarea
            id={EXAMEN_FIELD_ID}
            value={answer}
            maxLength={EXAMEN_ANSWER_MAX}
            rows={5}
            onChange={(event) => props.onAnswer(event.target.value)}
            aria-describedby="altar-examen-prompt"
            className={`mt-3 ${fieldClass}`}
          />
          <p className="mt-1 text-right text-[11px] tabular-nums text-muted">
            {answer.length} / {EXAMEN_ANSWER_MAX}
          </p>
        </motion.div>

        {/* The burden — private until the visitor carries it to the wall. */}
        <div className={`${cardClass} mt-3 p-5`}>
          <p className={eyebrowClass}>Carry one burden</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            One line: what you are handing over tonight. It stays in this
            journal unless you choose to carry it to the prayer wall below.
          </p>
          <label htmlFor="altar-examen-burden" className="sr-only">
            The one burden you are handing over tonight
          </label>
          <textarea
            id="altar-examen-burden"
            value={props.burden}
            maxLength={JOURNAL_BURDEN_MAX}
            rows={2}
            onChange={(event) => props.onBurden(event.target.value)}
            className={`mt-3 ${fieldClass}`}
          />
        </div>

        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-xs text-muted"
        >
          {props.progress.label} {props.saveNotice}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={props.onBack}
            disabled={props.stepIndex === 0}
            className={secondaryButton}
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={props.onNext}
            disabled={props.stepIndex === EXAMEN_STEPS.length - 1}
            className={secondaryButton}
          >
            Next step
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={props.onSeal}
            disabled={!props.canSeal}
            className={`${primaryButton} ml-auto`}
          >
            <CheckIcon className="h-4 w-4" />
            Seal the examen
          </button>
        </div>
        <p className="mt-2 text-right text-[11px] text-muted">
          You can seal from any step — the rest of tonight is optional.
        </p>
      </div>
    </MotionConfig>
  );
}
/** The sealed reading — what was kept, and the one door out of privacy. */
function ExamenSealed(props: ExamenJournalPanelProps) {
  const entry = props.sealed;
  if (entry === null) return null;
  const answered = EXAMEN_STEPS.filter(
    (item) => (entry.answers[item.id] ?? "").trim() !== "",
  );
  const shared = props.shareState === "shared";
  const busy = props.shareState === "sharing";

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: "easeOut" }}
        className={`mt-4 rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/10 to-transparent p-5`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={eyebrowClass}>
            Sealed · {formatEntryDate(entry.dateKey)}
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-gold-deep">
            <CheckIcon className="h-3.5 w-3.5" />
            Amen
          </span>
        </div>

        <dl className="mt-3 space-y-3">
          {answered.map((item) => (
            <div key={item.id}>
              <dt className={`${eyebrowClass} text-[11px]`}>{item.label}</dt>
              <dd className="mt-1 whitespace-pre-line text-sm leading-6 text-espresso">
                {entry.answers[item.id]}
              </dd>
            </div>
          ))}
          {entry.burden.trim() !== "" ? (
            <div>
              <dt className={`${eyebrowClass} text-[11px]`}>Burden</dt>
              <dd className="mt-1 whitespace-pre-line text-sm leading-6 text-espresso">
                {entry.burden}
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="mt-4 flex items-start gap-2 text-xs text-muted">
          <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Kept on this device only. The journal is never uploaded — the one way
          anything here reaches the community is the burden below, and only if
          you send it yourself.
        </p>
      </motion.div>

      {/* The share — opt-in, screened, and honest about guest mirroring. */}
      <div className={`${cardClass} mt-3 p-5`}>
        <p className={eyebrowClass}>Carry the burden to the wall</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Believers can pray with you. The wall is public, so the privacy screen
          checks your line for contact details before anything is sent — and
          nothing is sent until you press the button.
        </p>
        {entry.burden.trim() !== "" ? (
          <>
            <p className="mt-3 rounded-xl border border-sand bg-canvas/60 px-3 py-2 text-xs text-muted">
              {entry.burden}
            </p>
            <div
              className="mt-3 flex flex-wrap gap-1.5"
              role="group"
              aria-label="Topic for the shared burden"
            >
              {DROP_IN_TOPICS.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => props.onTopic(topic)}
                  aria-pressed={props.shareTopic === topic}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 py-2 text-xs font-bold transition ${
                    props.shareTopic === topic
                      ? "border-gold bg-gold text-canvas"
                      : "border-sand bg-pill text-muted hover:border-gold hover:text-pill-ink"
                  }`}
                >
                  {topic}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={props.onShare}
              disabled={busy || shared}
              className={`${primaryButton} mt-4`}
            >
              <HandHeartIcon className="h-4 w-4" />
              {shared
                ? "Carried to the wall"
                : busy
                  ? "Carrying…"
                  : "Carry this burden to the prayer wall"}
            </button>
          </>
        ) : (
          <p className="mt-3 text-xs text-muted">
            You did not write a burden tonight, so there is nothing to carry.
            That is a complete examen.
          </p>
        )}

        {props.shareNotice !== "" ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 text-xs font-semibold text-gold-deep"
          >
            {props.shareNotice}
          </p>
        ) : null}
        {props.shareError !== "" ? (
          <p role="alert" className="mt-3 text-xs font-semibold text-pill-ink">
            {props.shareError}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={props.onRewrite}
        className={`${secondaryButton} mt-4 w-full`}
      >
        Write the examen again
      </button>
    </MotionConfig>
  );
}

/** `2026-09-26` → `"Sat 26 Sep"`. Client-only (history renders post-mount). */
function formatEntryDate(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * The last few sealed altars, and the right to be forgotten. The erase is
 * two-step on purpose: one stray tap should not delete a season of prayer, and
 * the journal has no cloud copy, so this button is the whole erasure.
 */
function ExamenHistory({
  entries,
  onErase,
}: {
  entries: JournalEntry[];
  onErase: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return undefined;
    const timer = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <div className="mt-5">
      {entries.length > 0 ? (
        <>
          <p className={eyebrowClass}>Recent altars</p>
          <ul className="mt-2 space-y-1.5">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className={`${cardClass} flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs`}
              >
                <span className="font-bold text-espresso">
                  {formatEntryDate(entry.dateKey)}
                </span>
                <span className="text-muted">{journalEntrySummary(entry)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
        {confirming ? (
          <>
            <span className="text-xs text-muted">
              Erase every entry and draft on this device?
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onErase();
              }}
              className={quietButton}
            >
              Yes, erase it
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={quietButton}
            >
              <CloseIcon className="h-3.5 w-3.5" />
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={quietButton}
          >
            Erase this journal from this device
          </button>
        )}
      </div>
    </div>
  );
}
