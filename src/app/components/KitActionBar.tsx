'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, PrinterIcon } from '@/app/components/icons';
import { buildPulpitKitMarkdown } from '@/lib/pulpitKitMarkdown';
import type { PulpitKit } from '@/lib/types';

interface KitActionBarProps {
  kit: PulpitKit;
}

type CopyStatus = 'idle' | 'copied' | 'error';

export default function KitActionBar({ kit }: KitActionBarProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    const markdown = buildPulpitKitMarkdown(kit);

    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        setCopyStatus('error');
        return;
      }
      await navigator.clipboard.writeText(markdown);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    } finally {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopyStatus('idle'), 2400);
    }
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  const copyLabel =
    copyStatus === 'copied'
      ? 'Copied!'
      : copyStatus === 'error'
        ? 'Copy unavailable'
        : 'Copy Markdown Kit';

  return (
    <>
      <div className="no-print mt-4 flex flex-col gap-2 print:hidden sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800"
        >
          {copyStatus === 'copied' ? (
            <CheckIcon className="h-4 w-4" />
          ) : (
            <CopyIcon className="h-4 w-4" />
          )}
          {copyLabel}
        </button>

        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          <PrinterIcon className="h-4 w-4" />
          Print / Export View
        </button>

        <p className="text-xs leading-5 text-slate-500 sm:ml-auto">
          Copies the full kit as Markdown for Obsidian, Notion, or Google Docs.
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {copyStatus === 'copied'
          ? 'Pulpit kit copied to the clipboard as Markdown.'
          : copyStatus === 'error'
            ? 'Clipboard access is unavailable in this browser.'
            : ''}
      </p>
    </>
  );
}