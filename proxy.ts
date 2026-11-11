import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { roleFromClaims } from '@/lib/auth/roles';

const isDashboard = createRouteMatcher(['/dashboard(.*)']);
const isApi = createRouteMatcher(['/api(.*)']);

/**
 * Request interception (Next 16 renamed middleware.ts to proxy.ts).
 *
 * - /dashboard*: signed-in supervisors only. Others go to sign-in or /forbidden.
 * - /api/*: signed-in users only (401 JSON otherwise). Route handlers still call
 *   auth() and check role and ownership themselves; this is the outer fence.
 * - /field is deliberately NOT matched. It is a public, prerendered shell that the
 *   service worker caches; if Clerk could redirect it (sign-in or session handshake),
 *   the worker might precache a redirect instead of the app.
 */
export default clerkMiddleware(
  async (auth, req) => {
    if (isApi(req)) {
      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
      }
      return;
    }

    if (isDashboard(req)) {
      const { userId, sessionClaims, redirectToSignIn } = await auth();
      if (!userId) {
        return redirectToSignIn({ returnBackUrl: req.url });
      }
      if (roleFromClaims(sessionClaims) !== 'supervisor') {
        return NextResponse.redirect(new URL('/forbidden', req.url));
      }
    }
  },
  { signInUrl: '/sign-in' },
);

export const config = {
  matcher: [
    // Everything except Next.js internals, static files and the /field shell.
    '/((?!_next|field(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|map)).*)',
    // Always run for API routes.
    '/(api|trpc)(.*)',
  ],
};
