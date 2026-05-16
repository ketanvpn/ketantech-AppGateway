"use client";

import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

/**
 * Simple code block dengan tombol copy. Tanpa syntax highlight (zero deps),
 * cuma styled <pre> dengan font monospace. Cukup buat dokumentasi internal.
 */
export function CodeBlock({ code, language, filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select & manual copy
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-3 py-1.5 text-xs">
        <span className="font-mono text-slate-300">
          {filename ?? language ?? "shell"}
        </span>
        <button
          onClick={copyToClipboard}
          className="rounded bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-100 hover:bg-slate-600"
        >
          {copied ? "✓ Tersalin" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}
