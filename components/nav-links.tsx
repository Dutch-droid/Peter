'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>{l.label}</Link>;
      })}
    </>
  );
}
