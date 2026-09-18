'use client';
import {useWallet} from '../lib/wallet/provider';

export default function WalletBar() {
  const wallet = useWallet();
  if (!wallet?.account) return <button className="wallet-button" onClick={wallet?.connect}>CONNECT WALLET</button>;
  return <div className="wallet-bar">
    <span className={`network-dot ${wallet.onStudionet ? '' : 'wrong'}`}/>
    <span>{wallet.onStudionet ? 'STUDIONET 61999' : 'WRONG NETWORK'}</span>
    <span>{wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</span>
    <button className="wallet-button" onClick={wallet.disconnect} aria-label="Disconnect wallet">DISCONNECT</button>
    {wallet.error && <span className="orange">{wallet.error}</span>}
  </div>;
}
