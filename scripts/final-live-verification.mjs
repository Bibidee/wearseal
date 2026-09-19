import {createRequire} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
import {createClient, createAccount} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createPublicClient, createWalletClient, decodeEventLog, getAddress, http, pad, parseAbi, publicActions} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';


const keytar = createRequire(import.meta.url)(process.env.GENLAYER_KEYTAR_MODULE);
const service = process.env.GENLAYER_KEYTAR_SERVICE || 'genlayer-cli';
const ownerKey = await keytar.getPassword(service, process.env.GENLAYER_OWNER_ACCOUNT || 'account:live-bob');
const renterKey = await keytar.getPassword(service, process.env.GENLAYER_RENTER_ACCOUNT || 'account:live-alice');
const baseRelayerKey = process.env.WEARSEAL_BASE_PRIVATE_KEY;
if (!ownerKey || !renterKey || !baseRelayerKey) throw Error('Required unlocked accounts or authorized Base deployer are unavailable.');
const owner = createAccount(ownerKey); const renter = createAccount(renterKey); const attestor = owner;
const genOwner = createClient({chain: studionet, account: owner});
const genRenter = createClient({chain: studionet, account: renter});
const baseAccount = privateKeyToAccount(baseRelayerKey);
const baseClient = createPublicClient({chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')});
const baseRelayer = createWalletClient({account: baseAccount, chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')}).extend(publicActions);
const baseAbi = parseAbi(['function registerAgreement(bytes32,address,uint256)','function fund(bytes32)','function setPayout(bytes32,address,uint256,address,uint256)','function authorizeRefund(bytes32,address,uint256)','function claim(bytes32)','function getPool(bytes32) view returns (uint256,uint256,bool)','function getRefundState(bytes32) view returns (bool,bool,address,uint256)','event Claimed(bytes32 indexed agreementId,address indexed recipient,uint256 amount)','event RefundAuthorized(bytes32 indexed agreementId,address indexed renter,uint256 amount)']);
const genAgreementAbi = parseAbi(['function canonical_definition_hash() view returns (string)','function accept_baseline(string)','function submit_return(string,string)','function inspect()','function expire()','function get_agreement() view returns (address owner,address renter,string item_label,string serial_hash,string rubric,string checkout_url,string checkout_hash,uint256 deposit,uint256 minor_bps,uint256 material_bps,uint256 deadline,string status,string definition_hash,address vault,string return_url,string return_hash,string verdict,string same_item,string reason,string same_item_confidence,string new_damage_present,string damage_level,string damage_regions,uint256 reinspection_count)','function bind_vault(address)','function settlement_instruction() view returns (address owner,address renter,uint256 deposit,uint256 owner_bps,uint256 renter_bps,bool terminal)']);
const genVaultAbi = parseAbi(['function get_vault() view returns (address agreement,address attestor,uint256 credited,bool settled,uint256 owner_claim,uint256 renter_claim,bool owner_claimed,bool renter_claimed,string funding_tx,string owner_claim_tx,string renter_claim_tx,string payout_mode)','function deposit(uint256,string)','function settle()','function ack_owner_claim(string)','function ack_renter_claim(string)','function refund_cancelled(string)']);
const agreementCode = readFileSync('contracts/wearseal_agreement.py','utf8');
const vaultCode = readFileSync('contracts/wearseal_vault.py','utf8');
const escrow = getAddress(process.env.WEARSEAL_BASE_ESCROW_ADDRESS);
const deposit = 1000000000000000n;
const checkoutUrl = 'https://raw.githubusercontent.com/Bibidee/wearseal/main/public/fixtures/checkout.png';
const checkoutHash = '0xc566e8a933cd6d1b2201bbc4f4820d8cfdf071099266cf931019350edeca71bb';
const returnUrl = 'https://raw.githubusercontent.com/Bibidee/wearseal/main/public/fixtures/return.png';
const returnHash = '0xdfd3c7d3e79288a13afd626872e165a39ad68a1c8d054ab1d02d108887e0894d';
const rubric = 'Normal wear is acceptable; scratches are minor; cracks or missing parts are material.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
const execution = receipt => String(receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.txExecutionResultName || '');
async function genWrite(client, address, functionName, args = [], extra = {}) {
  const hash = await client.writeContract({address, functionName, args, ...extra});
  const receipt = await client.waitForTransactionReceipt({hash, status: 'FINALIZED', retries: 220, interval: 5000});
  if (!/SUCCESS|FINISHED_WITH_RETURN/i.test(execution(receipt)) || /ERROR|FAILED/i.test(execution(receipt))) throw Error(`${functionName} failed: ${hash}`);
  return {hash, receipt};
}
async function baseWrite(client, address, functionName, args = [], value) {
  const hash = await client.writeContract({address, abi: baseAbi, functionName, args, ...(value === undefined ? {} : {value})});
  const receipt = await baseClient.waitForTransactionReceipt({hash});
  if (receipt.status !== 'success') throw Error(`${functionName} reverted: ${hash}`);
  return {hash, receipt};
}
async function deployPair(deadline, label) {
  const agreementDeploy = await genOwner.deployContract({code: agreementCode, args: [owner.address, renter.address, label, 'final-verification', rubric, checkoutUrl, checkoutHash, deposit, 1500, 10000, deadline]});
  const agreementReceipt = await genOwner.waitForTransactionReceipt({hash: agreementDeploy, status: 'FINALIZED', retries: 220, interval: 5000});
  if (!/SUCCESS|FINISHED_WITH_RETURN/i.test(execution(agreementReceipt))) throw Error('Agreement deployment failed');
  const agreement = agreementReceipt.data?.contract_address;
  const vaultDeploy = await genOwner.deployContract({code: vaultCode, args: [agreement, attestor.address]});
  const vaultReceipt = await genOwner.waitForTransactionReceipt({hash: vaultDeploy, status: 'FINALIZED', retries: 220, interval: 5000});
  if (!/SUCCESS|FINISHED_WITH_RETURN/i.test(execution(vaultReceipt))) throw Error('Vault deployment failed');
  const vault = vaultReceipt.data?.contract_address;
  const binding = await genWrite(genOwner, agreement, 'bind_vault', [vault]);
  const a = await genOwner.readContract({address: agreement, functionName: 'get_agreement', args: []});
  const v = await genOwner.readContract({address: vault, functionName: 'get_vault', args: []});
  if (getAddress(String(a.vault)) !== getAddress(vault) || getAddress(String(v.agreement)) !== getAddress(agreement) || getAddress(String(v.attestor)) !== getAddress(attestor.address)) throw Error('Deployment readback mismatch');
  return {agreement, vault, deployment: {agreement: {tx: agreementDeploy, address: agreement}, vault: {tx: vaultDeploy, address: vault}, binding: binding.hash}, initial: {agreement: json(a), vault: json(v)}};
}
async function acceptAndFund(pair) {
  const definition = await genRenter.readContract({address: pair.agreement, functionName: 'canonical_definition_hash', args: []});
  const accepted = await genWrite(genRenter, pair.agreement, 'accept_baseline', [definition]);
  const id = pad(pair.agreement, {size: 32});
  const registered = await baseWrite(baseRelayer, escrow, 'registerAgreement', [id, renter.address, deposit]);
  const funder = createWalletClient({account: privateKeyToAccount(renterKey), chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')}).extend(publicActions);
  const funded = await baseWrite(funder, escrow, 'fund', [id], deposit);
  const fundingAck = await genWrite(genOwner, pair.vault, 'deposit', [deposit, funded.hash]);
  for (let i = 0; i < 12; i++) { const state = await genOwner.readContract({address: pair.agreement, functionName: 'get_agreement', args: []}); if (state.status === 'FUNDED') break; await sleep(5000); }
  return {definition, accepted: accepted.hash, registered: registered.hash, funded: funded.hash, fundingAck: fundingAck.hash};
}
async function normalPath() {
  const pair = await deployPair(BigInt(Math.floor(Date.now() / 1000) + 3600), 'WearSeal normal final path');
  const funding = await acceptAndFund(pair);
  const returned = await genWrite(genRenter, pair.agreement, 'submit_return', [returnUrl, returnHash]);
  const inspected = await genWrite(genOwner, pair.agreement, 'inspect');
  const agreementAfterInspect = await genOwner.readContract({address: pair.agreement, functionName: 'get_agreement', args: []});
  if (agreementAfterInspect.status !== 'DECIDED') throw Error('Normal path did not decide');
  const settled = await genWrite(genOwner, pair.vault, 'settle');
  const instruction = await genOwner.readContract({address: pair.agreement, functionName: 'settlement_instruction', args: []});
  const vaultAfter = await genOwner.readContract({address: pair.vault, functionName: 'get_vault', args: []});
  const id = pad(pair.agreement, {size: 32});
  const payout = await baseWrite(baseRelayer, escrow, 'setPayout', [id, owner.address, BigInt(vaultAfter.owner_claim), renter.address, BigInt(vaultAfter.renter_claim)]);
  const ownerBase = createWalletClient({account: privateKeyToAccount(ownerKey), chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')}).extend(publicActions);
  const renterBase = createWalletClient({account: privateKeyToAccount(renterKey), chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')}).extend(publicActions);
  const ownerBefore = await baseClient.getBalance({address: owner.address}); const renterBefore = await baseClient.getBalance({address: renter.address});
  const ownerClaim = await baseWrite(ownerBase, escrow, 'claim', [id]); const renterClaim = await baseWrite(renterBase, escrow, 'claim', [id]);
  const ownerAfter = await baseClient.getBalance({address: owner.address}); const renterAfter = await baseClient.getBalance({address: renter.address});
  const ownerAck = await genWrite(genOwner, pair.vault, 'ack_owner_claim', [ownerClaim.hash], {leaderOnly: true});
  const renterAck = await genWrite(genOwner, pair.vault, 'ack_renter_claim', [renterClaim.hash], {leaderOnly: true});
  let repeatSettlement = false, repeatPayout = false;
  try { await genWrite(genOwner, pair.vault, 'settle'); } catch { repeatSettlement = true; }
  try { await baseWrite(baseRelayer, escrow, 'setPayout', [id, owner.address, BigInt(vaultAfter.owner_claim), renter.address, BigInt(vaultAfter.renter_claim)]); } catch { repeatPayout = true; }
  const finalAgreement = await genOwner.readContract({address: pair.agreement, functionName: 'get_agreement', args: []});
  const finalVault = await genOwner.readContract({address: pair.vault, functionName: 'get_vault', args: []});
  const pool = await baseClient.readContract({address: escrow, abi: baseAbi, functionName: 'getPool', args: [id]});
  return json({pair, funding, returned: returned.hash, inspected: inspected.hash, verdict: {verdict: finalAgreement.verdict, same_item: finalAgreement.same_item, same_item_confidence: finalAgreement.same_item_confidence, new_damage_present: finalAgreement.new_damage_present, damage_level: finalAgreement.damage_level}, settled: settled.hash, instruction, payout: payout.hash, claims: {owner: ownerClaim.hash, renter: renterClaim.hash}, acknowledgements: {owner: ownerAck.hash, renter: renterAck.hash}, balances: {ownerBefore, ownerAfter, ownerDelta: ownerAfter - ownerBefore, renterBefore, renterAfter, renterDelta: renterAfter - renterBefore}, finalAgreement, finalVault, pool, repeatSettlement, repeatPayout});
}
async function cancellationPath() {
  const pair = await deployPair(BigInt(Math.floor(Date.now() / 1000) + 20), 'WearSeal cancellation final path');
  const funding = await acceptAndFund(pair); await sleep(25000);
  const expired = await genWrite(genOwner, pair.agreement, 'expire');
  const cancelled = await genOwner.readContract({address: pair.agreement, functionName: 'get_agreement', args: []});
  if (cancelled.status !== 'CANCELLED') throw Error('Cancellation path did not cancel');
  const id = pad(pair.agreement, {size: 32});
  const authorized = await baseWrite(baseRelayer, escrow, 'authorizeRefund', [id, renter.address, deposit]);
  const renterBase = createWalletClient({account: privateKeyToAccount(renterKey), chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')}).extend(publicActions);
  const before = await baseClient.getBalance({address: renter.address}); const refund = await baseWrite(renterBase, escrow, 'claim', [id]); const after = await baseClient.getBalance({address: renter.address});
  const acknowledgement = await genWrite(genOwner, pair.vault, 'refund_cancelled', [refund.hash], {leaderOnly: true});
  let duplicateRefund = false, settlementAfterRefund = false;
  try { await baseWrite(baseRelayer, escrow, 'authorizeRefund', [id, renter.address, deposit]); } catch { duplicateRefund = true; }
  try { await baseWrite(baseRelayer, escrow, 'setPayout', [id, owner.address, deposit, renter.address, 0n]); } catch { settlementAfterRefund = true; }
  const finalAgreement = await genOwner.readContract({address: pair.agreement, functionName: 'get_agreement', args: []}); const finalVault = await genOwner.readContract({address: pair.vault, functionName: 'get_vault', args: []}); const pool = await baseClient.readContract({address: escrow, abi: baseAbi, functionName: 'getPool', args: [id]}); const refundState = await baseClient.readContract({address: escrow, abi: baseAbi, functionName: 'getRefundState', args: [id]});
  return json({pair, funding, expired: expired.hash, authorized: authorized.hash, refund: refund.hash, acknowledgement: acknowledgement.hash, renterBefore: before, renterAfter: after, renterDelta: after - before, finalAgreement, finalVault, pool, refundState, duplicateRefund, settlementAfterRefund});
}
const normal = await normalPath(); const cancellation = await cancellationPath();
const result = {network: 'Studionet 61999 + Base Sepolia 84532', escrow, owner: owner.address, renter: renter.address, attestor: attestor.address, normal, cancellation};
writeFileSync('artifacts/final-live-verification.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
