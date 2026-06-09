export default function App() {
  return (
    <main className="page">
      <h1 className="hero-title">Vite 8 Fixture</h1>
      <p className="hero-hook">Minimal React tree for live-mode E2E tests.</p>
      <div className="input-row">
        <input className="demo-input" type="text" placeholder="First field" aria-label="First field" />
        <input className="demo-input" type="text" placeholder="Second field" aria-label="Second field" />
      </div>
      <section id="features" className="feature-grid">
        <article className="feature-card">One</article>
        <article className="feature-card">Two</article>
      </section>
    </main>
  );
}
