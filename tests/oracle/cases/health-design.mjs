import fs from 'node:fs';
import path from 'node:path';

const setting = '.oracle-home/impeccable/health.json';
const base = {
  verb: 'health', workspace: 'ctx-empty',
  env: { IMPECCABLE_HOME: '<WS>/.oracle-home/impeccable' },
  files: [setting],
};
const enabled = ws => {
  fs.mkdirSync(path.dirname(path.join(ws, setting)), { recursive: true });
  fs.writeFileSync(path.join(ws, setting), '{"design":true}');
};

export default [
  { ...base, id: 'health-design-refresh-signed-out', verb: 'health-design-refresh', args: [] },
  { ...base, id: 'health-design-refresh-invalid', verb: 'health-design-refresh', args: ['unexpected'] },
  { ...base, id: 'health-design-on', args: ['design', 'on'] },
  { ...base, id: 'health-design-off', args: ['design', 'off'], setup: enabled },
  { ...base, id: 'health-design-invalid', args: ['design', 'invalid'], setup: enabled },
  { ...base, id: 'health-design-missing', args: ['design'], setup: enabled },
];
