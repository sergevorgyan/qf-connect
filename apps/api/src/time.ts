// VoIP.ms returns wall-clock strings ("2026-10-28 16:52:36") with no offset. These turn them into UTC
// using the IANA zone they were written in, so daylight-saving changes are handled.
function offsetMs(utcMs: number, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(utcMs).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

export function wallClockToIso(local: string, timeZone: string): string {
  const asUtc = Date.parse(local.replace(' ', 'T') + 'Z');
  let utc = asUtc - offsetMs(asUtc, timeZone);
  utc = asUtc - offsetMs(utc, timeZone); // second pass settles times near a DST switch
  return new Date(utc).toISOString();
}
