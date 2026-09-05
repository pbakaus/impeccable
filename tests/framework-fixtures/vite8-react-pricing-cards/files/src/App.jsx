const TIERS = [
  { id: 'starter', name: 'Starter', price: '$19/mo', blurb: 'For a single project and one seat.' },
  { id: 'studio', name: 'Studio', price: '$49/mo', blurb: 'For small teams shipping every week.' },
  { id: 'atelier', name: 'Atelier', price: '$120/mo', blurb: 'For agencies running many brands.' },
];

export default function App() {
  return (
    <main className="page">
      <section className="hero">
        <h1 className="hero-heading">A tall hero keeps the pricing far below the fold.</h1>
        <p className="hero-hook">
          The agent-target scenario must scroll the pricing section into view on its own.
        </p>
      </section>
      <section className="pricing" id="pricing">
        <h2 className="pricing-title">Simple pricing</h2>
        <div className="pricing-grid">
          {TIERS.map((tier) => (
            <article key={tier.id} className="pricing-card">
              <h3>{tier.name}</h3>
              <p className="tier-price">{tier.price}</p>
              <p>{tier.blurb}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
