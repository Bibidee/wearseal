import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const keytar = createRequire(import.meta.url)('C:/Users/ojiku/AppData/Roaming/npm/node_modules/genlayer/node_modules/keytar');
const service = process.env.GENLAYER_KEYTAR_SERVICE || 'genlayer-cli';
const ownerKey = await keytar.getPassword(service, process.env.GENLAYER_OWNER_ACCOUNT || 'account:faultline-dev');
const renterKey = await keytar.getPassword(service, process.env.GENLAYER_RENTER_ACCOUNT || 'account:signalbond-challenger-unlocked2');
if (!ownerKey || !renterKey) throw new Error('Both unlocked owner and renter accounts are required.');
const owner = createAccount(ownerKey);
const renter = createAccount(renterKey);
const agreement = process.env.WEARSEAL_AGREEMENT_ADDRESS;
const vault = process.env.WEARSEAL_VAULT_ADDRESS;
if (!agreement || !vault) throw new Error('WEARSEAL_AGREEMENT_ADDRESS and WEARSEAL_VAULT_ADDRESS are required.');
const ownerClient = createClient({ chain: studionet, account: owner });
const renterClient = createClient({ chain: studionet, account: renter });
const definitionHash = '0x' + createHash('sha256').update(`${agreement}:WearSeal demo camera:fixture-serial-hash`).digest('hex');
const returnUrl = process.env.WEARSEAL_RETURN_URL || 'https://raw.githubusercontent.com/Bibidee/wearseal/main/public/fixtures/return.png';
const returnHash = process.env.WEARSEAL_RETURN_HASH || '0xdfd3c7d3e79288a13afd626872e165a39ad68a1c8d054ab1d02d108887e0894d';
const deposit = 1000000000000000n;
const txs = {};

async function write(client, address, functionName, args = [], value) {
  const hash = await client.writeContract({ address, functionName, args, ...(value === undefined ? {} : { value }) });
  const receipt = await client.waitForTransactionReceipt({ hash, status: 'FINALIZED', retries: 220, interval: 5000 });
  const execution = receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.txExecutionResultName;
  console.log(JSON.stringify({ functionName, hash, execution }));
  if (execution !== 'SUCCESS') throw new Error(`${functionName} failed: ${hash}`);
  return hash;
}

txs.acceptBaseline = await write(renterClient, agreement, 'accept_baseline', [definitionHash]);
txs.deposit = await write(renterClient, vault, 'deposit', [], deposit);
txs.submitReturn = await write(renterClient, agreement, 'submit_return', [returnUrl, returnHash]);
txs.inspect = await write(ownerClient, agreement, 'inspect');
let inspected = await ownerClient.readContract({ address: agreement, functionName: 'get_agreement', args: [] });
if (inspected.status === 'RETURN_SUBMITTED') {
  txs.inspectRetry = await write(ownerClient, agreement, 'inspect');
  inspected = await ownerClient.readContract({ address: agreement, functionName: 'get_agreement', args: [] });
}
txs.settle = await write(ownerClient, vault, 'settle');
const readback = {
  agreement: await ownerClient.readContract({ address: agreement, functionName: 'get_agreement', args: [] }),
  vault: await ownerClient.readContract({ address: vault, functionName: 'get_vault', args: [] })
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/live-lifecycle.json', JSON.stringify({ network: 'Studionet', chainId: 61999, owner: owner.address, renter: renter.address, agreement, vault, txs, readback }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
console.log(JSON.stringify({ phase: 'COMPLETE', owner: owner.address, renter: renter.address, agreement, vault, txs, readback }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
