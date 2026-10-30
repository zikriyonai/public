import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div>
        <img src="/zikriyon.png" alt="Zikriyon AI" width={96} height={96} style={{ borderRadius: '50%' }} />
        <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '16px 0 6px' }}>404</h1>
        <p style={{ color: '#64748b', marginBottom: 20 }}>This page does not exist.</p>
        <Link href="/" style={{ background: 'linear-gradient(135deg,#080BFF,#026692)', color: '#fff', padding: '12px 22px', borderRadius: 14, fontWeight: 700, textDecoration: 'none' }}>
          Back to Zikriyon AI
        </Link>
      </div>
    </main>
  );
}
