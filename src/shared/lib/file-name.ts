/** File name from Content-Disposition: the UTF-8 name (filename*) when sent, else the ASCII one. */
export function fileNameFrom(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      /* fall through */
    }
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/**
 * The name a prepared paid file is saved under: `?prepare=1` answers `{ name }` with private storage, or the file
 * itself (local development without storage), whose Content-Disposition names it.
 */
export async function preparedFileName(res: Response, fallback: string): Promise<string> {
  if ((res.headers.get("Content-Type") ?? "").includes("application/json"))
    return ((await res.json().catch(() => ({}))) as { name?: string }).name ?? fallback;
  return fileNameFrom(res.headers.get("Content-Disposition"), fallback);
}
