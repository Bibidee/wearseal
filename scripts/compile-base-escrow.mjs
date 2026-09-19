import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import solc from 'solc';

const source = readFileSync('contracts/base/WearSealEscrow.sol', 'utf8');
const input = { language: 'Solidity', sources: { 'WearSealEscrow.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors?.some((e) => e.severity === 'error')) throw new Error(output.errors.map((e) => e.formattedMessage).join('\n'));
const artifact = output.contracts['WearSealEscrow.sol'].WearSealEscrow;
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/base-escrow-compiled.json', JSON.stringify({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }, null, 2));
console.log(`compiled ${artifact.evm.bytecode.object.length / 2} bytes`);
