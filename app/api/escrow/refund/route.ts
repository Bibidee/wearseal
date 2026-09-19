import {NextResponse} from 'next/server';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createPublicClient, createWalletClient, getAddress, http, pad, parseAbi, publicActions} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';

const escrowAbi = parseAbi([
  'function authorizeRefund(bytes32 agreementId,address renter,uint256 amount)',
  'function getPool(bytes32) view returns (uint256,uint256,bool)',
  'function getRefundState(bytes32) view returns (bool,bool,address,uint256)',
]);
export async function POST(request: Request) {
  try {
    const body = await request.json() as {agreement?: string};
    const key = process.env.WEARSEAL_BASE_PRIVATE_KEY;
    const escrow = (process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0x9d0baedb946036a99616c8abecc14f122e21e897') as `0x${string}`;
    if (!key) return NextResponse.json({error: 'Base escrow relayer is not configured'}, {status: 503});
    if (!body.agreement || !/^0x[0-9a-fA-F]{40}$/.test(body.agreement)) return NextResponse.json({error: 'Agreement address is required'}, {status: 400});
    const agreementAddress = getAddress(body.agreement);
    const genlayer = createClient({chain: studionet});
    const agreement = await genlayer.readContract({address: agreementAddress, functionName: 'get_agreement', args: []}) as any;
    if (String(agreement.status) !== 'CANCELLED') return NextResponse.json({error: 'Agreement is not authoritatively cancelled'}, {status: 409});
    if (!agreement.vault || /^0x0+$/.test(String(agreement.vault))) return NextResponse.json({error: 'Agreement has no bound Vault'}, {status: 409});
    const vault = await genlayer.readContract({address: getAddress(String(agreement.vault)), functionName: 'get_vault', args: []}) as any;
    if (getAddress(String(vault.agreement)) !== agreementAddress || vault.settled || BigInt(vault.credited) !== BigInt(agreement.deposit)) return NextResponse.json({error: 'Vault is not eligible for a full cancellation refund'}, {status: 409});
    const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org');
    const base = createPublicClient({chain: baseSepolia, transport});
    const account = privateKeyToAccount(key as `0x${string}`);
    const client = createWalletClient({account, chain: baseSepolia, transport}).extend(publicActions);
    const id = pad(agreementAddress as `0x${string}`, {size: 32});
    const pool = await base.readContract({address: escrow, abi: escrowAbi, functionName: 'getPool', args: [id]});
    const refundState = await base.readContract({address: escrow, abi: escrowAbi, functionName: 'getRefundState', args: [id]});
    if (pool[0] !== BigInt(agreement.deposit) || pool[1] !== 0n || pool[2] || !refundState[0] || refundState[1] || getAddress(refundState[2]) !== getAddress(String(agreement.renter)) || refundState[3] !== BigInt(agreement.deposit)) return NextResponse.json({error: 'Base escrow cancellation readback is not eligible'}, {status: 409});
    const hash = await client.writeContract({address: escrow, abi: escrowAbi, functionName: 'authorizeRefund', args: [id, getAddress(String(agreement.renter)), BigInt(agreement.deposit)]});
    const receipt = await client.waitForTransactionReceipt({hash});
    if (receipt.status !== 'success') return NextResponse.json({error: 'Refund authorization reverted', hash}, {status: 502});
    return NextResponse.json({hash, renter: agreement.renter, amount: String(agreement.deposit)});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500}); }
}
