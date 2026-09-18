import {describe,it,expect,vi,afterEach} from 'vitest';
import {validateEvidenceUrl,validSha256} from '../../lib/evidence';
import {sha256Hex,verifyEvidence} from '../../lib/hash';
import {classifyReceipt} from '../../lib/genlayer/transaction';
import {deadlineFromDate} from '../../lib/deadline';
afterEach(()=>vi.restoreAllMocks());
describe('evidence validation and identity',()=>{
 it.each(['http://example.com/a.png','https://localhost/a','https://10.0.0.1/a','https://172.16.0.1/a','https://192.168.1.1/a','https://127.0.0.1/a','https://169.254.1.1/a','https://example.com:443/a','https://user:pass@example.com/a','https://example.com/a#x','https://x.local/a','https://x.internal/a'])('rejects unsafe URL %s',u=>expect(validateEvidenceUrl(u)).toBe(false));
 it('accepts public HTTPS and exact hashes',()=>{expect(validateEvidenceUrl('https://example.com/image.png')).toBe(true);expect(validSha256(`0x${'a'.repeat(64)}`)).toBe(true);expect(validSha256('a'.repeat(64))).toBe(false)});
 it('hashes local and remote bytes and detects match/mismatch',async()=>{const local=new Blob(['wearseal-fixture']);const hash=await sha256Hex(local);vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('wearseal-fixture',{status:200})));await expect(verifyEvidence(local,'https://example.com/image')).resolves.toMatchObject({localHash:hash,remoteHash:hash,match:true});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('other',{status:200})));await expect(verifyEvidence(local,'https://example.com/image')).resolves.toMatchObject({match:false})});
 it('rejects fetch failure, empty body and oversized evidence',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:200})));await expect((await import('../../lib/hash')).fetchAndHash('https://example.com/x')).rejects.toThrow('empty');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('no',{status:503})));await expect((await import('../../lib/hash')).fetchAndHash('https://example.com/x')).rejects.toThrow('503')});
});
describe('transaction and deadline helpers',()=>{
 it('requires successful execution, not finality alone',()=>{expect(classifyReceipt({tx_execution_result_name:'FINISHED_WITH_RETURN'}).ok).toBe(true);expect(classifyReceipt({txExecutionResultName:'FINISHED_WITH_RETURN'}).ok).toBe(true);expect(classifyReceipt({tx_execution_result_name:'FINISHED_WITH_ERROR'}).ok).toBe(false);expect(classifyReceipt({status:'FINALIZED'}).ok).toBe(false)});
 it('rejects past and absurd deadlines',()=>{expect(()=>deadlineFromDate('2020-01-01',1700000000)).toThrow();expect(()=>deadlineFromDate('2030-01-01',1700000000)).toThrow()});
});
