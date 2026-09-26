"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  UsersIcon,
} from "@/app/components/icons";
type CopyStatus = "idle" | "copied" | "error";

const FACILITATOR_TIPS = [
  "Open by reading the key quote aloud, then let silence do the heavy lifting for ten seconds.",
  "Aim for eight to twelve minutes per question — depth beats coverage in community groups.",
  "Invite quieter members in by name before moving on; redirect cross-talk gently back to the text.",
  "Close by praying the application challenge back to God as a shared group commitment.",
];
import type { PulpitKit } from "@/lib/types";

interface KitStudyPanelProps {
  kit: PulpitKit;
}

export default function KitStudyPanel({ kit }: KitStudyPanelProps) {
  const [discussed, setDiscussed] = useState<Set<number>>(() => new Set());
  const [tipsOpen, setTipsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const toggleDiscussed = (index: number) => {
    setDiscussed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleCopy = async () => {
    const lines = [
      "Community Group Study Questions",
      "",
      ...kit.discussion_questions.map(
        (question, index) => `${index + 1}. ${question}`,
      ),
    ];
    if (kit.key_quote)
      lines.push("", `Key Quote: \u201c${kit.key_quote}\u201d`);
    if (kit.call_to_action)
      lines.push("", `Application Challenge: ${kit.call_to_action}`);

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        setCopyStatus("error");
        return;
      }
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    } finally {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopyStatus("idle"), 2400);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
          <BookIcon className="h-4 w-4" />
          Reflection and Accountability Questions
        </h4>
        {kit.discussion_questions.length > 0 ? (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-3 py-1.5 text-xs font-bold text-espresso transition-all duration-200 hover:border-gold/50 hover:bg-pill hover:shadow-sm active:scale-[0.98]"
          >
            {copyStatus === "copied" ? (
              <CheckIcon className="h-3.5 w-3.5 text-gold" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5" />
            )}
            {copyStatus === "copied" ? "Copied!" : "Copy Study Questions"}
          </button>
        ) : null}
      </div>

      {kit.discussion_questions.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-sand bg-pill/50 p-4 text-sm text-muted">
          Discussion questions are not available for this kit yet.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs font-medium text-muted" aria-live="polite">
            {discussed.size} of {kit.discussion_questions.length} questions
            marked as discussed
          </p>
          <ol className="mt-3 space-y-3">
            {kit.discussion_questions.map((question, index) => {
              const isChecked = discussed.has(index);
              return (
                <li key={question}>
                  <button
                    type="button"
                    onClick={() => toggleDiscussed(index)}
                    aria-pressed={isChecked}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
                      isChecked
                        ? "border-gold/50 bg-gold/10 shadow-sm"
                        : "border-sand bg-canvas hover:border-gold/40 hover:bg-pill"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200 ${
                        isChecked
                          ? "border-gold bg-gold text-canvas"
                          : "border-sand bg-pill text-transparent"
                      }`}
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm font-bold text-pill-ink">
                      {index + 1}.
                    </span>
                    <span
                      className={`flex-1 text-sm leading-6 transition-colors duration-200 ${
                        isChecked
                          ? "text-muted line-through decoration-gold/50"
                          : "text-espresso/80"
                      }`}
                    >
                      {question}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors duration-200 ${
                        isChecked
                          ? "bg-gold/20 text-pill-ink"
                          : "bg-pill text-muted"
                      }`}
                    >
                      {isChecked ? "Discussed" : "Mark discussed"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="mt-4 rounded-2xl border border-sand/70 bg-pill/60 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setTipsOpen((prev) => !prev)}
          aria-expanded={tipsOpen}
          aria-controls="facilitator-tips"
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
            <UsersIcon className="h-4 w-4" />
            Facilitator Coaching Tips
          </span>
          <span
            aria-hidden="true"
            className={`text-muted transition-transform duration-300 ${tipsOpen ? "rotate-180" : ""}`}
          >
            <ChevronDownIcon className="h-4 w-4" />
          </span>
        </button>
        <AnimatePresence initial={false}>
          {tipsOpen && (
            <motion.div
              id="facilitator-tips"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="overflow-hidden"
            >
              <ul className="space-y-2 border-t border-sand/60 p-4">
                {FACILITATOR_TIPS.map((tip) => (
                  <li
                    key={tip}
                    className="flex items-start gap-2 text-xs leading-5 text-muted"
                  >
                    <span aria-hidden="true" className="mt-0.5 text-gold">
                      •
                    </span>
                    {tip}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {kit.key_quote ? (
        <blockquote className="mt-4 rounded-r-2xl border-l-4 border-gold bg-pill p-4 text-sm italic leading-6 text-espresso/90">
          &ldquo;{kit.key_quote}&rdquo;
        </blockquote>
      ) : null}

      {kit.call_to_action ? (
        <div className="mt-4 rounded-2xl border border-sand bg-pill p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
            Application Challenge
          </p>
          <p className="mt-1.5 text-sm leading-6 text-espresso/80">
            {kit.call_to_action}
          </p>
        </div>
      ) : null}
    </>
  );
}
