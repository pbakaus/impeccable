export function A({ items }) {
  const x = a < b;
  return (
    <>
      <p>Don't see http://x.com and/or "this</p>
      {items.map((i) => (
        <li key={i}>It's <img alt="one" /></li>
      ))}
      <Card title="a'b"><span>won't</span></Card>
      <img alt="two" />
    </>
  );
}
export function L({ items }) {
  return items.map((i) => <li /* note */><img alt="c" /></li>);
}
