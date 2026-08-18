import './styles.css';

export default function App() {
  return (
    <main className="page page--wide">
      <header className="hero hero--tall">
        <h1 className="hero__title">Oracle fixture</h1>
        <p className="hero__lede">A component with enough class tokens to count as visual implementation.</p>
        <a className="button button--primary" href="#">Start</a>
      </header>
      <section className="grid grid--3 features">
        <article className="card card--flat">One</article>
        <article className="card card--flat">Two</article>
        <article className="card card--flat">Three</article>
      </section>
    </main>
  );
}
