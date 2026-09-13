import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { genesisLogoUrl } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Central de Gestao Genesis",
    template: "%s | Genesis",
  },
  description:
    "Operacao de projetos, integracoes, funis e performance da Genesis.",
  icons: { icon: genesisLogoUrl, apple: genesisLogoUrl },
  verification: {
    google: "ZGTMz3Z5CjQnUkCjtVcWXevDBA-fWLiSTyESbG2rGb8",
  },
  openGraph: {
    title: "Central de Gestao Genesis",
    description:
      "Operacao de projetos, integracoes, funis e performance da Genesis.",
    images: [{ url: genesisLogoUrl, width: 1536, height: 1536 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
