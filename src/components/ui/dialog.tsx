"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  /** Optional id of the element that names the dialog (wire to the title). */
  ariaLabelledBy?: string;
  /** Optional id of the element that describes the dialog. */
  ariaDescribedBy?: string;
}

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  ariaLabelledBy,
  ariaDescribedBy,
}: DialogProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-canvas/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-hidden="true"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", duration: 0.25, bounce: 0.1 }}
            className={cn(
              "relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-sand",
              "bg-canvas p-6 shadow-xl text-espresso",
              className
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close dialog"
      className={cn(
        "absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg",
        "text-muted hover:bg-pill hover:text-espresso focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-gold transition-colors"
      )}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
