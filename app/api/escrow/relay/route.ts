import {NextResponse} from 'next/server';
import {createPublicClient, createWalletClient, http, parseAbi, publicActions, getAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';
import {pad} from 'viem';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';

const abi = parseAbi(['function setPayout(bytes32,address,uint256,address,uint256)','function getPool(bytes32) view returns (uint256,uint256,bool)','function getClaimable(bytes32,address) view returns (uint256)']);
const agreementAbi = parseAbi(['function get_agreement() view returns (address owner,address renter,string item_label,string serial_hash,string rubric,string checkout_url,string checkout_hash,uint256 deposit,uint256 minor_bps,uint256 material_bps,uint256 deadline,string status,string definition_hash,address vault,string return_url,string return_hash,string verdict,string same_item,string reason,string same_item_confidence,string new_damage_present,string damage_level,string damage_regions,uint256 reinspection_count)','function settlement_instruction() view returns (address owner,address renter,uint256 deposit,uint256 owner_bps,uint256 renter_bps,bool terminal)']);
const vaultAbi = parseAbi(['function get_vault() view returns (address agreement,uint256 credited,bool settled,uint256 owner_claim,uint256 renter_claim,bool owner_claimed,bool renter_claimed,string funding_tx,string owner_claim_tx,string renter_claim_tx,string payout_mode)']);

export async function POST(request: Request) {
  try {
    const body = await request.json() as {agreement?: string};
    const key = process.env.WEARSEAL_BASE_PRIVATE_KEY;
    const escrow = process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0x9d0baedb946036a99616c8abecc14f122e21e897';
    if (!key) return NextResponse.json({error: 'Base escrow relayer is not configured'}, {status: 503});
    if (!body.agreement || !/^0x[0-9a-fA-F]{40}$/.test(body.agreement)) return NextResponse.json({error: 'Agreement address is required'}, {status: 400});
    const agreementAddress = getAddress(body.agreement);
    const genlayer = createClient({chain: studionet});
    const agreement = await genlayer.readContract({address: agreementAddress, functionName: 'get_agreement', args: []}) as any;
    if (!['DECIDED', 'SETTLED'].includes(String(agreement.status))) return NextResponse.json({error: 'Agreement has no finalized decision'}, {status: 409});
    if (!agreement.vault || /^0x0+$/.test(String(agreement.vault))) return NextResponse.json({error: 'Agreement has no bound Vault'}, {status: 409});
    const vault = await genlayer.readContract({address: getAddress(String(agreement.vault)), functionName: 'get_vault', args: []}) as any;
    if (getAddress(String(vault.agreement)) !== agreementAddress) return NextResponse.json({error: 'Vault does not point to Agreement'}, {status: 409});
    if (!vault.settled || BigInt(vault.credited) !== 0n) return NextResponse.json({error: 'Vault settlement is not finalized'}, {status: 409});
    const instruction = await genlayer.readContract({address: agreementAddress, functionName: 'settlement_instruction', args: []}) as any;
    if (!instruction.terminal || getAddress(String(instruction.owner)) !== getAddress(String(agreement.owner)) || getAddress(String(instruction.renter)) !== getAddress(String(agreement.renter)) || BigInt(instruction.deposit) !== BigInt(agreement.deposit)) return NextResponse.json({error: 'Settlement readback mismatch'}, {status: 409});
    const ownerAmount = BigInt(vault.owner_claim); const renterAmount = BigInt(vault.renter_claim); const deposit = BigInt(agreement.deposit);
    if (ownerAmount + renterAmount !== deposit || ownerAmount !== deposit * BigInt(instruction.owner_bps) / 10000n) return NextResponse.json({error: 'Vault allocations do not match authoritative settlement'}, {status: 409});
    const account = privateKeyToAccount(key as `0x${string}`);
    const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org');
    const publicClient = createPublicClient({chain: baseSepolia, transport});
    const client = createWalletClient({account, chain: baseSepolia, transport}).extend(publicActions);
    const agreementId = pad(agreementAddress as `0x${string}`, {size: 32});
    const pool = await publicClient.readContract({address: escrow as `0x${string}`, abi, functionName: 'getPool', args: [agreementId]});
    if (pool[0] < deposit || pool[1] !== 0n || pool[2]) return NextResponse.json({error: 'Base pool is missing collateral or already allocated'}, {status: 409});
    const hash = await client.writeContract({address: escrow as `0x${string}`, abi, functionName: 'setPayout', args: [agreementId, getAddress(String(agreement.owner)), ownerAmount, getAddress(String(agreement.renter)), renterAmount]});
    const receipt = await client.waitForTransactionReceipt({hash});
    if (receipt.status !== 'success') return NextResponse.json({error: 'Payout allocation reverted', hash}, {status: 502});
    return NextResponse.json({hash});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500}); }
}
