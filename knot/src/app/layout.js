import "./globals.css";

export const metadata = {
  title: "MCP Studio",
  description: "Local Ollama chat interface with MCP server management",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body className="h-full bg-bg text-text-primary font-inter">
        {children}
      </body>
    </html>
  );
}
