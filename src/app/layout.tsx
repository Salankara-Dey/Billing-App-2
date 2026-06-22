import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Saral — Billing & Inventory Suite",
  description: "Professional billing, inventory, reporting, and customer-supplier management suite for Saral.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
