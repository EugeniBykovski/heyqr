/**
 * Better Auth appends `error=<code>` to errorCallbackURL. Only a plain code is read, never shown verbatim:
 * access_denied (the user canceled at Google) or anything else (sign-in didn't finish).
 */
export type SignInError = "canceled" | "incomplete";

export function signInError(error: string | string[] | undefined): SignInError | null {
  if (typeof error !== "string" || !/^[a-z_]{1,64}$/i.test(error)) return null;
  return error === "access_denied" ? "canceled" : "incomplete";
}
