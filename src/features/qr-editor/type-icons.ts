import type { QrContentType } from "@heyqr/qr-core";
import {
  CalendarIcon,
  ContactIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  TypeIcon,
  WifiIcon,
  type LucideIcon,
} from "lucide-react";

/** One icon per content type, shared by the editor's type grid and the home page's type chips. */
export const TYPE_ICONS: Record<QrContentType, LucideIcon> = {
  website: GlobeIcon,
  text: TypeIcon,
  wifi: WifiIcon,
  contact: ContactIcon,
  email: MailIcon,
  phone: PhoneIcon,
  sms: MessageSquareIcon,
  location: MapPinIcon,
  event: CalendarIcon,
};
