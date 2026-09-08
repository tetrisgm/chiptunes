import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { readClerkConfig } from './lib/clerk-auth.mjs';

export default function proxy(request, event) {
  const authConfig = readClerkConfig();
  if (!authConfig) return NextResponse.next();
  return clerkMiddleware({ secretKey: authConfig.secretKey, publishableKey: authConfig.publishableKey,
    authorizedParties: authConfig.authorizedParties, signInUrl: '/sign-in' })(request, event);
}

// OAuth MCP requests are authenticated explicitly at the resource, without
// browser middleware redirects. Browser API handlers use authenticateBrowser.
export const config = { matcher: ['/sign-in(.*)'] };
