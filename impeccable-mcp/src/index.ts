import { createApp } from './http/app.js';

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? 3000);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    process.stderr.write(`Invalid PORT value: ${value ?? ''}\n`);
    process.exit(1);
  }
  return parsed;
}

const port = parsePort(process.env.PORT);
const app = createApp();

const server = app.listen(port, () => {
  process.stdout.write(`impeccable-mcp listening on ${port}\n`);
});

server.on('error', (error) => {
  console.error('failed to start impeccable-mcp server', error);
  process.exit(1);
});
