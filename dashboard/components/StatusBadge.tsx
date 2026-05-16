import { PaymentStatus } from "@/lib/types";

/**
 * Style per status — pakai pastel light bg + dot indicator untuk visual cue.
 * Pending dapat animasi pulse supaya jelas masih nunggu.
 */
const styles: Record<
  PaymentStatus,
  { bg: string; text: string; dot: string; label: string; pulse?: boolean }
> = {
  pending: {
    bg: "bg-amber-50 ring-1 ring-amber-200",
    text: "text-amber-700",
    dot: "bg-amber-500",
    label: "Pending",
    pulse: true,
  },
  success: {
    bg: "bg-emerald-50 ring-1 ring-emerald-200",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    label: "Success",
  },
  failed: {
    bg: "bg-red-50 ring-1 ring-red-200",
    text: "text-red-700",
    dot: "bg-red-500",
    label: "Failed",
  },
  expired: {
    bg: "bg-slate-100 ring-1 ring-slate-200",
    text: "text-slate-600",
    dot: "bg-slate-400",
    label: "Expired",
  },
  refunded: {
    bg: "bg-sky-50 ring-1 ring-sky-200",
    text: "text-sky-700",
    dot: "bg-sky-500",
    label: "Refunded",
  },
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {s.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${s.dot}`}
          />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${s.dot}`}
        />
      </span>
      {s.label}
    </span>
  );
}
