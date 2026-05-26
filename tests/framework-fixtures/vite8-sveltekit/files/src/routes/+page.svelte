<script>
  const stats = { seats: 7 };
  const hardManualCards = [
    { name: 'Svelte orbit key', code: 'S-17', detail: 'Mapped Svelte copy with keyed lookup' },
    { name: 'Svelte prism key', code: 'S-23', detail: 'Sibling Svelte card mirrors the shape' },
  ];
  const hardManualCountsByName = {
    'Svelte orbit key': 17,
    'Svelte prism key': 23,
  };
  const largeManualItems = [
    { label: 'Svelte bulk 01' },
    { label: 'Svelte bulk 02' },
    { label: 'Svelte bulk 03' },
    { label: 'Svelte bulk 04' },
    { label: 'Svelte bulk 05' },
    { label: 'Svelte bulk 06' },
  ];

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
  <section class="hard-manual-grid" aria-label="Hard Svelte manual edit cards">
    {#each hardManualCards as card (card.name)}
      <article class="hard-manual-card">
        <h2 class="hard-manual-heading">
          <span class="hard-manual-name">{card.name}</span>
          <em class="hard-manual-code">{card.code}</em>
        </h2>
        <p class="hard-manual-detail">{card.detail}</p>
        <span class="hard-manual-count">{hardManualCountsByName[card.name]}</span>
      </article>
    {/each}
  </section>
  <section class="large-manual-grid" aria-label="Large Svelte manual edit batch">
    {#each largeManualItems as item (item.label)}
      <span class="large-manual-item">{item.label}</span>
    {/each}
  </section>
</main>
