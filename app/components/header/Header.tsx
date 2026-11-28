import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { BrandLogo } from '~/components/brand/BrandLogo';
import { PollinationsImageButton } from '~/components/chat/PollinationsImageButton';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames('flex items-center px-4 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <a href="/" className="text-2xl font-semibold text-accent flex items-center">
          <BrandLogo className="h-9" label="ZESCODE" />
        </a>
      </div>
      <div className="ml-3">
        <PollinationsImageButton />
      </div>
      <nav className="ml-4 flex items-center gap-1">
        <a
          href="/zap"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-item-background hover:text-bolt-elements-textPrimary"
        >
          <span className="i-ph:flow-arrow text-base" />
          Workflows
        </a>
        <a
          href="/blog"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-item-background hover:text-bolt-elements-textPrimary"
        >
          <span className="i-ph:article text-base" />
          Blog
        </a>
      </nav>
      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="">
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
