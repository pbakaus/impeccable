const ITEMS = [
  { id: 'a', title: 'Alpha card', body: 'Alpha detail' },
  { id: 'b', title: 'Beta card', body: 'Beta detail' },
  { id: 'c', title: 'Gamma card', body: 'Gamma detail' },
];

export default function App() {
  return (
    <main className="page">
      <p className="hero-hook">Three cards rendered from a single mapped template.</p>
      <section className="grid">
        {ITEMS.map((item) => (
          <article key={item.id} className="card">
            <h1 className="hero-title">{item.title}</h1>
            <p className="card-body">{item.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
