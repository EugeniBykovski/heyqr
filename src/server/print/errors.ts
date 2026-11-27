/** HTTP status of a refused print request: 404 for another account's or a missing layout, 503 while a profile is down. */
export const printErrorStatus = (error: string) => (error === "not_found" ? 404 : error === "profile_unavailable" ? 503 : 422);
