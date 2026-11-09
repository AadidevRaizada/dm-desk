import { DM_Serif_Display, Funnel_Sans, Gochi_Hand, Shantell_Sans } from "next/font/google";

const funnelSans = Funnel_Sans({ subsets: ["latin"], variable: "--font-sans" });
const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  style: "italic",
  weight: "400",
});

// Ahum hand-drawn fonts: Gochi Hand for titles, Shantell Sans for body text.
const gochiHand = Gochi_Hand({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-gochi",
  display: "swap",
});
const shantellSans = Shantell_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-shantell",
  display: "swap",
});

export { funnelSans, dmSerif, gochiHand, shantellSans };
