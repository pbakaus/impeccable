// Tailwind stripe-child constructions for the side-tab regex matcher
// (issue #394). Each case uses a distinct bg-* token so the test can map
// findings back to cases by snippet.
export function ShouldFlag() {
  return (
    <div>
      {/* Canonical: narrow width utility + chromatic bg, no explicit height */}
      <div className="flex rounded-lg border">
        <div className="w-1 shrink-0 rounded-l-lg bg-amber-500" />
        <div className="p-4">Deploy finished without warnings.</div>
      </div>
      <div className="flex">
        <div className="w-1.5 bg-indigo-600" />
        <div className="p-4">Queue paused by an operator.</div>
      </div>
      <div className="flex items-stretch">
        <span className="w-2 self-stretch bg-rose-500"></span>
        <p>Nightly backup completed.</p>
      </div>
      <div className="flex">
        <div className="w-[4px] bg-emerald-500" />
        <div className="p-4">Arbitrary-value width, same stripe.</div>
      </div>
    </div>
  );
}

export function ShouldPass() {
  return (
    <div>
      {/* Heading tick: explicit short height, does not span its host */}
      <div className="w-1 h-6 rounded-full bg-teal-600" />
      {/* Status dot */}
      <span className="w-2 h-2 rounded-full bg-lime-500" />
      {/* Neutral divider */}
      <div className="w-1 bg-gray-200" />
      {/* Not narrow */}
      <div className="w-10 bg-orange-500" />
      {/* Fractional width, not a pixel stripe */}
      <div className="w-1/2 bg-purple-500" />
      {/* Selection marker on the current item */}
      <div aria-current="page" className="w-1 bg-sky-500" />
      {/* Chart bar with arbitrary height */}
      <div className="w-1 h-[60%] bg-fuchsia-500" />
      {/* Width token inside a larger utility (max-w) */}
      <div className="max-w-1 bg-cyan-500" />
    </div>
  );
}
