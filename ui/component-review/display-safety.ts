export function displayDimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Invalid component review dimension');
  }
  return value;
}

export function assertDisplaySafePacket(packet: {
  round: unknown;
  comp: { width: unknown; height: unknown };
}): void {
  if (typeof packet.round !== 'number' || !Number.isSafeInteger(packet.round) || packet.round < 1) {
    throw new TypeError('Invalid component review round');
  }
  displayDimension(packet.comp.width);
  displayDimension(packet.comp.height);
}

export function safeObjectPosition(value?: string): string {
  const tokens = (value || 'center').trim().split(/\s+/);
  const valid = tokens.length > 0 && tokens.length <= 2 && tokens.every((token) => {
    if (/^(left|center|right|top|bottom)$/i.test(token)) return true;
    return /^\d+(?:\.\d+)?%$/.test(token) && Number.parseFloat(token) <= 100;
  });
  return valid ? tokens.join(' ') : 'center';
}
