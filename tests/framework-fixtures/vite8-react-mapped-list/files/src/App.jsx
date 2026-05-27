const ITEMS = [
  { id: 'a', title: 'Alpha card' },
  { id: 'b', title: 'Beta card' },
  { id: 'c', title: 'Gamma card' },
];

export default function App() {
  return (
    <main className="page">
      <p className="hero-hook">Three cards rendered from a single mapped template.</p>
      <section className="grid">
        {ITEMS.map((item) => (
          <article key={item.id} className="card">
            <h1 className="hero-title">{item.title}</h1>
            <p>Body for {item.id}.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
