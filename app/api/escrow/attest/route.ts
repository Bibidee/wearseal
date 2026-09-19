import {NextResponse} from 'next/server';
import {createClient, createAccount} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createPublicClient, createWalletClient, decodeFunctionData, getAddress, http, parseAbi, parseEventLogs, pad, publicActions} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';

const escrowAbi = parseAbi([
  'function fund(bytes32 agreementId)',
  'function claim(bytes32 agreementId)',
  'function getPool(bytes32) view returns (uint256,uint256,bool)',
  'event Claimed(bytes32 indexed agreementId,address indexed recipient,uint256 amount)',
]);
const agreementAbi = parseAbi(['function get_agreement() view returns (address owner,address renter,string item_label,string serial_hash,string rubric,string checkout_url,string checkout_hash,uint256 deposit,uint256 minor_bps,uint256 material_bps,uint256 deadline,string status,string definition_hash,address vault,string return_url,string return_hash,string verdict,string same_item,string reason,string same_item_confidence,string new_damage_present,string damage_level,string damage_regions,uint256 reinspection_count)']);
const vaultAbi = parseAbi(['function get_vault() view returns (address agreement,address attestor,uint256 credited,bool settled,uint256 owner_claim,uint256 renter_claim,bool owner_claimed,bool renter_claimed,string funding_tx,string owner_claim_tx,string renter_claim_tx,string payout_mode)','function deposit(uint256 amount,string fundingTx)','function ack_owner_claim(string payoutTx)','function ack_renter_claim(string payoutTx)']);

export async function POST(request: Request) {
  try {
    const body = await request.json() as {agreement?: string; kind?: string; tx?: string};
    if (!body.agreement || !/^0x[0-9a-fA-F]{40}$/.test(body.agreement) || !body.tx || !/^0x[0-9a-fA-F]{64}$/.test(body.tx) || !['funding','owner_claim','renter_claim'].includes(body.kind || '')) return NextResponse.json({error: 'Invalid attestation request'}, {status: 400});
    const key = process.env.WEARSEAL_STUDIONET_PRIVATE_KEY;
    if (!key) return NextResponse.json({error: 'Studionet attestor is not configured'}, {status: 503});
    const escrow = (process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0x9d0baedb946036a99616c8abecc14f122e21e897') as `0x${string}`;
    const base = createPublicClient({chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')});
    const receipt = await base.getTransactionReceipt({hash: body.tx as `0x${string}`});
    const transaction = await base.getTransaction({hash: body.tx as `0x${string}`});
    if (receipt.status !== 'success' || getAddress(String(transaction.to)) !== getAddress(escrow)) return NextResponse.json({error: 'Base transaction is not a finalized success on the canonical escrow'}, {status: 409});
    const id = pad(getAddress(body.agreement) as `0x${string}`, {size: 32});
    const decoded = decodeFunctionData({abi: escrowAbi, data: transaction.input});
    if (decoded.args?.[0] !== id) return NextResponse.json({error: 'Base transaction targets a different Agreement'}, {status: 409});
    const genlayer = createClient({chain: studionet});
    const agreement = await genlayer.readContract({address: getAddress(body.agreement), functionName: 'get_agreement', args: []}) as any;
    const vaultAddress = getAddress(String(agreement.vault));
    const vault = await genlayer.readContract({address: vaultAddress, functionName: 'get_vault', args: []}) as any;
    const attestor = privateKeyToAccount(key as `0x${string}`);
    if (getAddress(String(vault.attestor)) !== attestor.address || getAddress(String(vault.agreement)) !== getAddress(body.agreement)) return NextResponse.json({error: 'Vault attestor or Agreement binding mismatch'}, {status: 409});
    const client = createWalletClient({account: attestor, chain: studionet, transport: http(process.env.STUDIONET_RPC_URL || 'https://studio.genlayer.com/api')}).extend(publicActions);
    if (body.kind === 'funding') {
      if (decoded.functionName !== 'fund' || getAddress(String(transaction.from)) !== getAddress(String(agreement.renter)) || transaction.value !== BigInt(agreement.deposit)) return NextResponse.json({error: 'Funding transaction does not match the renter or exact deposit'}, {status: 409});
      const pool = await base.readContract({address: escrow, abi: escrowAbi, functionName: 'getPool', args: [id]});
      if (pool[0] !== BigInt(agreement.deposit) || pool[1] !== 0n || pool[2]) return NextResponse.json({error: 'Base collateral readback is not an unfunded exact pool'}, {status: 409});
      const hash = await client.writeContract({address: vaultAddress, abi: vaultAbi, functionName: 'deposit', args: [BigInt(agreement.deposit), body.tx]});
      return NextResponse.json({hash});
    }
    if (decoded.functionName !== 'claim') return NextResponse.json({error: 'Claim attestation requires a claim transaction'}, {status: 409});
    const logs = parseEventLogs({abi: escrowAbi, logs: receipt.logs, eventName: 'Claimed'});
    const claimed = logs.find(log => getAddress(String(log.args.recipient)) === getAddress(String(body.kind === 'owner_claim' ? agreement.owner : agreement.renter)) && log.args.agreementId === id);
    if (!claimed) return NextResponse.json({error: 'No matching finalized payout event found'}, {status: 409});
    const expected = BigInt(body.kind === 'owner_claim' ? vault.owner_claim : vault.renter_claim);
    if (BigInt(claimed.args.amount) !== expected || getAddress(String(transaction.from)) !== getAddress(String(body.kind === 'owner_claim' ? agreement.owner : agreement.renter))) return NextResponse.json({error: 'Claim amount or recipient does not match authoritative Vault state'}, {status: 409});
    const functionName = body.kind === 'owner_claim' ? 'ack_owner_claim' : 'ack_renter_claim';
    const hash = await client.writeContract({address: vaultAddress, abi: vaultAbi, functionName, args: [body.tx]});
    return NextResponse.json({hash});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500}); }
}
