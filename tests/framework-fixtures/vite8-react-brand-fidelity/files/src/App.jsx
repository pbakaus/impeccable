function ActionLink({ children }) {
  return <a className="action-link" href="#edition">{children}</a>;
}

export default function App() {
  return (
    <main className="page-shell">
      <header className="masthead">
        <p className="masthead__kicker">Northstar Field Journal</p>
        <h1>Useful observations from the long way around.</h1>
      </header>

      <section className="edition" id="edition" aria-labelledby="edition-title">
        <p className="edition__number">Edition 08 · Coastal paths</p>
        <article className="offer-card" aria-labelledby="field-notes-title">
          <div className="offer-card__copy">
            <p className="offer-card__eyebrow">Quarterly print edition</p>
            <h2 className="offer-card__title" id="field-notes-title">Field Notes</h2>
            <p className="offer-card__body">Four routes, annotated maps, and practical details for unhurried weekends.</p>
          </div>
          <ActionLink>Reserve issue eight</ActionLink>
        </article>
      </section>
    </main>
  );
}
