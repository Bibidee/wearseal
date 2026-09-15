import {createClient} from 'genlayer-js';import {studionet} from 'genlayer-js/chains';
export const publicClient=createClient({chain:studionet});
export const addresses={agreement:(process.env.NEXT_PUBLIC_AGREEMENT_ADDRESS||'') as `0x${string}`,vault:(process.env.NEXT_PUBLIC_VAULT_ADDRESS||'') as `0x${string}`};
export type Agreement={owner:string;renter:string;item_label:string;serial_hash:string;rubric:string;checkout_url:string;checkout_hash:string;deposit:bigint;minor_bps:bigint;material_bps:bigint;deadline:bigint;status:string;definition_hash:string;return_url:string;return_hash:string;verdict:string;reason:string;same_item_confidence:string;damage_regions:unknown[];reinspection_count:bigint};
export async function readAgreement(address:`0x${string}`){return publicClient.readContract({address,functionName:'get_agreement'}) as Promise<Agreement>}
export async function readVault(address:`0x${string}`,id:bigint){return publicClient.readContract({address,functionName:'get_vault',args:[id]}) as Promise<{credited:bigint;settled:boolean;total_credited:bigint}>}
export function requireAddress(a:string,name:string){if(!/^0x[a-fA-F0-9]{40}$/.test(a))throw new Error(`${name} address is not configured`);return a as `0x${string}`}
