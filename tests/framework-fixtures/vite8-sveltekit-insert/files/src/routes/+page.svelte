<main class="page">
  <header class="expense-header">
    <h1 class="hero-title">Offene Ausgaben</h1>
    <span class="open-count" data-testid="open-count">0 offen</span>
  </header>

  <section class="expense-panel">
    <article class="empty-card">
      <strong>Keine offenen Ausgaben.</strong>
      <p>Fuegt die naechste gemeinsame Ausgabe hinzu, dann landet sie hier.</p>
    </article>
  </section>

  <aside class="detect-target" data-testid="detect-target">
    <strong>Audit edge case</strong>
    <p>This deliberately keeps a one-sided accent border for the Detect smoke test.</p>
  </aside>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #102923;
    color: #f4f7f3;
    font-family: "Avenir Next", ui-sans-serif, system-ui, sans-serif;
  }

  .page {
    width: min(920px, calc(100vw - 48px));
    margin: 40px auto;
  }

  .expense-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 18px;
  }

  .hero-title {
    margin: 0;
    font-size: 34px;
    line-height: 1;
  }

  .open-count {
    border-radius: 999px;
    background: #eef4ef;
    color: #162820;
    padding: 4px 12px;
    font-size: 13px;
    font-weight: 700;
  }

  .expense-panel {
    margin-top: 24px;
    border-radius: 28px;
    background: #9bbfad;
    padding: 46px;
    color: #1b3329;
  }

  .empty-card {
    border: 1px solid #16332b;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.62);
    padding: 26px;
  }

  .detect-target {
    margin-top: 28px;
    border: 1px solid rgba(22, 51, 43, 0.28);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.62);
    padding: 16px 18px;
    color: #1b3329;
  }

  .detect-target strong,
  .detect-target p {
    margin: 0;
  }

  .detect-target p {
    margin-top: 6px;
    font-size: 14px;
  }
</style>
