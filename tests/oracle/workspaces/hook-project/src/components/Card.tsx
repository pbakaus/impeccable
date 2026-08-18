export function Card() {
  return (
    <div style={{ boxShadow: '0 0 40px rgba(99, 102, 241, 0.6)', background: '#0f172a', color: '#334155', fontSize: '11px' }}>
      <h3 style={{ fontFamily: 'Inter, sans-serif' }}>Lightning Fast</h3>
      <p style={{ transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)' }}>Body</p>
    </div>
  );
}
