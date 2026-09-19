import {baseSepolia} from 'viem/chains';
import {createPublicClient, encodeFunctionData, http, pad, type Hex} from 'viem';

export const BASE_CHAIN_ID = 84532;
export const BASE_ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0x562f1fc218beccb9e525d148618526a03ae7aa9e') as `0x${string}`;
export const basePublicClient = createPublicClient({chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')});
export const escrowAbi = [
  {type: 'function', name: 'fund', stateMutability: 'payable', inputs: [{name: 'agreementId', type: 'bytes32'}], outputs: []},
  {type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{name: 'agreementId', type: 'bytes32'}], outputs: []},
  {type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{name: 'agreementId', type: 'bytes32'}], outputs: [{type: 'uint256'}, {type: 'uint256'}, {type: 'bool'}]},
  {type: 'function', name: 'getClaimable', stateMutability: 'view', inputs: [{name: 'agreementId', type: 'bytes32'}, {name: 'recipient', type: 'address'}], outputs: [{type: 'uint256'}]},
] as const;

export function agreementKey(address: string): Hex { return pad(address as `0x${string}`, {size: 32}); }
export function fundData(address: string): Hex { return encodeFunctionData({abi: escrowAbi, functionName: 'fund', args: [agreementKey(address)]}); }
export function claimData(address: string): Hex { return encodeFunctionData({abi: escrowAbi, functionName: 'claim', args: [agreementKey(address)]}); }
export function explorerTx(hash: string) { return `https://sepolia.basescan.org/tx/${hash}`; }
export function explorerAddress(address: string) { return `https://sepolia.basescan.org/address/${address}`; }

export async function readBasePool(address: string) {
  const [deposited, allocated, payoutSet] = await basePublicClient.readContract({address: BASE_ESCROW_ADDRESS, abi: escrowAbi, functionName: 'getPool', args: [agreementKey(address)]});
  return {deposited, allocated, payoutSet};
}
export async function readBaseClaimable(address: string, recipient: `0x${string}`) {
  return basePublicClient.readContract({address: BASE_ESCROW_ADDRESS, abi: escrowAbi, functionName: 'getClaimable', args: [agreementKey(address), recipient]});
}
export async function sendBase(provider: {request(a: {method: string; params?: unknown[]}): Promise<unknown>}, account: `0x${string}`, data: Hex, value = '0x0') {
  return provider.request({method: 'eth_sendTransaction', params: [{from: account, to: BASE_ESCROW_ADDRESS, data, value}]}) as Promise<string>;
}

export async function waitBaseReceipt(provider: {request(a: {method: string; params?: unknown[]}): Promise<unknown>}, hash: string) {
  for (let i = 0; i < 120; i++) {
    const receipt = await provider.request({method: 'eth_getTransactionReceipt', params: [hash]}) as {status?: string} | null;
    if (receipt) { if (receipt.status !== '0x1') throw Error('Base Sepolia transaction reverted.'); return receipt; }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw Error('Base Sepolia transaction did not finalize in time.');
}
