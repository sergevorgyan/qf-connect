// North American numbers only for now: VoIP.ms DIDs and most callers are +1.
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// VoIP.ms wants bare 10-digit numbers for DIDs and SMS destinations.
export function toTenDigit(e164: string): string {
  return e164.replace(/\D/g, '').slice(-10);
}

// CDR caller IDs look like `"JOHN SMITH" <5551234567>` or just `5551234567`.
export function parseCallerId(callerid: string): { name: string | null; number: string | null } {
  const m = callerid.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim() || null, number: toE164(m[2]) };
  return { name: null, number: toE164(callerid) };
}
