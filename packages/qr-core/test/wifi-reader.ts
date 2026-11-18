/**
 * Independent reader for the WIFI: format (written from the ZXing/Android convention, not from our serializer):
 * fields separated by unescaped ";", "KEY:value", a backslash escapes the next character, the record ends with ";;".
 */
export function parseWifi(text: string): Record<string, string> {
  if (!text.startsWith("WIFI:")) throw new Error("not a WIFI: payload");
  const fields: Record<string, string> = {};
  let i = 5;
  while (i < text.length && text[i] !== ";") {
    const colon = text.indexOf(":", i);
    const key = text.slice(i, colon);
    let value = "";
    for (i = colon + 1; i < text.length && text[i] !== ";"; i++) {
      if (text[i] === "\\" && i + 1 < text.length) i++;
      value += text[i];
    }
    if (key in fields) throw new Error(`duplicate field ${key}`);
    fields[key] = value;
    i++;
  }
  return fields;
}
