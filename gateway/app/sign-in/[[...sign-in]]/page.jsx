import { SignIn } from '@clerk/nextjs';
import { readClerkConfig } from '../../../lib/clerk-auth.mjs';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  if (!readClerkConfig()) return <main><h1>Sign-in unavailable</h1>
    <p>Account connections are not available yet. Please try again later.</p></main>;
  return <main><SignIn routing="path" path="/sign-in" /></main>;
}
