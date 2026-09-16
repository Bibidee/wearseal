import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createClient, createAccount, decodeTransaction } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const privateKey = process.env.DEPLOYER_PRIVATE_KEY || await (async () => {
  const modulePath = process.env.GENLAYER_KEYTAR_MODULE;
  if (!modulePath) return null;
  const keytar = createRequire(import.meta.url)(modulePath);
  return keytar.getPassword(process.env.GENLAYER_KEYTAR_SERVICE || 'genlayer-cli', process.env.GENLAYER_KEYTAR_ACCOUNT || 'account:wearseal');
})();
if (!privateKey) throw new Error('Set DEPLOYER_PRIVATE_KEY or configure the unlocked CLI keychain account.');

const account = createAccount(privateKey);
const client = createClient({ chain: studionet, account });
const files = ['contracts/wearseal_agreement.py', 'contracts/wearseal_vault.py'];
const evidence = { sources: files.map(path => ({ path, bytes: readFileSync(path).length, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })) };

async function finalized(hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, status: 'FINALIZED', retries: 220, interval: 5000 });
  const execution = receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.txExecutionResultName;
  if (!/SUCCESS|FINISHED_WITH_RETURN/i.test(String(execution)) || /ERROR|FAILED/i.test(String(execution))) throw new Error(`${label} execution failed: ${hash}`);
  return receipt;
}

async function deploy(path, args, label) {
  const code = readFileSync(path, 'utf8');
  const hash = await client.deployContract({ code, args });
  const receipt = await finalized(hash, label);
  let address = receipt.data?.contract_address;
  if (!address) {
    try { address = decodeTransaction(await client.getTransaction({ hash })).txDataDecoded?.contractAddress; } catch {}
  }
  if (!address) throw new Error(`${label} finalized without contract address: ${hash}`);
  const deployed = await client.getContractCode(address);
  const sourceSha256 = createHash('sha256').update(code).digest('hex');
  if (createHash('sha256').update(deployed).digest('hex') !== sourceSha256) throw new Error(`${label} source mismatch at ${address}`);
  evidence[label] = { address, tx: hash, execution: 'SUCCESS', sourceSha256 };
  return address;
}

const renter = process.env.WEARSEAL_RENTER_ADDRESS || '0x0000000000000000000000000000000000000001';
const checkoutUrl = process.env.WEARSEAL_CHECKOUT_URL || 'https://raw.githubusercontent.com/Bibidee/wearseal/main/public/fixtures/checkout.png';
const checkoutHash = process.env.WEARSEAL_CHECKOUT_HASH || '0xc566e8a933cd6d1b2201bbc4f4820d8cfdf071099266cf931019350edeca71bb';
const deadline = BigInt(process.env.WEARSEAL_DEADLINE || Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
const agreement = await deploy('contracts/wearseal_agreement.py', [account.address, renter, 'WearSeal demo camera', 'fixture-serial-hash', 'Normal wear is acceptable; scratches are minor; cracks or missing parts are material.', checkoutUrl, checkoutHash, 1000000000000000n, 1500, 10000, deadline], 'agreement');
const vault = await deploy('contracts/wearseal_vault.py', [agreement], 'vault');
const bindTx = await client.writeContract({ address: agreement, functionName: 'bind_vault', args: [vault] });
await finalized(bindTx, 'bind_vault');
evidence.binding = { tx: bindTx, execution: 'SUCCESS' };
evidence.readback = {
  agreement: await client.readContract({ address: agreement, functionName: 'get_agreement', args: [] }),
  vault: await client.readContract({ address: vault, functionName: 'get_vault', args: [] })
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/deployment-source.json', JSON.stringify({ network: 'Studionet', chainId: 61999, signer: account.address, evidence }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
console.log(JSON.stringify({ network: 'Studionet', chainId: 61999, signer: account.address, agreement, vault, evidence }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
