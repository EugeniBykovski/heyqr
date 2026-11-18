/** Homepage address field with a scheme prefix (design: "https://" + domain). */
const SCHEME = /^(https?:\/\/)/i;
export const schemeOf = (url: string) => SCHEME.exec(url)?.[1].toLowerCase() ?? "https://";
export const bareUrl = (url: string) => url.replace(SCHEME, "");
/**
 * What the address field stores while the user types: leading spaces dropped, a pasted http:// or https:// kept as is
 * (never doubled), otherwise the scheme shown in the prefix. Trailing spaces stay editable; validation and encoding trim.
 */
export function fromAddressField(typed: string, current: string): string {
  const value = typed.trimStart();
  if (!value) return "";
  return SCHEME.test(value) ? value : `${schemeOf(current)}${value}`;
}
