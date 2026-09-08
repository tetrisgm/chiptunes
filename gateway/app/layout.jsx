import { ClerkProvider } from '@clerk/nextjs';
import { readClerkConfig } from '../lib/clerk-auth.mjs';

export default function RootLayout({ children }) {
  const config = readClerkConfig();
  return <html lang="en"><body>{config
    ? <ClerkProvider publishableKey={config.publishableKey} signInUrl="/sign-in">{children}</ClerkProvider>
    : children}</body></html>;
}
