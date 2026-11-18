/**
 * Independent vCard 3.0 reader (RFC 2425/2426), not built from our serializer: unfold CRLF + space/tab, split
 * lines, "NAME;params:value", then unescape TEXT (\n, \\, \; \,). Structured values split on unescaped ";".
 */
export function parseVCard(text: string) {
  const lines = text
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter(Boolean);
  const unescape = (s: string) => s.replace(/\\([nN\\;,])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
  const splitStructured = (s: string) => {
    const parts: string[] = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && i + 1 < s.length) {
        cur += s.slice(i, i + 2);
        i++;
      } else if (s[i] === ";") {
        parts.push(cur);
        cur = "";
      } else cur += s[i];
    }
    parts.push(cur);
    return parts.map(unescape);
  };
  const props = lines.map((line) => {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).split(";")[0] ?? "";
    return { name: name.toUpperCase(), value: line.slice(colon + 1) };
  });
  const value = (n: string) => props.find((p) => p.name === n)?.value;
  const text1 = (n: string) => {
    const v = value(n);
    return v === undefined ? undefined : unescape(v);
  };
  const n = value("N");
  const [lastName = "", firstName = ""] = n === undefined ? [] : splitStructured(n);
  const org = value("ORG");
  return {
    begin: lines[0],
    end: lines[lines.length - 1],
    version: value("VERSION"),
    names: props.map((p) => p.name),
    firstName,
    lastName,
    fn: text1("FN"),
    org: org === undefined ? undefined : splitStructured(org).join(";"),
    title: text1("TITLE"),
    tel: value("TEL"),
    email: text1("EMAIL"),
    url: value("URL"),
  };
}
