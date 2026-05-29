import { useEffect, useState } from 'react';

export default function App() {
  const [expenses, setExpenses] = useState([]);

  useEffect(() => {
    window.__impeccableReactStatefulMounts = (window.__impeccableReactStatefulMounts || 0) + 1;
  }, []);

  function addExpense() {
    setExpenses((current) => [
      ...current,
      { id: current.length + 1, name: 'Design snack', amount: '$12' },
    ]);
  }

  return (
    <main className="page">
      <header className="expense-header">
        <h1 className="hero-title">Open expenses</h1>
        <span className="open-count" data-testid="open-count">{expenses.length} open</span>
        <button className="add-button" data-testid="add-expense" type="button" onClick={addExpense}>
          Add expense
        </button>
      </header>

      <section className="expense-panel">
        {expenses.length === 0 ? (
          <article className="empty-card">
            <strong>No open expenses.</strong>
            <p>Add the next shared expense and it will land here.</p>
          </article>
        ) : (
          <article className="expense-row" data-testid="expense-row">
            <strong>{expenses[0].name}</strong>
            <span>{expenses[0].amount}</span>
          </article>
        )}
      </section>
    </main>
  );
}
