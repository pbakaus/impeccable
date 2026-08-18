import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <main className="page">
      <h1 className="hero-title">Start Home Hero</h1>
      <p className="hero-hook">Server-rendered by TanStack Start.</p>
    </main>
  );
}
