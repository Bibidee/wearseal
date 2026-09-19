import {NextResponse} from 'next/server';
import {createWalletClient, http, parseAbi, publicActions} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';
import {pad} from 'viem';

const abi = parseAbi(['function setPayout(bytes32,address,uint256,address,uint256)']);

export async function POST(request: Request) {
  try {
    const body = await request.json() as {agreement: string; owner: string; ownerAmount: string; renter: string; renterAmount: string};
    const key = process.env.WEARSEAL_BASE_PRIVATE_KEY;
    const escrow = process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0x562f1fc218beccb9e525d148618526a03ae7aa9e';
    if (!key) return NextResponse.json({error: 'Base escrow relayer is not configured'}, {status: 503});
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.agreement) || !/^0x[0-9a-fA-F]{40}$/.test(body.owner) || !/^0x[0-9a-fA-F]{40}$/.test(body.renter)) return NextResponse.json({error: 'Invalid payout address'}, {status: 400});
    const account = privateKeyToAccount(key as `0x${string}`);
    const client = createWalletClient({account, chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')}).extend(publicActions);
    const hash = await client.writeContract({address: escrow as `0x${string}`, abi, functionName: 'setPayout', args: [pad(body.agreement as `0x${string}`, {size: 32}), body.owner as `0x${string}`, BigInt(body.ownerAmount), body.renter as `0x${string}`, BigInt(body.renterAmount)]});
    const receipt = await client.waitForTransactionReceipt({hash});
    if (receipt.status !== 'success') return NextResponse.json({error: 'Payout allocation reverted', hash}, {status: 502});
    return NextResponse.json({hash});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500}); }
}
