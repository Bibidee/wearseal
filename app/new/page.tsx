'use client';

import {useState} from 'react';
import Link from 'next/link';
import SiteNav from '../../components/site-nav';
import HashDNA from '../../components/hash-dna';
import {useWallet} from '../../lib/wallet/provider';
import {verifyEvidence} from '../../lib/hash';
import {validateEvidenceUrl, validSha256} from '../../lib/evidence';
import {deadlineFromDate, defaultDeadline} from '../../lib/deadline';

const frozenSourceCommit = process.env.NEXT_PUBLIC_SOURCE_COMMIT || '';
const agreementSourceSha256 = (process.env.NEXT_PUBLIC_AGREEMENT_SOURCE_SHA256 || '').toLowerCase();
const vaultSourceSha256 = (process.env.NEXT_PUBLIC_VAULT_SOURCE_SHA256 || '').toLowerCase();
const attestorAddress = (process.env.NEXT_PUBLIC_ATTESTOR_ADDRESS || '').trim();
const base = frozenSourceCommit ? `https://raw.githubusercontent.com/Bibidee/wearseal/${frozenSourceCommit}` : '';
const agreementSource = `${base}/contracts/wearseal_agreement.py`;
const vaultSource = `${base}/contracts/wearseal_vault.py`;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function finalized(receipt: any) {
  const result = String(receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.txExecutionResultName || '');
  return /SUCCESS|FINISHED_WITH_RETURN/i.test(result) && !/ERROR|FAILED/i.test(result);
}

export default function New() {
  const wallet = useWallet();
  const [step, setStep] = useState(1);
  const [renter, setRenter] = useState('');
  const [label, setLabel] = useState('');
  const [serial, setSerial] = useState('');
  const [url, setUrl] = useState('');
  const [local, setLocal] = useState<File>();
  const [imageHash, setImageHash] = useState('');
  const [match, setMatch] = useState<boolean>();
  const [rubric, setRubric] = useState('Normal wear is acceptable; scratches are minor; cracks or missing parts are material.');
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [state, setState] = useState('IDLE');
  const [error, setError] = useState('');
  const [passport, setPassport] = useState('');

  const verify = async () => {
    try {
      setError('');
      if (!local) throw Error('Select the local checkout image first.');
      if (!validateEvidenceUrl(url)) throw Error('Use a safe HTTPS evidence URL.');
      const result = await verifyEvidence(local, url);
      setImageHash(result.localHash); setMatch(result.match);
      if (!result.match) throw Error('Local and remote evidence hashes do not match.');
    } catch (e) { setMatch(false); setError(e instanceof Error ? e.message : String(e)); }
  };

  const publish = async () => {
    try {
      setError('');
      if (!wallet?.client || !wallet.account) throw Error('Connect a wallet first.');
      if (!wallet.onStudionet) throw Error('Switch wallet to Studionet 61999.');
      if (!/^0x[a-fA-F0-9]{40}$/.test(renter) || renter.toLowerCase() === `0x${'0'.repeat(40)}` || renter.toLowerCase() === wallet.account.toLowerCase()) throw Error('Enter a different, non-zero renter address.');
      if (!/^0x[a-fA-F0-9]{40}$/.test(attestorAddress) || attestorAddress.toLowerCase() === `0x${'0'.repeat(40)}`) throw Error('Configured attestor address is missing or invalid.');
      if (!label || !imageHash || match !== true || !validSha256(imageHash)) throw Error('Verify the checkout evidence before deployment.');
      if (!frozenSourceCommit || !/^[0-9a-f]{7,40}$/i.test(frozenSourceCommit) || !/^[0-9a-f]{64}$/.test(agreementSourceSha256) || !/^[0-9a-f]{64}$/.test(vaultSourceSha256)) throw Error('Frozen source verification is not configured.');
      const deadlineTimestamp = deadlineFromDate(deadline);
      setState('FETCHING SOURCES');
      const [aResponse, vResponse] = await Promise.all([fetch(agreementSource), fetch(vaultSource)]);
      if (!aResponse.ok || !vResponse.ok) throw Error('Frozen contract source could not be fetched.');
      const [aCode, vCode] = await Promise.all([aResponse.text(), vResponse.text()]);
      if (await sha256(aCode) !== agreementSourceSha256 || await sha256(vCode) !== vaultSourceSha256) throw Error('Frozen contract source hash mismatch.');
      setState('DEPLOYING AGREEMENT');
      const aHash = await wallet.client.deployContract({code: aCode, args: [wallet.account, renter, label, serial, rubric, url, imageHash, 1000000000000000n, 1500, 10000, deadlineTimestamp]});
      const ar = await wallet.client.waitForTransactionReceipt({hash: aHash, status: 'FINALIZED', retries: 220, interval: 5000});
      if (!finalized(ar)) throw Error('Agreement deployment failed.');
      const agreement = ar.data?.contract_address;
      if (!agreement) throw Error('Agreement address was not returned.');
      setState('DEPLOYING VAULT');
      const vHash = await wallet.client.deployContract({code: vCode, args: [agreement, attestorAddress]});
      const vr = await wallet.client.waitForTransactionReceipt({hash: vHash, status: 'FINALIZED', retries: 220, interval: 5000});
      if (!finalized(vr)) throw Error('Vault deployment failed.');
      const vault = vr.data?.contract_address;
      if (!vault) throw Error('Vault address was not returned.');
      setState('BINDING');
      const bHash = await wallet.client.writeContract({address: agreement, functionName: 'bind_vault', args: [vault]});
      const br = await wallet.client.waitForTransactionReceipt({hash: bHash, status: 'FINALIZED', retries: 220, interval: 5000});
      if (!finalized(br)) throw Error('Binding failed.');
      const bound = await wallet.client.readContract({address: agreement, functionName: 'get_agreement', args: []}) as any;
      const readback = await wallet.client.readContract({address: vault, functionName: 'get_vault', args: []}) as any;
      if (String(bound.vault).toLowerCase() !== String(vault).toLowerCase()) throw Error('Agreement Vault binding readback mismatch.');
      if (String(readback.agreement).toLowerCase() !== String(agreement).toLowerCase()) throw Error('Vault Agreement binding readback mismatch.');
      if (String(readback.attestor).toLowerCase() !== attestorAddress.toLowerCase()) throw Error('Vault attestor readback mismatch.');
      setPassport(agreement); setState('READY');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setState('ERROR'); }
  };

  return <main className="wrap"><SiteNav/><div className="page-shell form-shell"><div className="kicker">NEW AGREEMENT · STUDIONET 61999</div><h1 className="page-title">Seal the baseline.</h1><p className="subhead">A five-step handoff record. Every value stays visible before deployment.</p><div className="stepper">{[1,2,3,4,5].map(x=><i className={`step-dot ${x<=step?'active':''}`} key={x}/>)}</div>
    {step===1&&<section className="form-card"><div className="eyebrow">STEP 01 / ITEM</div><h2>Identify the equipment.</h2><label className="form-label">ITEM NAME<input className="plate" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Enter item name"/></label><label className="form-label">RENTER ADDRESS<input className="plate" value={renter} onChange={e=>setRenter(e.target.value)} placeholder="0x renter address"/></label><label className="form-label">SERIAL OR REFERENCE<input className="plate" value={serial} onChange={e=>setSerial(e.target.value)} placeholder="Enter serial or reference"/></label><button className="button" onClick={()=>setStep(2)}>CONTINUE →</button></section>}
    {step===2&&<section className="form-card"><div className="eyebrow">STEP 02 / CHECKOUT EVIDENCE</div><h2>Verify the exact image.</h2><label className="form-label">LOCAL CHECKOUT IMAGE<input className="plate" type="file" accept="image/*" onChange={e=>{setLocal(e.target.files?.[0]);setMatch(undefined);setImageHash('')}}/></label><label className="form-label">PUBLIC HTTPS URL<input className="plate" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://your-public-image-url"/></label><button className="button secondary" onClick={verify}>FETCH + COMPARE BYTES</button>{imageHash&&<div className="tx-banner"><strong>{match?'MATCH · HASH VERIFIED':'MISMATCH · DEPLOYMENT BLOCKED'}</strong><HashDNA hash={imageHash}/><p className="mono">LOCAL {imageHash}</p></div>}<button className="button" disabled={match!==true} onClick={()=>setStep(3)}>LOCK EVIDENCE →</button></section>}
    {step===3&&<section className="form-card"><div className="eyebrow">STEP 03 / CONDITION POLICY</div><h2>Make the payout rule legible.</h2><label className="form-label">POLICY RUBRIC<textarea className="plate" value={rubric} onChange={e=>setRubric(e.target.value)}/></label><div className="policy-grid"><div className="policy-card"><span className="eyebrow">MINOR DAMAGE</span><strong>OWNER 15%</strong><span>RENTER 85%</span></div><div className="policy-card"><span className="eyebrow">MATERIAL DAMAGE</span><strong>OWNER 100%</strong><span>RENTER 0%</span></div></div><button className="button" onClick={()=>setStep(4)}>CONTINUE →</button></section>}
    {step===4&&<section className="form-card"><div className="eyebrow">STEP 04 / DEPOSIT + DEADLINE</div><h2>Set the boundary.</h2><div className="policy-grid"><div className="policy-card"><span className="eyebrow">SECURITY DEPOSIT</span><strong>1,000,000,000,000,000</strong><span>wei · exact amount</span></div><div className="policy-card"><span className="eyebrow">DEADLINE</span><input className="plate" type="date" value={deadline} onChange={e=>setDeadline(e.target.value)}/><span>meaningful expiry window</span></div></div><button className="button" onClick={()=>{try{deadlineFromDate(deadline);setStep(5)}catch(e){setError(String(e))}}}>REVIEW →</button></section>}
    {step===5&&<section className="form-card"><div className="eyebrow">STEP 05 / REVIEW</div><h2>Ready to seal.</h2><div className="proof-grid"><div className="proof-item"><label>ITEM</label><code>{label||'—'}</code></div><div className="proof-item"><label>RENTER</label><code>{renter||'—'}</code></div><div className="proof-item"><label>CHECKOUT HASH</label><code>{imageHash||'—'}</code></div><div className="proof-item"><label>DEADLINE</label><code>{deadline} 23:59:59 UTC</code></div></div><button className="button" disabled={state!=='IDLE'&&state!=='ERROR'} onClick={publish}>{state==='IDLE'?'DEPLOY AGREEMENT →':state}</button></section>}
    {error&&<div className="tx-banner"><strong>CHECK THE RECORD</strong>{error}</div>}{passport&&<div className="tx-banner"><strong>AGREEMENT DEPLOYED</strong><Link href={`/a/${passport}`}>OPEN CONDITION PASSPORT →</Link></div>}</div></main>;
}
