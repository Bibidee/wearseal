'use client';
/* eslint-disable react-hooks/set-state-in-effect */
import {createContext, useContext, useEffect, useState} from 'react';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {isStudionet, STUDIONET} from '../genlayer/network';

export type Provider = {request(a: {method: string; params?: unknown[]}): Promise<unknown>; on?(e: string, f: (...a: any[]) => void): void; removeListener?(e: string, f: (...a: any[]) => void): void};

export async function ensureStudionet(provider: Provider) {
  try {
    await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: `0x${STUDIONET.id.toString(16)}`}]});
  } catch (error) {
    if ((error as {code?: number}).code !== 4902) throw error;
    await provider.request({method: 'wallet_addEthereumChain', params: [{chainId: `0x${STUDIONET.id.toString(16)}`, chainName: STUDIONET.name, nativeCurrency: {name: 'GEN', symbol: 'GEN', decimals: 18}, rpcUrls: [STUDIONET.rpcUrl], blockExplorerUrls: [STUDIONET.explorer]}]});
    await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: `0x${STUDIONET.id.toString(16)}`}]});
  }
}

const C = createContext<any>(null);

export function WalletProvider({children}: {children: React.ReactNode}) {
  const [provider, setProvider] = useState<Provider>();
  const [account, setAccount] = useState<`0x${string}`>();
  const [chainId, setChainId] = useState<string>();
  const [error, setError] = useState('');

  useEffect(() => {
    const injected = (window as any).ethereum as Provider | undefined;
    setProvider(injected);
    if (!injected) return;
    const sync = async () => {
      setAccount(((await injected.request({method: 'eth_accounts'})) as string[])[0] as `0x${string}`);
      setChainId(await injected.request({method: 'eth_chainId'}) as string);
    };
    void sync();
    const accountsChanged = (accounts: string[]) => setAccount(accounts[0] as `0x${string}`);
    const chainChanged = (chain: string) => setChainId(chain);
    injected.on?.('accountsChanged', accountsChanged);
    injected.on?.('chainChanged', chainChanged);
    return () => { injected.removeListener?.('accountsChanged', accountsChanged); injected.removeListener?.('chainChanged', chainChanged); };
  }, []);

  const connect = async () => {
    try {
      setError('');
      if (!provider) throw Error('No injected wallet found');
      await provider.request({method: 'eth_requestAccounts'});
      await ensureStudionet(provider);
      setAccount(((await provider.request({method: 'eth_accounts'})) as string[])[0] as `0x${string}`);
      setChainId(await provider.request({method: 'eth_chainId'}) as string);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };

  const disconnect = async () => {
    try { await provider?.request({method: 'wallet_revokePermissions', params: [{eth_accounts: {}}]}); } catch { /* Some wallets do not expose permission revocation. */ }
    setAccount(undefined);
    setError('');
  };

  const client = provider && account ? createClient({chain: studionet, account, provider}) : undefined;
  return <C.Provider value={{account, chainId, client, connect, disconnect, error, onStudionet: isStudionet(chainId)}}>{children}</C.Provider>;
}

export const useWallet = () => useContext(C);
