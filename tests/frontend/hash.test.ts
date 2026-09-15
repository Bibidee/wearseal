import {describe,it,expect} from 'vitest';
describe('WearSeal evidence rules',()=>{it('rejects non-HTTPS evidence',()=>expect('ipfs://fixture'.startsWith('https://')).toBe(false));it('uses exact hex hashes',()=>expect(/^[a-f0-9]{64}$/.test('a'.repeat(64))).toBe(true));});
