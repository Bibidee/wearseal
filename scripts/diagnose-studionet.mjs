import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';

const rpcUrl = studionet.rpcUrls.default.http[0];
const addresses = {
  agreement: '0xAC7aFF325B149D9f7a979473920646FB32565C76',
  vault: '0x7147b20d7814c4E3a3170541A02412FC064c9551',
};
const transactions = {
  agreement: '0xbb763321247517c0e3548b167be1f05d67ae44acb8f3ff4b4e43eb7e975f7287',
  vault: '0x281536ad313c6e0a5bdc9f486d007b70cd40fc1ec7763ce045f30fdde0d10198',
  binding: '0xc7698d860cd3c909ef9b1f2b25fde0b9226a925b8e389814d264072fbc48da59',
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
