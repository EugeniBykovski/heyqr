import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";

type Props = { name: string; amount: string; url: string };

export function PurchaseReceiptEmail({ name, amount, url }: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your QR code is ready. PNG and SVG, download them any time.</Preview>
      <Body style={{ backgroundColor: "#F7F7F8", fontFamily: "'DM Sans', Arial, sans-serif", color: "#0D0D12" }}>
        <Container style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 32, margin: "32px auto", maxWidth: 520 }}>
          <Heading style={{ fontSize: 24, letterSpacing: "-0.02em", margin: "0 0 12px" }}>Thanks, {name.split(" ")[0]}</Heading>
          <Text style={{ fontSize: 15, lineHeight: "24px", color: "#4A4A57" }}>
            We received {amount}. Every layout of this code is now yours to download as PNG or SVG, as often as you like.
          </Text>
          <Section style={{ margin: "24px 0" }}>
            <Button
              href={url}
              style={{ backgroundColor: "#5B3BFF", color: "#FFFFFF", borderRadius: 999, padding: "12px 22px", fontWeight: 600 }}
            >
              Open my QR code
            </Button>
          </Section>
          <Text style={{ fontSize: 13, color: "#6B6B78" }}>Hey QR · Questions? Just reply to this email.</Text>
        </Container>
      </Body>
    </Html>
  );
}

PurchaseReceiptEmail.PreviewProps = { name: "Ana Reyes", amount: "$4.99", url: "https://heyqr.app/dashboard" } satisfies Props;
export default PurchaseReceiptEmail;
