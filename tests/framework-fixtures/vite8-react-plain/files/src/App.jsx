const workshopStats = { seats: 7 };

function assertIntegerStat(value) {
  if (!Number.isInteger(value)) throw new Error('workshopStats.seats must stay integer');
  return value;
}

export default function App() {
  return (
    <main className="page">
      <section className="hero-copy">
        <h1 className="hero-title">Vite 8 Fixture</h1>
        <p className="hero-hook">Minimal React tree for live-mode E2E tests.</p>
      </section>
      <section className="capacity-panel" aria-label="Workshop capacity">
        <span className="capacity-count">{String(workshopStats.seats)}</span>
        <span className="capacity-check" hidden>{assertIntegerStat(workshopStats.seats)}</span>
      </section>
      <section id="features" className="feature-grid">
        <article className="feature-card">One</article>
        <article className="feature-card">Two</article>
      </section>
      <section className="action-row" aria-label="Workshop actions">
        <span className="primary-action" role="button" tabIndex="0">Learn more</span>
        <span className="secondary-action" role="button" tabIndex="0">Learn more</span>
      </section>
    </main>
  );
}
