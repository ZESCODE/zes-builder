import { useEffect, useState } from 'react';

type Session = {
  signedIn: boolean;
  hasAccess: boolean;
  level: string | null;
  gateEnabled: boolean;
  productUrl: string;
  user: { id: string; username: string; name: string } | null;
};

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    fetch('/api/whop/session', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data) => {
        if (alive) {
          setSession(data as Session);
        }
      })
      .catch(() => alive && setFailed(true));

    return () => {
      alive = false;
    };
  }, []);

  if (!session && !failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bolt-elements-background-depth-1">
        <div className="i-svg-spinners:90-ring-with-bg text-3xl text-bolt-elements-loader-progress" />
      </div>
    );
  }

  if (!session || !session.gateEnabled || session.hasAccess) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-bolt-elements-background-depth-1 px-6">
      <div className="w-full max-w-md rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-8 text-bolt-elements-textPrimary">
        <img src="/zes-builder-logo.svg" alt="ZES Builder" className="mb-6 h-10" />
        <h1 className="text-xl font-semibold">Build websites with AI</h1>
        <p className="mt-2 text-sm text-bolt-elements-textSecondary">
          ZES Builder is sold on Whop. Sign in with the Whop account you used to purchase access.
        </p>

        {session.signedIn ? (
          <>
            <p className="mt-6 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 py-3 text-sm">
              Signed in as <strong>{session.user?.name || session.user?.username || 'your Whop account'}</strong>, but
              this account has no active ZES Builder access.
            </p>
            <a
              href={session.productUrl}
              className="mt-4 block w-full rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-medium text-white"
            >
              Get access on Whop
            </a>
            <a
              href="/api/auth/logout"
              className="mt-3 block w-full text-center text-xs text-bolt-elements-textSecondary underline"
            >
              Sign out
            </a>
          </>
        ) : (
          <>
            <a
              href="/api/auth/whop"
              className="mt-6 block w-full rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-medium text-white"
            >
              Sign in with Whop
            </a>
            <a
              href={session.productUrl}
              className="mt-3 block w-full text-center text-xs text-bolt-elements-textSecondary underline"
            >
              Buy ZES Builder on Whop
            </a>
          </>
        )}
      </div>
    </div>
  );
}
