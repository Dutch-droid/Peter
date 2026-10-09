'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <>
      {links.map((l) => {
        // /leave must not stay highlighted on /leave/calendar, which has its own entry.
        const active = l.href === '/' ? path === '/' : l.href === '/leave' ? path === '/leave' : path.startsWith(l.href);
        return <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>{l.label}</Link>;
      })}
    </>
  );
}
