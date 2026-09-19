import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {readFileSync} from 'node:fs';
import {createPublicClient, createWalletClient, custom, parseEther, pad} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';
import solc from 'solc';

const ownerKey = '0x' + '11'.repeat(32);
const relayerKey = '0x' + '22'.repeat(32);
const renterKey = '0x' + '33'.repeat(32);
const owner = privateKeyToAccount(ownerKey);
const relayer = privateKeyToAccount(relayerKey);
const renter = privateKeyToAccount(renterKey);
const compiled = JSON.parse(readFileSync('artifacts/base-escrow-compiled.json', 'utf8'));
const abi = compiled.abi;
const agreement = pad('0x' + 'aa'.repeat(20), {size: 32});

const provider = ganache.provider({chain: {chainId: 84532}, wallet: {accounts: [ownerKey, relayerKey, renterKey].map(secretKey => ({secretKey, balance: '0x' + (10n ** 20n).toString(16)}))}, logging: {quiet: true}});
const transport = custom(provider);
const publicClient = createPublicClient({chain: baseSepolia, transport});
const ownerClient = createWalletClient({account: owner, chain: baseSepolia, transport});
const relayerClient = createWalletClient({account: relayer, chain: baseSepolia, transport});
const renterClient = createWalletClient({account: renter, chain: baseSepolia, transport});

async function deploy() {
  const hash = await ownerClient.deployContract({abi, bytecode: compiled.bytecode, args: [relayer.address]});
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  return receipt.contractAddress;
}
async function tx(client, request) {
  const hash = await client.writeContract(request);
  return publicClient.waitForTransactionReceipt({hash});
}

async function deployRejector() {
  const source = 'interface IE { function claim(bytes32 id) external; } contract Rejector { function claim(address e, bytes32 id) external { IE(e).claim(id); } receive() external payable { revert(); } }';
  const output = JSON.parse(solc.compile(JSON.stringify({language: 'Solidity', sources: {'Rejector.sol': {content: source}}, settings: {outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object']}}}})));
  const artifact = output.contracts['Rejector.sol'].Rejector;
  const hash = await ownerClient.deployContract({abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`});
  return (await publicClient.waitForTransactionReceipt({hash})).contractAddress;
}

test('WearSealEscrow allocation, pull claims, authorization and replay guards', async () => {
  const escrow = await deploy();
  const deposit = parseEther('1');
  const ownerAmount = parseEther('0.15');
  const renterAmount = parseEther('0.85');
  await tx(renterClient, {address: escrow, abi, functionName: 'fund', args: [agreement], value: deposit});
  assert.deepEqual(await publicClient.readContract({address: escrow, abi, functionName: 'getPool', args: [agreement]}), [deposit, 0n, false]);
  await assert.rejects(() => tx(ownerClient, {address: escrow, abi, functionName: 'setPayout', args: [agreement, owner.address, ownerAmount, renter.address, renterAmount]}));
  await tx(relayerClient, {address: escrow, abi, functionName: 'setPayout', args: [agreement, owner.address, ownerAmount, renter.address, renterAmount]});
  assert.deepEqual(await publicClient.readContract({address: escrow, abi, functionName: 'getPool', args: [agreement]}), [deposit, deposit, true]);
  assert.equal(await publicClient.readContract({address: escrow, abi, functionName: 'getClaimable', args: [agreement, owner.address]}), ownerAmount);
  assert.equal(await publicClient.readContract({address: escrow, abi, functionName: 'getClaimable', args: [agreement, renter.address]}), renterAmount);
  await assert.rejects(() => tx(relayerClient, {address: escrow, abi, functionName: 'setPayout', args: [agreement, owner.address, ownerAmount, renter.address, renterAmount]}));
  await tx(ownerClient, {address: escrow, abi, functionName: 'claim', args: [agreement]});
  assert.equal(await publicClient.readContract({address: escrow, abi, functionName: 'getClaimable', args: [agreement, owner.address]}), 0n);
  await assert.rejects(() => tx(ownerClient, {address: escrow, abi, functionName: 'claim', args: [agreement]}));
  await tx(renterClient, {address: escrow, abi, functionName: 'claim', args: [agreement]});
  assert.equal(await publicClient.readContract({address: escrow, abi, functionName: 'getClaimable', args: [agreement, renter.address]}), 0n);
  await assert.rejects(() => tx(renterClient, {address: escrow, abi, functionName: 'claim', args: [agreement]}));
});

test('WearSealEscrow rejects zero relayer and preserves unallocated withdrawal rules', async () => {
  await assert.rejects(() => ownerClient.deployContract({abi, bytecode: compiled.bytecode, args: ['0x0000000000000000000000000000000000000000']}));
  const escrow = await deploy();
  const id = pad('0x' + 'bb'.repeat(20), {size: 32});
  const amount = parseEther('0.5');
  await tx(renterClient, {address: escrow, abi, functionName: 'fund', args: [id], value: amount});
  await assert.rejects(() => tx(ownerClient, {address: escrow, abi, functionName: 'withdrawUnallocated', args: [id, renter.address, amount + 1n]}));
  await tx(ownerClient, {address: escrow, abi, functionName: 'withdrawUnallocated', args: [id, renter.address, amount]});
  assert.deepEqual(await publicClient.readContract({address: escrow, abi, functionName: 'getPool', args: [id]}), [0n, 0n, false]);
});

test('a failed recipient transfer preserves the claim for retry', async () => {
  const escrow = await deploy();
  const rejector = await deployRejector();
  const id = pad('0x' + 'cc'.repeat(20), {size: 32});
  const amount = parseEther('0.25');
  await tx(renterClient, {address: escrow, abi, functionName: 'fund', args: [id], value: amount});
  await tx(relayerClient, {address: escrow, abi, functionName: 'setPayout', args: [id, rejector, amount, renter.address, 0n]});
  await assert.rejects(() => tx(ownerClient, {address: rejector, abi: [{type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{name: 'e', type: 'address'}, {name: 'id', type: 'bytes32'}], outputs: []}], functionName: 'claim', args: [escrow, id]}));
  assert.equal(await publicClient.readContract({address: escrow, abi, functionName: 'getClaimable', args: [id, rejector]}), amount);
});
