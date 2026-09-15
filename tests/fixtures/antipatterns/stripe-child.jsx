// Dedicated stripe-child side-tab fixture (Tailwind / JSX text path)

export function StripeChildCard() {
  return (
    <div className="flex rounded-lg border">
      <div className="w-1 shrink-0 rounded-l-lg bg-amber-500" />
      <div className="p-4">Card content</div>
    </div>
  );
}

export function StripeChildBracketWidth() {
  return <div className="w-[4px] bg-blue-500 shrink-0" />;
}

export function StripeChildHalf() {
  return <span className="w-0.5 bg-rose-500 shrink-0" />;
}

export function StripeChildMinHeightOk() {
  return <div className="w-1 min-h-0 bg-amber-500 shrink-0" />;
}

// PASS: dot indicator, not a stripe
export function DotIndicator() {
  return <div className="w-2 h-2 rounded-full bg-green-500" />;
}

// PASS: small square with sibling text (gray-on-color sibling line)
export function VitalFewLegend() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-3 h-3 rounded bg-amber-500" />
      <span className="text-slate-400">Vital few</span>
    </div>
  );
}

// PASS: chart bar with explicit height
export function ChartBar() {
  return <div className="w-3 h-24 bg-blue-500" />;
}

// PASS: opacity tint
export function TintStripe() {
  return <div className="w-1 bg-amber-500/10 shrink-0" />;
}

// PASS: aria-current on stripe tag
export function CurrentNavStripe() {
  return <a className="w-1 bg-amber-500" aria-current="page" />;
}

// PASS: width and chromatic bg on sibling tags
export function SplitSiblingClasses() {
  return (
    <div className="w-1 shrink-0">
      <span className="bg-amber-500" />
    </div>
  );
}
