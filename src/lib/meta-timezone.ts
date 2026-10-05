/** Meta can return IANA aliases such as Brazil/East for the same reporting zone. */
export function canonicalMetaTimezone(timezone: string | null | undefined): string | null {
  if (!timezone?.trim()) return null;
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: timezone.trim(),
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
