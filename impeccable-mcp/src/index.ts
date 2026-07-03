import { createApp } from './http/app.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  process.stdout.write(`impeccable-mcp listening on ${port}\n`);
});
