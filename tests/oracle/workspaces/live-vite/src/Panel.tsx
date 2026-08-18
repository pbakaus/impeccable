type PanelProps = { title: string; children?: React.ReactNode };

export function Panel({ title, children }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2 className="panel-title">{title}</h2>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
