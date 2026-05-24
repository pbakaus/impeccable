<script>
  const stats = { seats: 7 };

  function assertIntegerStat(value) {
    if (!Number.isInteger(value)) throw new Error('stats.seats must stay integer');
    return value;
  }
</script>

<main class="page">
  <section class="hero-copy" style="padding: 12px; margin: -12px -12px 16px;">
    <h1 class="hero-title">Vite 8 + SvelteKit Fixture</h1>
    <p class="hero-hook">Minimal SvelteKit route for live-mode E2E tests.</p>
  </section>
  <section class="capacity-panel" aria-label="Svelte capacity" style="padding: 12px; margin: 0 0 16px;">
    <span class="capacity-count">{stats.seats}</span>
    <span class="capacity-check" hidden>{assertIntegerStat(stats.seats)}</span>
  </section>
  <section id="features" class="feature-grid">
    <article class="feature-card">One</article>
    <article class="feature-card">Two</article>
  </section>
</main>
