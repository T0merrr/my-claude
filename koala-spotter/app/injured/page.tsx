import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sick or injured koala · Maggie Koala Spotter" };

// Supplied by the site owner, November 2026. Re-check these now and then.
const CONTACTS = [
  {
    name: "Magnetic Island Koala Hospital",
    phone: "0428 785 488",
    note: "Koala rescue and care, based in Horseshoe Bay.",
  },
  {
    name: "MI Wildlife Rescue Inc",
    phone: "0457 634 732",
    note: "Rescue for all native wildlife on the island.",
  },
];

export default function InjuredPage() {
  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <Link href="/" className="inline-flex h-12 items-center text-base font-bold text-brand underline">
        ← Back to the map
      </Link>
      <h1 className="mt-2 text-3xl font-extrabold leading-tight">Found a sick or injured koala?</h1>

      <h2 className="mt-6 text-xl font-extrabold">Call for help</h2>
      <ul className="mt-2 space-y-3">
        {CONTACTS.map((c) => (
          <li key={c.name} className="rounded-xl border-2 border-ink p-3">
            <p className="text-lg font-bold">{c.name}</p>
            <a
              href={`tel:${c.phone.replace(/\s/g, "")}`}
              className="mt-2 flex h-14 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white"
            >
              Call {c.phone}
            </a>
            <p className="mt-2 text-base">{c.note}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-xl font-extrabold">A koala may need help if it is</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-lg">
        <li>sitting on the ground and not moving away</li>
        <li>on or beside a road</li>
        <li>bleeding, limping or visibly hurt</li>
        <li>showing crusty or red eyes, or a wet, stained rump</li>
        <li>a joey on its own</li>
      </ul>

      <h2 className="mt-6 text-xl font-extrabold">While you wait</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-lg">
        <li>Don&apos;t touch it or pick it up. Koalas bite and scratch hard.</li>
        <li>Keep people and dogs well back and stay quiet.</li>
        <li>Note exactly where it is so rescuers can find it.</li>
        <li>Don&apos;t give it food or water.</li>
      </ul>
    </main>
  );
}
