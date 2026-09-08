import { readClerkConfig } from '../../../lib/clerk-auth.mjs';
import { browserAuthResponse } from '../../../lib/clerk-browser.mjs';

export const dynamic = 'force-dynamic';

// Public configuration + lazy browser SDK module, NOT a token-minting endpoint.
// Importing this endpoint does no Clerk network work until Connect calls ready().
export function GET() {
  return browserAuthResponse(readClerkConfig());
}
