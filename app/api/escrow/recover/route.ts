import {NextResponse} from 'next/server';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createPublicClient, getAddress, http, pad, parseAbi} from 'viem';
import {baseSepolia} from 'viem/chains';

const escrow = (process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0xcc4d1db40a7b1ccd1ab3fed6e7b35f541c3f40ab') as `0x${string}`;
const base = createPublicClient({chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')});
const events = parseAbi([
  'event Funded(bytes32 indexed agreementId,address indexed from,uint256 amount)',
  'event Claimed(bytes32 indexed agreementId,address indexed recipient,uint256 amount)',
  'event RefundAuthorized(bytes32 indexed agreementId,address indexed renter,uint256 amount)',
]);
const escrowDeployment = '0x451247fc20a315c645b20440e509a577d8d3e3192190722b2b277f922050275d' as `0x${string}`;

async function firstTx<T extends {transactionHash: `0x${string}`; blockNumber: bigint}>(logs: T[], predicate: (log: T) => boolean) {
  const matching = logs.filter(predicate).sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return matching[0]?.transactionHash || null;
}

export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get('agreement');
    if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return NextResponse.json({error: 'Agreement address is required'}, {status: 400});
    const agreementAddress = getAddress(raw);
    const agreementId = pad(agreementAddress as `0x${string}`, {size: 32});
    const deployment = await base.getTransactionReceipt({hash: escrowDeployment});
    const fromBlock = deployment.blockNumber;
    const [funded, claimed, refundAuthorized] = await Promise.all([
      base.getLogs({address: escrow, event: events[0], args: {agreementId}, fromBlock}),
      base.getLogs({address: escrow, event: events[1], args: {agreementId}, fromBlock}),
      base.getLogs({address: escrow, event: events[2], args: {agreementId}, fromBlock}),
    ]);
    const genlayer = createClient({chain: studionet});
    const state = await genlayer.readContract({address: agreementAddress, functionName: 'get_agreement', args: []}) as any;
    const vault = state?.vault ? await genlayer.readContract({address: getAddress(String(state.vault)), functionName: 'get_vault', args: []}) as any : null;
    const renter = state?.renter ? getAddress(String(state.renter)) : null;
    const owner = state?.owner ? getAddress(String(state.owner)) : null;
    const fundingTx = await firstTx(funded, log => renter ? getAddress(String(log.args.from)) === renter && BigInt(log.args.amount ?? 0n) === BigInt(state?.deposit || 0) : false);
    const ownerClaimTx = await firstTx(claimed, log => owner ? getAddress(String(log.args.recipient)) === owner && BigInt(log.args.amount ?? 0n) === BigInt(vault?.owner_claim || 0) : false);
    const renterClaimTx = await firstTx(claimed, log => renter ? getAddress(String(log.args.recipient)) === renter && BigInt(log.args.amount ?? 0n) === BigInt(vault?.renter_claim || state?.deposit || 0) : false);
    const refundTx = await firstTx(claimed, log => renter ? getAddress(String(log.args.recipient)) === renter && BigInt(log.args.amount ?? 0n) === BigInt(vault?.credited || state?.deposit || 0) : false);
    const authorizationTx = await firstTx(refundAuthorized, log => renter ? getAddress(String(log.args.renter)) === renter : false);
    return NextResponse.json({
      agreement: agreementAddress,
      baseEscrow: escrow,
      fundingTx,
      ownerClaimTx: String(state?.status) === 'SETTLED' ? ownerClaimTx : null,
      renterClaimTx: String(state?.status) === 'SETTLED' ? renterClaimTx : null,
      refundTx: String(state?.status) === 'CANCELLED' ? refundTx : null,
      authorizationTx,
      state: {agreement: state?.status || null, credited: String(vault?.credited || 0), settled: Boolean(vault?.settled), ownerClaimed: Boolean(vault?.owner_claimed), renterClaimed: Boolean(vault?.renter_claimed)},
    });
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500});
  }
}
