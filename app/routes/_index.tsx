import type { MetaFunction } from 'react-router';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { FirstRunOnboarding } from '~/components/onboarding/FirstRunOnboarding';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { AccessGate } from '~/components/whop/AccessGate';

export const meta: MetaFunction = () => {
  return [
    { title: 'ZESCODE Builder — AI website builder' },
    {
      name: 'description',
      content: 'Describe a website and ZESCODE Builder writes, previews and deploys it in your browser.',
    },
    { property: 'og:title', content: 'ZESCODE Builder — AI website builder' },
    {
      property: 'og:description',
      content: 'Describe a website and ZESCODE Builder writes, previews and deploys it in your browser.',
    },
    { property: 'og:type', content: 'website' },
  ];
};

export const loader = () => Response.json({});

/**
 * Landing page component for ZES Builder.
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  return (
    <AccessGate>
      <div className="relative flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
        <BackgroundRays />
        <Header />
        <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
        <FirstRunOnboarding />
        <footer className="pointer-events-none absolute bottom-1 right-3 z-10 text-[11px] text-bolt-elements-textTertiary">
          Powered by{' '}
          <a
            href="https://zes.codes"
            className="pointer-events-auto hover:text-accent-500"
            target="_blank"
            rel="noreferrer"
          >
            ZES.codes
          </a>{' '}
          · Built on bolt.diy ·{' '}
          <a href="/zap" className="pointer-events-auto hover:text-accent-500">
            Workflows
          </a>{' '}
          ·{' '}
          <a href="/blog" className="pointer-events-auto hover:text-accent-500">
            Blog
          </a>
        </footer>
      </div>
    </AccessGate>
  );
}
