import "./globals.css";

export const metadata = {
  title: "pynk // ops",
  description: "Personal organizer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
