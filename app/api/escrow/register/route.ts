import {NextResponse} from 'next/server';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createPublicClient, createWalletClient, getAddress, http, parseAbi, publicActions, pad} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';

const escrowAbi = parseAbi(['function registerAgreement(bytes32,address,uint256)','function getPool(bytes32) view returns (uint256,uint256,bool)']);
const agreementAbi = parseAbi(['function get_agreement() view returns (address owner,address renter,string item_label,string serial_hash,string rubric,string checkout_url,string checkout_hash,uint256 deposit,uint256 minor_bps,uint256 material_bps,uint256 deadline,string status,string definition_hash,address vault,string return_url,string return_hash,string verdict,string same_item,string reason,string same_item_confidence,string new_damage_present,string damage_level,string damage_regions,uint256 reinspection_count)']);
const vaultAbi = parseAbi(['function get_vault() view returns (address agreement,uint256 credited,bool settled,uint256 owner_claim,uint256 renter_claim,bool owner_claimed,bool renter_claimed,string funding_tx,string owner_claim_tx,string renter_claim_tx,string payout_mode)']);

export async function POST(request: Request) {
  try {
    const {agreement: raw} = await request.json() as {agreement?: string};
    if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return NextResponse.json({error: 'Agreement address is required'}, {status: 400});
    const agreement = getAddress(raw);
    const key = process.env.WEARSEAL_BASE_PRIVATE_KEY;
    if (!key) return NextResponse.json({error: 'Base escrow relayer is not configured'}, {status: 503});
    const genlayer = createClient({chain: studionet});
    const state = await genlayer.readContract({address: agreement, functionName: 'get_agreement', args: []}) as any;
    if (String(state.status) !== 'BASELINE_ACCEPTED') return NextResponse.json({error: 'Agreement is not ready for funding'}, {status: 409});
    if (!state.vault || /^0x0+$/.test(String(state.vault))) return NextResponse.json({error: 'Agreement has no bound Vault'}, {status: 409});
    const vault = await genlayer.readContract({address: getAddress(String(state.vault)), functionName: 'get_vault', args: []}) as any;
    if (getAddress(String(vault.agreement)) !== agreement || BigInt(vault.credited) !== 0n || vault.settled) return NextResponse.json({error: 'Vault does not match an unfunded Agreement'}, {status: 409});
    const account = privateKeyToAccount(key as `0x${string}`);
    const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org');
    const publicClient = createPublicClient({chain: baseSepolia, transport});
    const client = createWalletClient({account, chain: baseSepolia, transport}).extend(publicActions);
    const id = pad(agreement, {size: 32});
    const escrow = (process.env.NEXT_PUBLIC_BASE_ESCROW_ADDRESS || '0x9d0baedb946036a99616c8abecc14f122e21e897') as `0x${string}`;
    const pool = await publicClient.readContract({address: escrow, abi: escrowAbi, functionName: 'getPool', args: [id]});
    if (pool[0] > 0n || pool[1] > 0n || pool[2]) return NextResponse.json({error: 'Base pool is already funded or allocated'}, {status: 409});
    const hash = await client.writeContract({address: escrow, abi: escrowAbi, functionName: 'registerAgreement', args: [id, getAddress(String(state.renter)), BigInt(state.deposit)]});
    const receipt = await client.waitForTransactionReceipt({hash});
    if (receipt.status !== 'success') return NextResponse.json({error: 'Base registration reverted', hash}, {status: 502});
    return NextResponse.json({hash, renter: state.renter, deposit: String(state.deposit)});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 500}); }
}
