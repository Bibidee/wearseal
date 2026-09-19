import {NextResponse} from 'next/server';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createPublicClient, decodeFunctionData, getAddress, http, pad, parseAbi, parseEventLogs} from 'viem';
import {baseSepolia} from 'viem/chains';

const escrow = (process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0xcc4d1db40a7b1ccd1ab3fed6e7b35f541c3f40ab') as `0x${string}`;
const base = createPublicClient({chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')});
const events = parseAbi([
  'event Funded(bytes32 indexed agreementId,address indexed from,uint256 amount)',
  'event Claimed(bytes32 indexed agreementId,address indexed recipient,uint256 amount)',
  'event RefundAuthorized(bytes32 indexed agreementId,address indexed renter,uint256 amount)',
]);
const functionAbi = parseAbi(['function fund(bytes32 agreementId)']);
const escrowDeployment = '0x451247fc20a315c645b20440e509a577d8d3e3192190722b2b277f922050275d' as `0x${string}`;

async function firstTx<T extends {transactionHash: `0x${string}`; blockNumber: bigint}>(logs: T[], predicate: (log: T) => boolean) {
  const matching = logs.filter(predicate).sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return matching[0]?.transactionHash || null;
}

async function scanLogs(event: (typeof events)[number], fromBlock: bigint, head: bigint) {
  const chunkSize = 2000n;
  const logs: Array<any> = [];
  for (let start = fromBlock; start <= head; start += chunkSize) {
    const end = start + chunkSize - 1n < head ? start + chunkSize - 1n : head;
    const chunk = await base.getLogs({address: escrow, event, fromBlock: start, toBlock: end});
    logs.push(...chunk);
  }
  return logs;
}

async function verifyFundingReceipt(hash: `0x${string}`, agreementId: `0x${string}`, renter: string, deposit: bigint) {
  const receipt = await base.getTransactionReceipt({hash});
  const transaction = await base.getTransaction({hash});
  if (receipt.status !== 'success' || getAddress(String(transaction.to)) !== getAddress(escrow) || getAddress(String(transaction.from)) !== getAddress(renter) || transaction.value !== deposit) throw new Error('Candidate funding transaction is not a successful exact payment to the canonical escrow.');
  const decoded = decodeFunctionData({abi: functionAbi, data: transaction.input});
  if (String(decoded.functionName) !== 'fund' || String(decoded.args?.[0]).toLowerCase() !== agreementId.toLowerCase()) throw new Error('Candidate funding transaction targets a different Agreement.');
  const logs = parseEventLogs({abi: events, logs: receipt.logs, eventName: 'Funded'});
  const funded = logs.find(log => String(log.args.agreementId).toLowerCase() === agreementId.toLowerCase() && getAddress(String(log.args.from)) === getAddress(renter) && BigInt(log.args.amount) === deposit);
  if (!funded) throw new Error('Candidate funding transaction has no matching Funded event.');
  return hash;
}

export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get('agreement');
    if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return NextResponse.json({error: 'Agreement address is required'}, {status: 400});
    const agreementAddress = getAddress(raw);
    const agreementId = pad(agreementAddress as `0x${string}`, {size: 32});
    const genlayer = createClient({chain: studionet});
    const state = await genlayer.readContract({address: agreementAddress, functionName: 'get_agreement', args: []}) as any;
    let vault: any = null;
    let vaultError = '';
    if (state?.vault) {
      try { vault = await genlayer.readContract({address: getAddress(String(state.vault)), functionName: 'get_vault', args: []}) as any; }
      catch (error) { vaultError = error instanceof Error ? error.message : String(error); }
    }
    const renter = state?.renter ? getAddress(String(state.renter)) : null;
    const owner = state?.owner ? getAddress(String(state.owner)) : null;
    const poolAbi = parseAbi(['function getPool(bytes32) view returns (uint256,uint256,bool)']);
    const pool = await base.readContract({address: escrow, abi: poolAbi, functionName: 'getPool', args: [agreementId]});
    const deployment = await base.getTransactionReceipt({hash: escrowDeployment});
    const fromBlock = deployment.blockNumber;
    const head = await base.getBlockNumber();
    const candidate = new URL(request.url).searchParams.get('tx');
    let funded: any[] = [], claimed: any[] = [], refundAuthorized: any[] = [], scanError = '';
    try { [funded, claimed, refundAuthorized] = await Promise.all([scanLogs(events[0], fromBlock, head), scanLogs(events[1], fromBlock, head), scanLogs(events[2], fromBlock, head)]); } catch (error) { scanError = error instanceof Error ? error.message : String(error); }
    let fundingTx = await firstTx(funded, log => renter ? String(log.args.agreementId).toLowerCase() === agreementId.toLowerCase() && getAddress(String(log.args.from)) === renter && BigInt(log.args.amount ?? 0n) === BigInt(state?.deposit || 0) : false);
    if (!fundingTx && candidate && /^0x[0-9a-fA-F]{64}$/.test(candidate) && renter) fundingTx = await verifyFundingReceipt(candidate as `0x${string}`, agreementId, renter, BigInt(state?.deposit || 0));
    if (!fundingTx && scanError) return NextResponse.json({error: `Base escrow event recovery unavailable: ${scanError}`, poolDeposited: String(pool[0])}, {status: 502});
    const ownerClaimTx = await firstTx(claimed, log => owner ? String(log.args.agreementId).toLowerCase() === agreementId.toLowerCase() && getAddress(String(log.args.recipient)) === owner && BigInt(log.args.amount ?? 0n) === BigInt(vault?.owner_claim || 0) : false);
    const renterClaimTx = await firstTx(claimed, log => renter ? String(log.args.agreementId).toLowerCase() === agreementId.toLowerCase() && getAddress(String(log.args.recipient)) === renter && BigInt(log.args.amount ?? 0n) === BigInt(vault?.renter_claim || state?.deposit || 0) : false);
    const refundTx = await firstTx(claimed, log => renter ? String(log.args.agreementId).toLowerCase() === agreementId.toLowerCase() && getAddress(String(log.args.recipient)) === renter && BigInt(log.args.amount ?? 0n) === BigInt(vault?.credited || state?.deposit || 0) : false);
    const authorizationTx = await firstTx(refundAuthorized, log => renter ? String(log.args.agreementId).toLowerCase() === agreementId.toLowerCase() && getAddress(String(log.args.renter)) === renter : false);
    return NextResponse.json({
      agreement: agreementAddress,
      vault: state?.vault || null,
      baseEscrow: escrow,
      fundingTx,
      ownerClaimTx: String(state?.status) === 'SETTLED' ? ownerClaimTx : null,
      renterClaimTx: String(state?.status) === 'SETTLED' ? renterClaimTx : null,
      refundTx: String(state?.status) === 'CANCELLED' ? refundTx : null,
      authorizationTx,
      vaultError: vaultError || null,
      state: {agreement: state?.status || null, credited: String(vault?.credited || 0), settled: Boolean(vault?.settled), ownerClaimed: Boolean(vault?.owner_claimed), renterClaimed: Boolean(vault?.renter_claimed), poolDeposited: String(pool[0])},
    });
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500});
  }
}
