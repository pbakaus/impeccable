import { spawn } from 'node:child_process';

export function browserOpenCommand(url, {
  platform = process.platform,
  comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
} = {}) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: comspec, args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

export function openSystemBrowser(url, {
  platform = process.platform,
  comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
  spawnImpl = spawn,
} = {}) {
  const { command, args } = browserOpenCommand(url, { platform, comspec });
  try {
    const child = spawnImpl(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
