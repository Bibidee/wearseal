'use client';
import Link from 'next/link';import WalletBar from './wallet-bar';
export default function SiteNav(){return <nav className="site-nav"><Link className="brand" href="/"><span className="brand-mark">W</span><span>WEARSEAL</span><small>CONDITION PROTOCOL</small></Link><div className="nav-links"><Link href="/agreements">Agreements</Link><Link href="/new">New agreement</Link><Link href="/verify">Verify evidence</Link><a href="#how-it-works">How it works</a></div><WalletBar/></nav>}
