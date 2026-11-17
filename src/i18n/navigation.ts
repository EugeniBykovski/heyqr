import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/** Always navigate with these: they keep the current language in the URL. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
