import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Molde',
  description: 'Engenharia reversa de conteudo do Instagram',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
