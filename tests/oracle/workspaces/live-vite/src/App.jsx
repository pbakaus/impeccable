export default function App() {
  return (
    <main className="page">
      <h1 className="hero-title">Vite Fixture</h1>
      <p className="hero-hook">Minimal React tree for oracle live-mode goldens.</p>
      <section id="features" className="feature-grid">
        <article className="feature-card">One</article>
        <article className="feature-card">Two</article>
      </section>
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id} className="item-row">{item.title}</li>
        ))}
      </ul>
    </main>
  );
}

const items = [
  { id: 1, title: 'First' },
  { id: 2, title: 'Second' },
];
