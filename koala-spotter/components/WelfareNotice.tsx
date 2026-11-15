"use client";

import Link from "next/link";

export const WELFARE_RULES = [
  "Stay well back. If the koala looks at you or moves, you're too close.",
  "No flash, and no torches at night.",
  "Never touch, feed or call to a koala.",
  "Keep quiet and keep dogs away.",
  "Stay on the track. Don't push through bush to get closer.",
];

/** Shown once, the first time someone opens the app. */
export default function WelfareNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="welfare-title">
      <div className="sheet-in w-full max-w-md rounded-t-2xl bg-paper p-5 sm:rounded-2xl">
        <h2 id="welfare-title" className="text-2xl font-extrabold">
          Koalas come first
        </h2>
        <p className="mt-1 text-base">These are wild animals and they sleep most of the day. Please:</p>
        <ul className="mt-3 space-y-2">
          {WELFARE_RULES.map((rule) => (
            <li key={rule} className="flex gap-2 text-base leading-snug">
              <span aria-hidden className="font-bold text-brand">
                •
              </span>
              {rule}
            </li>
          ))}
        </ul>
        <button onClick={onDismiss} className="mt-5 h-14 w-full rounded-xl bg-brand text-lg font-bold text-white">
          Got it
        </button>
        <Link href="/injured" className="mt-3 flex h-12 items-center justify-center text-base font-semibold underline">
          Found a sick or injured koala?
        </Link>
      </div>
    </div>
  );
}
