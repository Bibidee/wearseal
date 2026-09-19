import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';

const rpcUrl = studionet.rpcUrls.default.http[0];
const addresses = {
  agreement: '0x06569280c7B478E6c4e9501CD29b4Fa25b0DF067',
  vault: '0xE1B4398af7274aa9492Dc5878Eb406DbEc68a39c',
};
const transactions = {
  agreement: '0x117ebd3ad90406410f442f1739c90ec9953dbcb8b9dc2d54e9e149bac5e26f70',
  vault: '0xb0b699e2cf8d2d14f8208b1228ec7da1a2c303bba94f309e01481b5f8e1b7b5d',
  binding: '0xe5750dfb0c0745b209aa38fecd7d9422c7dd4726c2fb12a4c9cb83ccbed40f6f',
};
const client = createClient({chain: studionet});
const json = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
const rpc = async (method, params) => {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  return {status: response.status, body: await response.json()};
};
const attempt = async (fn) => { try { return {ok: true, value: json(await fn())}; } catch (error) { return {ok: false, error: String(error)}; } };
const result = {
  rpcUrl,
  sdkNetwork: studionet.name,
  sdkChainId: studionet.id,
  rawChainId: await rpc('eth_chainId', []),
  addresses,
  contracts: {},
  historicalTransactions: {},
};
for (const [name, address] of Object.entries(addresses)) {
  result.contracts[name] = {
    code: await rpc('eth_getCode', [address, 'latest']),
    sdkCode: await attempt(() => client.getContractCode(address)),
    readableState: await attempt(() => client.readContract({address, functionName: name === 'agreement' ? 'get_agreement' : 'get_vault', args: []})),
  };
}
for (const [name, hash] of Object.entries(transactions)) result.historicalTransactions[name] = {hash, receipt: await attempt(() => client.getTransaction({hash}))};
console.log(JSON.stringify(result, null, 2));
