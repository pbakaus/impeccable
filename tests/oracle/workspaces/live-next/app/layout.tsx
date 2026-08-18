export const metadata = { title: 'Next Fixture' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
