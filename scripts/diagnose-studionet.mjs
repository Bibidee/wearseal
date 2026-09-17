import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';

const rpcUrl = studionet.rpcUrls.default.http[0];
const addresses = {
  agreement: '0x47C59B05C4dC09EF2f0Cb55b694442510cc05af8',
  vault: '0xfa80563d6c489C6058ba0a2cabE54B13A800d5B3',
};
const transactions = {
  agreement: '0xf9d8b51b423f800a1a9b98078b3450a31ce59e29d4543b7369cca430e8cce11d',
  vault: '0xc8c2a17149eefb36f3146b5eb1ca9f8964f1b4d774a27867ffaf74640ed500c7',
  binding: '0xbf40ea13eaef65cc7c24e38093409da57d1d2afe5e4514f8bc1c353fba3a8f2a',
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
