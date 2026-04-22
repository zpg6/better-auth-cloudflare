import { Outlet, Link, HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import BetterAuthHeader from '../components/header-user.tsx'
import { ThemeToggle } from '../components/theme-toggle.tsx'
import { EdgeStatus } from '../components/edge-status.tsx'

import appCss from '../styles.css?url'

const GOOGLE_FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=Hubot+Sans:ital,wght@0,200..900;1,200..900&family=Mona+Sans:ital,wght@0,200..900;1,200..900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap'

// Runs before React hydrates to avoid a flash of wrong theme.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.style.colorScheme=t;document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
      { title: 'better-auth-cloudflare · tanstack-start example' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      // Preconnect opens TCP + TLS to Google's font hosts before the CSS
      // parser asks for them.
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      // Preload the CSS itself so it's fetched in parallel with the HTML.
      { rel: 'preload', as: 'style', href: GOOGLE_FONTS_CSS },
      { rel: 'stylesheet', href: GOOGLE_FONTS_CSS },
    ],
    scripts: [{ children: themeInitScript }],
  }),
  component: RootLayout,
})

function RootLayout() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="flex flex-col min-h-screen">
          <header
            className="sticky top-0 z-40 border-b backdrop-blur-md"
            style={{
              background: 'color-mix(in oklch, var(--color-paper) 86%, transparent)',
              borderColor: 'var(--color-line)',
            }}
          >
            <div className="mx-auto max-w-6xl px-5 md:px-8 h-14 flex items-center gap-5">
              <Link to="/" className="flex items-baseline gap-3 group">
                <span
                  className="font-display text-[17px] font-bold tracking-tight"
                  style={{ color: 'var(--color-ink)' }}
                >
                  better-auth<span style={{ color: 'var(--color-signal)' }}>/</span>cloudflare
                </span>
                <span className="hidden md:inline label-meta">tanstack-start example</span>
              </Link>

              <div className="ml-auto flex items-center gap-3 md:gap-5">
                <span className="hidden sm:inline-flex">
                  <EdgeStatus />
                </span>
                <ThemeToggle />
                <BetterAuthHeader />
              </div>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="mt-20 border-t" style={{ borderColor: 'var(--color-line)' }}>
            <div className="mx-auto max-w-6xl px-5 md:px-8 py-6 flex flex-wrap items-center gap-x-6 gap-y-2 label-meta">
              <span>rev.01</span>
              <span>·</span>
              <span>d1 · kv · workers</span>
              <span>·</span>
              <span>
                {/* at least initially created by */}
                created by{' '}
                <a
                  href="https://github.com/mrhut10"
                  className="link-signal"
                  style={{ color: 'var(--color-ink-dim)' }}
                >
                  mrhut10 ↗
                </a>
              </span>
              <span className="ml-auto">
                <a
                  href="https://github.com/better-auth/better-auth"
                  className="link-signal"
                  style={{ color: 'var(--color-ink-dim)' }}
                >
                  better-auth docs ↗
                </a>
              </span>
            </div>
          </footer>
        </div>
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
