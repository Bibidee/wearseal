'use client';
/* eslint-disable react-hooks/set-state-in-effect */
import {createContext, useContext, useEffect, useState} from 'react';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {isStudionet, STUDIONET} from '../genlayer/network';
import {BASE_CHAIN_ID} from '../base-escrow';

export type Provider = {request(a: {method: string; params?: unknown[]}): Promise<unknown>; on?(e: string, f: (...a: any[]) => void): void; removeListener?(e: string, f: (...a: any[]) => void): void};

const isUnknownChain = (error: unknown) => {
  const value = error as {code?: number; message?: string; data?: {originalError?: {code?: number; message?: string}}} | undefined;
  return value?.code === 4902 || value?.data?.originalError?.code === 4902 || /unrecognized chain id|unknown chain/i.test(`${value?.message || ''} ${value?.data?.originalError?.message || ''}`);
};

export async function ensureStudionet(provider: Provider) {
  try {
    await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: `0x${STUDIONET.id.toString(16)}`}]});
  } catch (error) {
    if (!isUnknownChain(error)) throw error;
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
    setAccount(undefined);
    setError('');
  };

  const switchStudionet = async () => {
    if (!provider) throw Error('No injected wallet found');
    await ensureStudionet(provider);
    setChainId(await provider.request({method: 'eth_chainId'}) as string);
  };

  const switchBaseSepolia = async () => {
    if (!provider) throw Error('No injected wallet found');
    try { await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: `0x${BASE_CHAIN_ID.toString(16)}`}]}); }
    catch (error) {
      if (!isUnknownChain(error)) throw error;
      await provider.request({method: 'wallet_addEthereumChain', params: [{chainId: `0x${BASE_CHAIN_ID.toString(16)}`, chainName: 'Base Sepolia', nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org']}]});
      await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: `0x${BASE_CHAIN_ID.toString(16)}`}]});
    }
    setChainId(await provider.request({method: 'eth_chainId'}) as string);
  };

  const client = provider && account ? createClient({chain: studionet, account, provider}) : undefined;
  return <C.Provider value={{account, chainId, client, provider, connect, disconnect, switchStudionet, switchBaseSepolia, error, onStudionet: isStudionet(chainId), onBaseSepolia: chainId === `0x${BASE_CHAIN_ID.toString(16)}`}}>{children}</C.Provider>;
}

export const useWallet = () => useContext(C);
