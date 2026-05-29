import { useEffect, useState, type ReactNode } from 'react'

const SESSION = {
  date: 'Tue · May 26, 2026',
  startedAt: '08:42',
  title: 'Long base — ingest pipeline refactor',
  subtitle: 'with a brief detour through the schema package',
  duration: '2h 18m',
  lines: 1247,
  pace: 184,
  langs: [
    { name: 'TypeScript', time: '1h 12m', pct: 52, swatch: '#FF4D1A' },
    { name: 'Python', time: '31m', pct: 22, swatch: '#9CF76D' },
    { name: 'SQL', time: '18m', pct: 13, swatch: '#EFEAD8' },
    { name: 'Markdown', time: '17m', pct: 13, swatch: '#7A746A' },
  ],
  files: [
    { name: 'sessions.ts', path: 'apps/api/src/', changes: 423 },
    { name: 'events.ts', path: 'packages/shared/src/', changes: 218 },
    { name: 'tracker.ts', path: 'apps/extension/src/', changes: 156 },
    { name: 'schema.sql', path: 'packages/db/migrations/', changes: 94 },
  ],
}

const CHART = [
  20, 15, 25, 40, 55, 70, 85, 90, 75, 60, 50, 65, 80, 95, 110, 120, 130, 125,
  115, 100, 85, 70, 55, 40, 35, 30, 35, 40, 50, 60, 75, 90, 105, 115, 125, 135,
  140, 145, 140, 130, 120, 110, 100, 95, 100, 110, 120, 130, 135, 130, 120, 105,
  90, 75, 60, 50, 45, 50, 65, 80,
]

const LEADERS = [
  {
    rank: 1,
    handle: 'falsetto',
    sub: 'Berlin',
    time: '42:18:04',
    lang: 'Rust',
    langDot: '#FF4D1A',
    streak: 87,
  },
  {
    rank: 2,
    handle: 'lumen.dev',
    sub: 'Lisbon',
    time: '38:51:22',
    lang: 'TypeScript',
    langDot: '#9CF76D',
    streak: 54,
  },
  {
    rank: 3,
    handle: 'northbound',
    sub: 'Oslo',
    time: '35:47:09',
    lang: 'Go',
    langDot: '#7DD3FC',
    streak: 211,
  },
  {
    rank: 4,
    handle: 'yoursquid',
    sub: 'you',
    time: '32:12:55',
    lang: 'Python',
    langDot: '#EFEAD8',
    streak: 12,
    self: true,
  },
  {
    rank: 5,
    handle: 'inkpaper',
    sub: 'Tokyo',
    time: '30:44:01',
    lang: 'Swift',
    langDot: '#FCA5A5',
    streak: 31,
  },
  {
    rank: 6,
    handle: 'aprilsink',
    sub: 'Mexico City',
    time: '28:18:33',
    lang: 'Elixir',
    langDot: '#C4B5FD',
    streak: 9,
  },
]

const TICKER = [
  { who: 'northbound', what: 'finished a 2h 14m session in', em: 'Go' },
  { who: 'lumen.dev', what: 'hit a', em: '54-day streak' },
  { who: 'inkpaper', what: 'shipped', em: 'feat: shimmer transitions' },
  { who: 'falsetto', what: '+1,204 lines in', em: 'Rust' },
  { who: 'aprilsink', what: 'earned the', em: 'dawn patrol' },
  { who: 'yoursquid', what: 'started a session in', em: 'TypeScript' },
]

function buildChartPath(data: number[], w: number, h: number, pad = 4) {
  const max = Math.max(...data)
  const stepX = (w - pad * 2) / (data.length - 1)
  const scaleY = (h - pad * 2) / max
  return data
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'} ${(pad + i * stepX).toFixed(2)} ${(h - pad - v * scaleY).toFixed(2)}`,
    )
    .join(' ')
}

function buildAreaPath(data: number[], w: number, h: number, pad = 4) {
  return `${buildChartPath(data, w, h, pad)} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`
}

function Wordmark({ size = 'text-[28px]' }: { size?: string }) {
  return (
    <span className={`font-serif ${size} leading-none tracking-[-0.02em]`}>
      commma<span className='text-accent'>.</span>
    </span>
  )
}

function Nav() {
  return (
    <nav className='sticky top-0 z-50 border-b border-rule backdrop-blur-xl backdrop-saturate-150 bg-paper/70'>
      <div className='mx-auto max-w-[1320px] px-[clamp(20px,4vw,56px)]'>
        <div className='grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center h-16'>
          <a href='#' className='justify-self-start'>
            <Wordmark />
          </a>
          <div className='hidden md:flex gap-7 font-mono text-[12px] tracking-wider text-ink-soft'>
            {[
              'Activity',
              'Leaderboards',
              'Profile',
              'Pricing',
              'Changelog',
            ].map((l) => (
              <a
                key={l}
                href='#'
                className='relative py-1 transition-colors hover:text-ink
                  after:absolute after:left-0 after:right-0 after:-bottom-0.5 after:h-px after:bg-accent
                  after:scale-x-0 after:origin-left after:transition-transform hover:after:scale-x-100'
              >
                {l}
              </a>
            ))}
          </div>
          <div className='justify-self-end flex items-center gap-3'>
            <a
              href='#'
              className='hidden sm:inline-flex items-center h-[38px] px-4 rounded-full font-mono text-[12px] uppercase tracking-wider
                text-ink-soft hover:text-ink border border-transparent hover:border-rule-strong transition-colors'
            >
              Sign in
            </a>
            <a
              href='#'
              className='group inline-flex items-center gap-2.5 h-[38px] px-3.5 sm:px-4 rounded-full font-mono text-[11px] sm:text-[12px] uppercase tracking-wider font-medium
                bg-accent text-paper border border-accent hover:bg-ink hover:border-ink transition-colors whitespace-nowrap'
            >
              <span className='hidden sm:inline'>Install for VSCode</span>
              <span className='sm:hidden'>Install</span>
              <span className='inline-block transition-transform group-hover:translate-x-1'>
                →
              </span>
            </a>
          </div>
        </div>
      </div>
    </nav>
  )
}

function LiveDot({ color = 'live' }: { color?: 'live' | 'accent' }) {
  const cls = color === 'live' ? 'bg-live' : 'bg-accent'
  return (
    <span className={`w-[7px] h-[7px] rounded-full ${cls} animate-pulse-dot`} />
  )
}

function Hero() {
  const [pulse, setPulse] = useState(14233)
  useEffect(() => {
    const id = setInterval(
      () => setPulse((n) => n + Math.floor(Math.random() * 4) + 1),
      1700,
    )
    return () => clearInterval(id)
  }, [])

  return (
    <section className='relative'>
      <div className='mx-auto max-w-[1320px] px-[clamp(20px,4vw,56px)] pt-[clamp(56px,9vw,120px)] pb-[clamp(48px,6vw,96px)]'>
        <div className='flex items-center gap-3.5 mb-10 sm:mb-12 opacity-0 animate-rise-700 delay-100'>
          <LiveDot />
          <span className='font-mono text-[11px] tracking-[0.16em] uppercase text-ink-mute'>
            v0.1 · invite-only · 2,841 athletes
          </span>
        </div>

        <h1 className='font-serif font-normal text-[clamp(44px,10.5vw,168px)] leading-[0.92] tracking-[-0.035em] m-0'>
          <span className='block overflow-hidden reveal-clip py-[0.12em] my-[-0.12em]'>
            <span className='animate-rise-900 delay-120 inline-block'>
              Every commit
            </span>
          </span>
          <span className='block overflow-hidden reveal-clip py-[0.12em] my-[-0.12em]'>
            <span className='animate-rise-900 delay-240 inline-block'>
              is a <em className='font-serif italic text-accent'>step.</em>
            </span>
          </span>
        </h1>

        <div className='grid md:grid-cols-[1.4fr_1fr] gap-[clamp(36px,6vw,96px)] items-end mt-[clamp(36px,6vw,80px)]'>
          <div>
            <p
              className='font-sans text-[clamp(16px,1.3vw,19px)] leading-relaxed text-ink-soft max-w-[46ch] m-0 mb-8
              opacity-0 animate-rise-700 delay-520'
            >
              commma turns your editor into a logbook. Pace, splits, streaks,
              podiums — all the rituals of a real sport, for the work you
              already do. Install once, code as usual, then look back at the
              week like an athlete reviewing the tape.
            </p>
            <div className='flex gap-3 items-center flex-wrap opacity-0 animate-rise-700 delay-640'>
              <a
                href='#'
                className='group inline-flex items-center gap-2.5 h-[42px] px-5 rounded-full font-mono text-[12px] uppercase tracking-wider font-medium
                  bg-accent text-paper border border-accent hover:bg-ink hover:border-ink transition-colors'
              >
                Install the extension
                <span className='inline-block transition-transform group-hover:translate-x-1'>
                  →
                </span>
              </a>
              <a
                href='#'
                className='inline-flex items-center gap-2.5 h-[42px] px-5 rounded-full font-mono text-[12px] uppercase tracking-wider
                  text-ink-soft hover:text-ink border border-rule-strong hover:border-ink-faint transition-colors'
              >
                See a sample profile
              </a>
            </div>
          </div>

          <div className='opacity-0 animate-rise delay-720'>
            <div className='grid grid-cols-2 border-t border-rule'>
              <div className='py-5 pr-4 sm:pr-6 border-b border-r border-rule'>
                <span className='block font-serif text-[clamp(34px,4vw,56px)] leading-none tracking-[-0.02em] tnum'>
                  {pulse.toLocaleString()}
                </span>
                <span className='block font-mono text-[11px] tracking-[0.14em] uppercase text-ink-mute mt-2.5'>
                  active right now
                </span>
              </div>
              <div className='py-5 pl-4 sm:pl-6 border-b border-rule'>
                <span className='block font-serif text-[clamp(34px,4vw,56px)] leading-none tracking-[-0.02em] tnum'>
                  211
                  <span className='text-ink-mute text-[0.5em] align-baseline'>
                    d
                  </span>
                </span>
                <span className='block font-mono text-[11px] tracking-[0.14em] uppercase text-ink-mute mt-2.5'>
                  longest streak
                </span>
              </div>
              <div className='py-5 pr-4 sm:pr-6 border-b border-r border-rule'>
                <span className='block font-serif text-[clamp(34px,4vw,56px)] leading-none tracking-[-0.02em] tnum'>
                  1.4M
                </span>
                <span className='block font-mono text-[11px] tracking-[0.14em] uppercase text-ink-mute mt-2.5'>
                  hours logged
                </span>
              </div>
              <div className='py-5 pl-4 sm:pl-6 border-b border-rule'>
                <span className='block font-serif text-[clamp(34px,4vw,56px)] leading-none tracking-[-0.02em] tnum'>
                  92
                  <span className='text-ink-mute text-[0.5em] align-baseline'>
                    %
                  </span>
                </span>
                <span className='block font-mono text-[11px] tracking-[0.14em] uppercase text-ink-mute mt-2.5'>
                  return next-day
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Ticker() {
  const items = [...TICKER, ...TICKER, ...TICKER, ...TICKER]
  return (
    <div className='border-y border-rule bg-paper-2 overflow-hidden whitespace-nowrap'>
      <div className='inline-flex gap-14 py-3.5 animate-marquee font-mono text-[12px] tracking-wide text-ink-mute'>
        {items.map((t, i) => (
          <span key={i} className='inline-flex items-center gap-2'>
            <span className='text-ink-faint'>◇</span>
            <strong className='text-ink font-medium'>@{t.who}</strong>
            <span>{t.what}</span>
            <em className='not-italic text-accent'>{t.em}</em>
          </span>
        ))}
      </div>
    </div>
  )
}

function SectionHead({
  no,
  title,
  aside,
}: {
  no: string
  title: ReactNode
  aside?: string
}) {
  return (
    <div className='grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 md:gap-8 items-baseline pb-[clamp(36px,5vw,72px)]'>
      <span className='font-mono text-[11px] tracking-[0.18em] uppercase text-ink-mute'>
        § {no}
      </span>
      <h2 className='font-serif font-normal text-[clamp(30px,4.5vw,64px)] leading-none tracking-tight m-0'>
        {title}
      </h2>
      {aside && (
        <span className='font-mono text-[11px] tracking-[0.14em] uppercase text-ink-mute md:text-right'>
          {aside}
        </span>
      )}
    </div>
  )
}

function ActivityCard() {
  const W = 800
  const H = 180
  const line = buildChartPath(CHART, W, H)
  const area = buildAreaPath(CHART, W, H)
  return (
    <div className='relative border border-rule-strong bg-linear-to-b from-paper-2 to-paper rounded overflow-hidden'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:gap-6 items-start px-5 sm:px-8 py-6 sm:py-7 border-b border-rule'>
        <div>
          <div className='font-mono text-[11px] tracking-[0.16em] text-accent uppercase mb-2.5 flex items-center gap-2.5'>
            <LiveDot color='accent' />
            session · 2026-05-26
          </div>
          <h3 className='font-serif text-[clamp(26px,3vw,42px)] leading-[1.05] tracking-[-0.02em] m-0 text-ink'>
            {SESSION.title}
            <span className='block italic text-ink-mute text-[0.6em] mt-1.5'>
              {SESSION.subtitle}
            </span>
          </h3>
        </div>
        <div className='font-mono text-[12px] text-ink-mute flex flex-row sm:flex-col flex-wrap gap-x-4 gap-y-1.5 items-start sm:items-end whitespace-nowrap'>
          <span>
            <strong className='text-ink font-medium'>{SESSION.date}</strong>
          </span>
          <span>
            started{' '}
            <strong className='text-ink font-medium tnum'>
              {SESSION.startedAt}
            </strong>
          </span>
          <span>
            kudos <strong className='text-ink font-medium tnum'>· 18</strong>
          </span>
        </div>
      </div>

      <div className='grid grid-cols-2 md:grid-cols-4 border-b border-rule'>
        {[
          { label: 'Duration', value: SESSION.duration, delta: null },
          {
            label: 'Lines moved',
            value: SESSION.lines.toLocaleString(),
            unit: 'loc',
            delta: '+12%',
          },
          {
            label: 'Pace',
            value: SESSION.pace.toString(),
            unit: 'char/min',
            delta: null,
          },
          { label: 'Languages', value: '4', unit: '', delta: null },
        ].map((s, i) => (
          <div
            key={s.label}
            className={`px-5 sm:px-8 py-5 sm:py-6 ${i < 3 ? 'md:border-r' : ''} border-rule ${i < 2 ? 'border-b md:border-b-0' : ''} ${i === 1 ? 'border-r md:border-r' : ''}`}
          >
            <span className='block font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-mute mb-3.5'>
              {s.label}
            </span>
            <span className='flex items-baseline gap-1.5 font-serif text-[clamp(28px,3vw,44px)] leading-none tracking-[-0.02em] text-ink tnum'>
              {s.value}
              {s.unit && (
                <span className='font-mono text-[12px] tracking-wide text-ink-mute lowercase'>
                  {s.unit}
                </span>
              )}
              {s.delta && (
                <span className='font-mono text-[11px] text-live tracking-wide ml-1.5'>
                  {s.delta}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className='px-5 sm:px-8 py-6 sm:py-8'>
        <div className='flex justify-between items-baseline gap-3 mb-4 font-mono text-[11px] tracking-[0.14em] uppercase text-ink-mute'>
          <span>Keystrokes / minute</span>
          <span className='text-right'>
            peak <span className='text-ink tnum'>241</span> at{' '}
            <span className='text-ink tnum'>09:51</span>
          </span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className='w-full h-[140px] sm:h-[180px] block'
          preserveAspectRatio='none'
        >
          <defs>
            <linearGradient id='cfill' x1='0' x2='0' y1='0' y2='1'>
              <stop offset='0%' stopColor='#FF4D1A' stopOpacity='0.28' />
              <stop offset='100%' stopColor='#FF4D1A' stopOpacity='0' />
            </linearGradient>
            <pattern
              id='cgrid'
              width='50'
              height='40'
              patternUnits='userSpaceOnUse'
            >
              <path
                d='M50 0 L0 0 0 40'
                fill='none'
                stroke='#221f1a'
                strokeWidth='0.5'
              />
            </pattern>
          </defs>
          <rect width={W} height={H} fill='url(#cgrid)' />
          <path d={area} fill='url(#cfill)' />
          <path d={line} fill='none' stroke='#FF4D1A' strokeWidth='1.5' />
        </svg>
        <div className='grid grid-cols-4 sm:grid-cols-8 mt-2.5 font-mono text-[10px] text-ink-faint tracking-wider'>
          {[
            '08:42',
            '09:00',
            '09:20',
            '09:40',
            '10:00',
            '10:20',
            '10:40',
            '11:00',
          ].map((t, i) => (
            <span
              key={t}
              className={`tnum ${i % 2 === 1 ? 'hidden sm:block' : ''}`}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 border-t border-rule'>
        <div className='px-5 sm:px-8 py-6 border-b md:border-b-0 md:border-r border-rule'>
          <div className='font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-mute mb-3.5'>
            Languages
          </div>
          {SESSION.langs.map((l) => (
            <div
              key={l.name}
              className='grid grid-cols-[10px_1fr_auto] items-center gap-3 py-2 font-mono text-[12.5px] text-ink-soft border-b border-dashed border-rule last:border-b-0'
            >
              <span
                className='w-2.5 h-2.5 rounded-sm'
                style={{ background: l.swatch }}
              />
              <span>
                <strong className='text-ink font-medium'>{l.name}</strong>
              </span>
              <span className='tnum'>
                {l.time} · {l.pct}%
              </span>
            </div>
          ))}
        </div>
        <div className='px-5 sm:px-8 py-6'>
          <div className='font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-mute mb-3.5'>
            Most-touched files
          </div>
          {SESSION.files.map((f) => (
            <div
              key={f.name}
              className='grid grid-cols-[1fr_auto] items-baseline gap-3 py-2 font-mono text-[12.5px] text-ink-soft border-b border-dashed border-rule last:border-b-0'
            >
              <span className='truncate'>
                <span className='text-ink-mute'>{f.path}</span>
                <strong className='text-ink font-medium'>{f.name}</strong>
              </span>
              <span className='tnum'>{f.changes}∆</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Activity() {
  return (
    <section className='py-[clamp(56px,9vw,140px)]'>
      <div className='mx-auto max-w-[1320px] px-[clamp(20px,4vw,56px)]'>
        <SectionHead
          no='01'
          title={
            <>
              An <em className='italic text-accent'>activity</em>, not a
              screenshot.
            </>
          }
          aside='rendered live · sample data'
        />
        <ActivityCard />
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    {
      no: '01',
      title: (
        <>
          Install the <em className='italic text-accent'>extension.</em>
        </>
      ),
      ascii: `┌────────────┐\n│ ●  ●  ●    │\n├────────────┤\n│ > vscode   │\n└────────────┘`,
      body: "One click from the marketplace. Sign in with GitHub, pick a privacy level (every keystroke or just session totals), and you're logging.",
    },
    {
      no: '02',
      title: (
        <>
          Code <em className='italic text-accent'>as usual.</em>
        </>
      ),
      ascii: `┌──────┐   ┌──────┐   ┌──────┐\n│ keys │ → │ evt  │ → │ api  │\n└──────┘   └──────┘   └──────┘`,
      body: 'The extension batches activity locally and syncs it on a heartbeat. No project content ever leaves your machine — only metrics and file paths you allow.',
    },
    {
      no: '03',
      title: (
        <>
          Share, race, <em className='italic text-accent'>brag.</em>
        </>
      ),
      ascii: `◆ feed\n◇ leaderboard\n◇ profile`,
      body: 'Your sessions show up in a public feed (or a private one for your team). Streaks, podiums, and weekly recaps roll up automatically.',
    },
  ]

  return (
    <section className='py-[clamp(56px,9vw,140px)] border-t border-rule'>
      <div className='mx-auto max-w-[1320px] px-[clamp(20px,4vw,56px)]'>
        <SectionHead
          no='02'
          title={
            <>
              Three pieces. <em className='italic text-accent'>No fuss.</em>
            </>
          }
          aside='extension · api · web'
        />
        <div className='grid grid-cols-1 md:grid-cols-3 border-y border-rule'>
          {steps.map((s, i) => (
            <div
              key={s.no}
              className={`px-5 sm:px-8 py-8 sm:py-10 ${i < 2 ? 'md:border-r' : ''} ${i < 2 ? 'border-b md:border-b-0' : ''} border-rule`}
            >
              <div className='font-mono text-[11px] tracking-[0.16em] text-ink-mute flex items-center gap-3 mb-7'>
                <span>{s.no}</span>
                <span className='flex-1 h-px bg-rule' />
              </div>
              <pre className='font-mono text-[12px] leading-snug text-accent bg-paper-2 border border-rule px-4 py-3.5 rounded-[2px] mb-6 whitespace-pre overflow-x-auto'>
                {s.ascii}
              </pre>
              <h3 className='font-serif font-normal text-[28px] leading-tight tracking-[-0.015em] m-0 mb-3.5 text-ink'>
                {s.title}
              </h3>
              <p className='text-[14px] leading-relaxed text-ink-soft m-0 max-w-[36ch]'>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Leaderboard() {
  return (
    <section className='py-[clamp(56px,9vw,140px)] border-t border-rule'>
      <div className='mx-auto max-w-[1320px] px-[clamp(20px,4vw,56px)]'>
        <SectionHead
          no='03'
          title={
            <>
              This week's <em className='italic text-accent'>podium.</em>
            </>
          }
          aside='updated · 14 min ago'
        />
        <div className='border-y border-rule-strong'>
          <div className='grid grid-cols-[40px_1fr_auto] md:grid-cols-[56px_1.4fr_1fr_1fr_1fr_0.6fr_32px] items-center px-4 sm:px-6 py-3.5 gap-3 font-mono text-[10.5px] tracking-[0.14em] uppercase text-ink-mute bg-paper-2 border-b border-rule'>
            <span>Rank</span>
            <span>Athlete</span>
            <span className='text-right md:text-left'>Time</span>
            <span className='hidden md:block'>Top language</span>
            <span className='hidden md:block'>Streak</span>
            <span className='hidden md:block'>Region</span>
            <span className='hidden md:block' />
          </div>
          {LEADERS.map((row) => (
            <div
              key={row.handle}
              className={`group grid grid-cols-[40px_1fr_auto] md:grid-cols-[56px_1.4fr_1fr_1fr_1fr_0.6fr_32px] items-center px-4 sm:px-6 py-4 gap-3 border-b border-rule last:border-b-0 font-mono text-[13px] text-ink-soft relative transition-colors
                ${row.self ? 'bg-accent-soft' : 'hover:bg-paper-2'}`}
            >
              {row.self && (
                <span className='absolute left-0 top-0 bottom-0 w-0.5 bg-accent' />
              )}
              <span
                className={`font-serif text-[20px] sm:text-[22px] tracking-[-0.02em] tnum ${row.rank === 1 ? 'text-accent' : 'text-ink'}`}
              >
                {row.rank.toString().padStart(2, '0')}
              </span>
              <span className='flex items-center gap-2.5 sm:gap-3.5 min-w-0'>
                <span className='shrink-0 w-8 h-8 rounded-full bg-paper-3 border border-rule-strong font-serif text-[14px] text-ink grid place-items-center'>
                  {row.handle[0].toUpperCase()}
                </span>
                <span className='min-w-0'>
                  <span className='block text-ink font-medium truncate'>
                    @{row.handle}
                  </span>
                  <span className='block text-[11px] text-ink-mute mt-0.5 truncate'>
                    {row.sub}
                    <span className='md:hidden'>
                      {' · '}
                      {row.lang} · {row.streak}d
                    </span>
                  </span>
                </span>
              </span>
              <span className='tnum text-ink text-right md:text-left whitespace-nowrap'>
                {row.time}
              </span>
              <span className='hidden md:inline-flex items-center gap-2 text-[12px]'>
                <span
                  className='w-2 h-2 rounded-sm'
                  style={{ background: row.langDot }}
                />
                {row.lang}
              </span>
              <span className='hidden md:inline-flex items-center gap-1.5 text-ink'>
                <span className='w-1.5 h-1.5 bg-accent rounded-full' />
                <span className='tnum'>{row.streak}d</span>
              </span>
              <span className='hidden md:block text-[11px] text-ink-mute uppercase tracking-wider'>
                {row.sub}
              </span>
              <span className='hidden md:block text-accent font-mono text-[14px] text-right opacity-0 -translate-x-1 transition group-hover:opacity-100 group-hover:translate-x-0'>
                →
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Final() {
  return (
    <section className='py-[clamp(72px,12vw,200px)] text-center border-t border-rule relative'>
      <div className='mx-auto max-w-[1320px] px-[clamp(20px,4vw,56px)]'>
        <p className='font-mono text-[12px] tracking-[0.18em] uppercase text-ink-mute m-0 mb-9'>
          <LiveDot /> &nbsp; 2,841 athletes logging right now
        </p>
        <h2 className='font-serif font-normal text-[clamp(44px,9vw,140px)] leading-[0.95] tracking-[-0.035em] m-0 mb-10 mx-auto max-w-[14ch] text-ink'>
          Stop coding into the <em className='italic text-accent'>void.</em>
        </h2>
        <form
          onSubmit={(e) => e.preventDefault()}
          className='flex items-center gap-2 border border-rule-strong rounded-full p-1.5 pl-5 sm:pl-6 bg-paper-2 w-full max-w-[440px] mx-auto'
        >
          <input
            type='email'
            placeholder='you@dev.local'
            className='flex-1 min-w-0 bg-transparent border-0 outline-none text-ink font-mono text-[13px] py-3'
          />
          <button
            type='submit'
            className='group shrink-0 inline-flex items-center gap-2.5 h-[42px] px-4 sm:px-5 rounded-full font-mono text-[12px] uppercase tracking-wider font-medium bg-accent text-paper border border-accent hover:bg-ink hover:border-ink transition-colors'
          >
            <span className='hidden sm:inline'>Request access</span>
            <span className='sm:hidden'>Join</span>
            <span className='inline-block transition-transform group-hover:translate-x-1'>
              →
            </span>
          </button>
        </form>
        <p className='font-mono text-[11px] tracking-wider uppercase text-ink-mute mt-6'>
          free during early access · no card · leave anytime
        </p>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className='border-t border-rule pt-14 pb-8'>
      <div className='mx-auto max-w-[1320px] px-[clamp(20px,4vw,56px)]'>
        <div className='font-serif text-[clamp(120px,28vw,440px)] leading-[0.78] tracking-[-0.06em] text-ink m-0 mb-10'>
          commma<span className='text-accent'>.</span>
        </div>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-[11px] uppercase tracking-wider text-ink-mute pt-6 border-t border-rule'>
          <div className='space-x-5'>
            <a href='#' className='hover:text-ink'>
              Activity
            </a>
            <a href='#' className='hover:text-ink'>
              Leaderboards
            </a>
            <a href='#' className='hover:text-ink'>
              Profile
            </a>
          </div>
          <div className='md:text-center'>
            © 2026 commma labs · built in vscode (obviously)
          </div>
          <div className='md:text-right space-x-5'>
            <a href='#' className='hover:text-ink'>
              GitHub
            </a>
            <a href='#' className='hover:text-ink'>
              Privacy
            </a>
            <a href='#' className='hover:text-ink'>
              Status
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <>
      <Nav />
      <Hero />
      <Ticker />
      <Activity />
      <HowItWorks />
      <Leaderboard />
      <Final />
      <Footer />
    </>
  )
}
