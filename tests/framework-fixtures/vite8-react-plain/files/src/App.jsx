const workshopStats = { seats: 7 };
const foundationCards = [
  { label: 'Typography', detail: 'Readable hierarchy' },
  { label: 'Color & Contrast', detail: 'Accessible palettes' },
  { label: 'Interaction', detail: 'Responsive states' },
];
const largeManualItems = [
  { label: 'Bulk copy 01' },
  { label: 'Bulk copy 02' },
  { label: 'Bulk copy 03' },
  { label: 'Bulk copy 04' },
  { label: 'Bulk copy 05' },
  { label: 'Bulk copy 06' },
  { label: 'Bulk copy 07' },
  { label: 'Bulk copy 08' },
  { label: 'Bulk copy 09' },
  { label: 'Bulk copy 10' },
  { label: 'Bulk copy 11' },
  { label: 'Bulk copy 12' },
  { label: 'Bulk copy 13' },
  { label: 'Bulk copy 14' },
  { label: 'Bulk copy 15' },
  { label: 'Bulk copy 16' },
  { label: 'Bulk copy 17' },
  { label: 'Bulk copy 18' },
  { label: 'Bulk copy 19' },
  { label: 'Bulk copy 20' },
];

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
      <section className="foundation-grid" aria-label="Foundation cards">
        {foundationCards.map((card) => (
          <article className="foundation-card" key={card.label}>
            <span className="foundation-card-label">{card.label}</span>
            <p className="foundation-card-detail">{card.detail}</p>
          </article>
        ))}
      </section>
      <section className="large-manual-grid" aria-label="Large manual edit batch">
        {largeManualItems.map((item) => (
          <span className="large-manual-item" key={item.label}>{item.label}</span>
        ))}
      </section>
      <section className="action-row" aria-label="Workshop actions">
        <span className="primary-action" role="button" tabIndex="0">Learn more</span>
        <span className="secondary-action" role="button" tabIndex="0">Learn more</span>
      </section>
    </main>
  );
}
