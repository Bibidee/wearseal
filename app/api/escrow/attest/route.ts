import {NextResponse} from 'next/server';
import {createClient, createAccount} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createPublicClient, decodeFunctionData, getAddress, http, parseAbi, parseEventLogs, pad} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';

const escrowAbi = parseAbi([
  'function fund(bytes32 agreementId)',
  'function claim(bytes32 agreementId)',
  'function getPool(bytes32) view returns (uint256,uint256,bool)',
  'function getRefundState(bytes32) view returns (bool,bool,address,uint256)',
  'event Claimed(bytes32 indexed agreementId,address indexed recipient,uint256 amount)',
]);
const agreementAbi = parseAbi(['function get_agreement() view returns (address owner,address renter,string item_label,string serial_hash,string rubric,string checkout_url,string checkout_hash,uint256 deposit,uint256 minor_bps,uint256 material_bps,uint256 deadline,string status,string definition_hash,address vault,string return_url,string return_hash,string verdict,string same_item,string reason,string same_item_confidence,string new_damage_present,string damage_level,string damage_regions,uint256 reinspection_count)']);
const vaultAbi = parseAbi(['function get_vault() view returns (address agreement,address attestor,uint256 credited,bool settled,uint256 owner_claim,uint256 renter_claim,bool owner_claimed,bool renter_claimed,string funding_tx,string owner_claim_tx,string renter_claim_tx,string payout_mode)','function deposit(uint256 amount,string fundingTx)','function sync_funding()','function ack_owner_claim(string payoutTx)','function ack_renter_claim(string payoutTx)','function refund_cancelled(string payoutTx)']);

export async function POST(request: Request) {
  try {
    const body = await request.json() as {agreement?: string; kind?: string; tx?: string};
    if (!body.agreement || !/^0x[0-9a-fA-F]{40}$/.test(body.agreement) || !['funding','owner_claim','renter_claim','refund'].includes(body.kind || '')) return NextResponse.json({error: 'Invalid attestation request'}, {status: 400});
    const key = process.env.WEARSEAL_STUDIONET_PRIVATE_KEY;
    if (!key) return NextResponse.json({error: 'Studionet attestor is not configured'}, {status: 503});
    const escrow = (process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0x9d0baedb946036a99616c8abecc14f122e21e897') as `0x${string}`;
    const base = createPublicClient({chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')});
    const id = pad(getAddress(body.agreement) as `0x${string}`, {size: 32});
    const genlayer = createClient({chain: studionet});
    const agreement = await genlayer.readContract({address: getAddress(body.agreement), functionName: 'get_agreement', args: []}) as any;
    const vaultAddress = getAddress(String(agreement.vault));
    const vault = await genlayer.readContract({address: vaultAddress, functionName: 'get_vault', args: []}) as any;
    const attestor = privateKeyToAccount(key as `0x${string}`);
    if (getAddress(String(vault.attestor)) !== attestor.address || getAddress(String(vault.agreement)) !== getAddress(body.agreement)) return NextResponse.json({error: 'Vault attestor or Agreement binding mismatch'}, {status: 409});
    const genlayerWriter: any = createClient({chain: studionet, account: createAccount(key as `0x${string}`)});
    const already = body.kind === 'funding' ? String(agreement.status) === 'FUNDED' && BigInt(vault.credited) === BigInt(agreement.deposit)
      : body.kind === 'refund' ? Boolean(vault.renter_claimed)
      : body.kind === 'owner_claim' ? Boolean(vault.owner_claimed)
      : Boolean(vault.renter_claimed);
    if (already) return NextResponse.json({status: 'already_acknowledged', hash: null, readback: true});
    if (body.kind === 'funding' && String(agreement.status) === 'BASELINE_ACCEPTED' && BigInt(vault.credited) === BigInt(agreement.deposit)) {
      const hash = await genlayerWriter.writeContract({address: vaultAddress, functionName: 'sync_funding', args: []});
      const receipt: any = await genlayerWriter.waitForTransactionReceipt({hash, status: 'FINALIZED', retries: 220, interval: 5000});
      const execution = receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.txExecutionResultName;
      if (!/success|finished_with_return/i.test(String(execution)) || /error|failed/i.test(String(execution))) return NextResponse.json({error: 'Funding synchronization did not finalize successfully', hash}, {status: 502});
      const reflected = await genlayer.readContract({address: getAddress(body.agreement), functionName: 'get_agreement', args: []}) as any;
      if (String(reflected.status) !== 'FUNDED') return NextResponse.json({error: 'Funding synchronization finalized without authoritative Agreement readback', hash}, {status: 502});
      return NextResponse.json({status: 'synchronized', hash, readback: true});
    }
    if (!body.tx || !/^0x[0-9a-fA-F]{64}$/.test(body.tx)) return NextResponse.json({error: 'A verified Base transaction hash is required for this acknowledgement'}, {status: 400});
    const baseReceipt = await base.getTransactionReceipt({hash: body.tx as `0x${string}`});
    const transaction = await base.getTransaction({hash: body.tx as `0x${string}`});
    if (baseReceipt.status !== 'success' || getAddress(String(transaction.to)) !== getAddress(escrow)) return NextResponse.json({error: 'Base transaction is not a finalized success on the canonical escrow'}, {status: 409});
    const decoded = decodeFunctionData({abi: escrowAbi, data: transaction.input});
    if (String(decoded.args?.[0]).toLowerCase() !== id.toLowerCase()) return NextResponse.json({error: 'Base transaction targets a different Agreement'}, {status: 409});
    if (body.kind === 'funding') {
      if (decoded.functionName !== 'fund' || getAddress(String(transaction.from)) !== getAddress(String(agreement.renter)) || transaction.value !== BigInt(agreement.deposit)) return NextResponse.json({error: 'Funding transaction does not match the renter or exact deposit'}, {status: 409});
      const pool = await base.readContract({address: escrow, abi: escrowAbi, functionName: 'getPool', args: [id]});
      if (pool[0] !== BigInt(agreement.deposit) || pool[1] !== 0n || pool[2]) return NextResponse.json({error: 'Base collateral readback is not an unfunded exact pool'}, {status: 409});
      const hash = await genlayerWriter.writeContract({address: vaultAddress, functionName: 'deposit', args: [BigInt(agreement.deposit), body.tx]});
      const receipt: any = await (genlayerWriter as any).waitForTransactionReceipt({hash, status: 'FINALIZED', retries: 220, interval: 5000});
      const execution = receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.txExecutionResultName;
      if (!/success|finished_with_return/i.test(String(execution)) || /error|failed/i.test(String(execution))) return NextResponse.json({error: 'Funding acknowledgement did not finalize successfully', hash}, {status: 502});
      const reflected = await genlayer.readContract({address: getAddress(body.agreement), functionName: 'get_agreement', args: []}) as any;
      const reflectedVault = await genlayer.readContract({address: vaultAddress, functionName: 'get_vault', args: []}) as any;
      if (String(reflected.status) !== 'FUNDED' || BigInt(reflectedVault.credited) !== BigInt(agreement.deposit)) return NextResponse.json({error: 'Funding acknowledgement finalized without authoritative readback', hash}, {status: 502});
      return NextResponse.json({status: 'acknowledged', hash, readback: true});
    }
    if (body.kind === 'refund') {
      if (decoded.functionName !== 'claim' || String(agreement.status) !== 'CANCELLED' || vault.settled || BigInt(vault.credited) <= 0n) return NextResponse.json({error: 'Refund transaction is not valid for the cancelled Agreement'}, {status: 409});
      if (getAddress(String(transaction.from)) !== getAddress(String(agreement.renter))) return NextResponse.json({error: 'Refund claimant is not the renter'}, {status: 409});
      const logs = parseEventLogs({abi: escrowAbi, logs: baseReceipt.logs, eventName: 'Claimed'});
      const claimed = logs.find(log => getAddress(String(log.args.recipient)) === getAddress(String(agreement.renter)) && String(log.args.agreementId).toLowerCase() === id.toLowerCase());
      if (!claimed || BigInt(claimed.args.amount) !== BigInt(vault.credited)) return NextResponse.json({error: 'Refund amount does not match authoritative Vault credit'}, {status: 409});
      const hash = await genlayerWriter.writeContract({address: vaultAddress, functionName: 'refund_cancelled', args: [body.tx], leaderOnly: true});
      const genReceipt: any = await (genlayerWriter as any).waitForTransactionReceipt({hash, status: 'FINALIZED', retries: 220, interval: 5000});
      const execution = genReceipt.consensus_data?.leader_receipt?.[0]?.execution_result || genReceipt.txExecutionResultName;
      if (!/success|finished_with_return/i.test(String(execution)) || /error|failed/i.test(String(execution))) return NextResponse.json({error: 'Refund acknowledgement did not finalize successfully', hash}, {status: 502});
      const reflected = await genlayer.readContract({address: vaultAddress, functionName: 'get_vault', args: []}) as any;
      if (!reflected.renter_claimed) return NextResponse.json({error: 'Refund acknowledgement finalized without authoritative readback', hash}, {status: 502});
      return NextResponse.json({status: 'acknowledged', hash, readback: true});
    }
    if (decoded.functionName !== 'claim') return NextResponse.json({error: 'Claim attestation requires a claim transaction'}, {status: 409});
    const logs = parseEventLogs({abi: escrowAbi, logs: baseReceipt.logs, eventName: 'Claimed'});
    const claimed = logs.find(log => getAddress(String(log.args.recipient)) === getAddress(String(body.kind === 'owner_claim' ? agreement.owner : agreement.renter)) && String(log.args.agreementId).toLowerCase() === id.toLowerCase());
    if (!claimed) return NextResponse.json({error: 'No matching finalized payout event found'}, {status: 409});
    if (body.kind === 'owner_claim' && vault.owner_claimed) return NextResponse.json({error: 'Owner claim is already acknowledged'}, {status: 409});
    if (body.kind === 'renter_claim' && vault.renter_claimed) return NextResponse.json({error: 'Renter claim is already acknowledged'}, {status: 409});
    const expected = BigInt(body.kind === 'owner_claim' ? vault.owner_claim : vault.renter_claim);
    if (BigInt(claimed.args.amount) !== expected || getAddress(String(transaction.from)) !== getAddress(String(body.kind === 'owner_claim' ? agreement.owner : agreement.renter))) return NextResponse.json({error: 'Claim amount or recipient does not match authoritative Vault state'}, {status: 409});
    const functionName = body.kind === 'owner_claim' ? 'ack_owner_claim' : 'ack_renter_claim';
    const hash = await genlayerWriter.writeContract({address: vaultAddress, functionName, args: [body.tx], leaderOnly: true});
    const genReceipt: any = await (genlayerWriter as any).waitForTransactionReceipt({hash, status: 'FINALIZED', retries: 220, interval: 5000});
    const execution = genReceipt.consensus_data?.leader_receipt?.[0]?.execution_result || genReceipt.txExecutionResultName;
    if (!/success|finished_with_return/i.test(String(execution)) || /error|failed/i.test(String(execution))) return NextResponse.json({error: 'Claim acknowledgement did not finalize successfully', hash}, {status: 502});
    const reflected = await genlayer.readContract({address: vaultAddress, functionName: 'get_vault', args: []}) as any;
    if ((body.kind === 'owner_claim' && !reflected.owner_claimed) || (body.kind === 'renter_claim' && !reflected.renter_claimed)) return NextResponse.json({error: 'Claim acknowledgement finalized without authoritative readback', hash}, {status: 502});
    return NextResponse.json({status: 'acknowledged', hash, readback: true});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500}); }
}
