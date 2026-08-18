<script>
  let title = 'SvelteKit Fixture';
  let expenses = [
    { id: 1, label: 'Coffee', amount: 3 },
    { id: 2, label: 'Lunch', amount: 12 },
  ];
</script>

<main class="page">
  <h1 class="hero-title">{title}</h1>
  <p class="hero-hook">Minimal SvelteKit route for oracle live-mode goldens.</p>
  <ul class="expense-list">
    {#each expenses as expense (expense.id)}
      <li class="expense-row">{expense.label}: {expense.amount}</li>
    {/each}
  </ul>
  <section id="features" class="feature-grid">
    <article class="feature-card">One</article>
    <article class="feature-card">Two</article>
  </section>
</main>

<style>
  .hero-title { font-size: 2rem; }
  .expense-list { list-style: none; padding: 0; }
  .expense-row { padding: 4px 0; }
</style>
