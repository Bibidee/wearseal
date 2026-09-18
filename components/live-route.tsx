'use client';
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import {useEffect, useMemo, useState} from 'react';
import SiteNav from './site-nav';
import EvidenceCard from './evidence-card';
import Identicon from './identicon';
import HashDNA from './hash-dna';
import InspectionRoom from './inspection-room';
import {readAgreement, readVault, requireAddress} from '../lib/genlayer/contracts';
import {submitAndConfirm, TxState} from '../lib/genlayer/transaction';
import {useWallet} from '../lib/wallet/provider';
import {verifyEvidence} from '../lib/hash';
import {validateEvidenceUrl} from '../lib/evidence';
import {explorerTx} from '../lib/genlayer/network';

type Action = 'accept' | 'fund' | 'return' | 'inspect' | 'receipt';
type Mode = 'SIDE BY SIDE' | 'SLIDER' | 'BLINK' | 'ZOOM';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const short = (value: string) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '—';
const txLabel = (phase: TxState['phase']) => phase.replaceAll('_', ' ');

export default function LiveRoute({id, action}: {id: string; action: Action}) {
  const wallet = useWallet();
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [proof, setProof] = useState(false);
  const [mode, setMode] = useState<Mode>('SIDE BY SIDE');
  const [agreement, setAgreement] = useState<any>();
  const [vault, setVault] = useState<any>();
  const [value, setValue] = useState('');
  const [hash, setHash] = useState('');
  const [local, setLocal] = useState<File>();
  const [match, setMatch] = useState<boolean>();
  const txStorageKey = `wearseal:tx:${id}:${action}`;
  const [tx, setTx] = useState<TxState>(() => {
    if (typeof window === 'undefined') return {phase: 'IDLE'};
    try { return JSON.parse(window.sessionStorage.getItem(txStorageKey) || '') as TxState; } catch { return {phase: 'IDLE'}; }
  });
  const [error, setError] = useState('');
  const agreementAddress = useMemo(() => { try { return requireAddress(id, 'Agreement'); } catch { return ''; } }, [id]);
  const vaultAddress = agreement?.vault ? String(agreement.vault) : '';
  const read = async () => { if (!agreementAddress) return {a: null, v: null}; const a = await readAgreement(agreementAddress); const v = a?.vault ? await readVault(requireAddress(String(a.vault), 'Vault')) : null; setAgreement(a); setVault(v); return {a, v}; };
  useEffect(() => { void read().catch(e => setError(String(e))); }, [agreementAddress]);
  useEffect(() => { if (tx.hash) window.sessionStorage.setItem(txStorageKey, JSON.stringify(tx)); }, [tx, txStorageKey]);
  const expected = async (before: any) => { for (let i = 0; i < 12; i++) { const {a, v} = await read(); if (action === 'accept' && a?.status === 'BASELINE_ACCEPTED') return true; if (action === 'fund' && a?.status === 'FUNDED' && v?.credited === BigInt(a.deposit)) return true; if (action === 'return' && a?.status === 'RETURN_SUBMITTED' && a.return_url === value && a.return_hash === hash) return true; if (action === 'inspect' && (a?.status === 'DECIDED' || (a?.status === 'RETURN_SUBMITTED' && BigInt(a.reinspection_count) > BigInt(before?.reinspection_count || 0)))) return true; await wait(5000); } return false; };
  const verifyReturn = async () => { try { setError(''); if (!local) throw Error('Select the local return image first.'); if (!validateEvidenceUrl(value)) throw Error('Use a safe HTTPS return URL.'); const result = await verifyEvidence(local, value); setHash(result.localHash); setMatch(result.match); if (!result.match) throw Error('Local and remote return hashes do not match.'); } catch (e) { setMatch(false); setError(e instanceof Error ? e.message : String(e)); } };
  const run = async () => { try { setError(''); if (!wallet?.client || !wallet.account) throw Error('Connect a Studionet wallet first.'); if (!wallet.onStudionet) throw Error('Switch wallet to Studionet 61999.'); const before = agreement; let call: any; if (action === 'accept') call = {address: agreementAddress, functionName: 'accept_baseline', args: [value]}; else if (action === 'fund') call = {address: vaultAddress, functionName: 'deposit', args: [], value: BigInt(agreement.deposit)}; else if (action === 'return') { if (match !== true) throw Error('Verify the local and remote return images first.'); call = {address: agreementAddress, functionName: 'submit_return', args: [value, hash]}; } else if (action === 'inspect') call = {address: agreementAddress, functionName: 'inspect', args: []}; else throw Error('This page is read-only.'); await submitAndConfirm(wallet.client, call, () => expected(before), setTx); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const expire = async () => { const before = agreement; await submitAndConfirm(wallet.client, {address: agreementAddress, functionName: 'expire', args: []}, async () => { for (let i = 0; i < 12; i++) { const {a} = await read(); if (a?.status === 'CANCELLED' || a?.status === 'DECIDED') return a?.status !== before?.status; await wait(5000); } return false; }, setTx); };
  const status = agreement?.status || 'READING';
  const stages = ['BASELINE', 'FUNDED', 'RETURN', 'INSPECTION', 'VERDICT', 'SETTLEMENT'];
  const stageState = (stage: string) => { const map: Record<string, number> = {DRAFT: 0, BASELINE_PENDING: 0, BASELINE_ACCEPTED: 1, FUNDED: 2, ACTIVE: 2, RETURN_SUBMITTED: 3, INSPECTING: 3, DECIDED: 5, SETTLED: 6, CANCELLED: 6}; const n = map[status] ?? 0; return n > stages.indexOf(stage) ? 'done' : n === stages.indexOf(stage) + 1 ? 'current' : ''; };
  const settlement = agreement && vault && agreement.deposit ? {owner: BigInt(vault.owner_claim || 0), renter: BigInt(vault.renter_claim || 0)} : null;
  return <main className="wrap"><SiteNav/><div className="page-shell">
    <div className="passport-top"><div><div className="kicker">WEARSEAL CONDITION PASSPORT</div><h1 className="page-title">{agreement?.item_label || 'Live Agreement'}</h1><p className="subhead">A hash-bound equipment record for a two-party rental. The state below is read directly from Agreement {short(agreementAddress)}.</p><span className={`status-pill ${['SETTLED', 'BASELINE_ACCEPTED', 'FUNDED', 'DECIDED'].includes(status) ? 'good' : ''}`}>{status}</span></div><div className="seal">{status === 'SETTLED' ? 'AGREEMENT CLOSED' : status === 'DECIDED' ? 'CONDITION SEALED' : 'BASELINE RECORD'}</div></div>
    {agreement && <>
      <div className="passport-meta"><div className="meta-cell"><label>AGREEMENT</label><strong className="mono">{short(agreementAddress)}</strong></div><div className="meta-cell"><label>DEPOSIT</label><strong>{String(agreement.deposit)} GEN</strong></div><div className="meta-cell"><label>DEADLINE</label><strong>{new Date(Number(agreement.deadline) * 1000).toLocaleDateString()}</strong></div><div className="meta-cell"><label>VAULT</label><strong className="mono">{short(vaultAddress)}</strong></div></div>
      <div className="lifecycle">{stages.map((stage, i) => <div className={`stage ${stageState(stage)}`} key={stage}><b>0{i + 1}</b><br/>{stage}</div>)}</div>
      <section className="passport-section"><h3>01 / PEOPLE & POLICY</h3><div className="proof-grid"><div className="proof-item"><label>OWNER</label><div className="person"><Identicon address={agreement.owner}/><code>{short(agreement.owner)}</code></div></div><div className="proof-item"><label>RENTER</label><div className="person"><Identicon address={agreement.renter}/><code>{short(agreement.renter)}</code></div></div><div className="proof-item"><label>POLICY</label><code>{agreement.minor_bps} bps minor / {agreement.material_bps} bps material</code></div></div></section>
      <section className="passport-section"><h3>02 / EVIDENCE INTEGRITY</h3><div className="evidence-grid"><EvidenceCard kind="CHECKOUT" url={agreement.checkout_url} hash={agreement.checkout_hash}/>{agreement.return_url ? <EvidenceCard kind="RETURN" url={agreement.return_url} hash={agreement.return_hash}/> : <div className="proof-item"><div className="eyebrow">RETURN EVIDENCE</div><p className="subhead">Waiting for the renter to submit a verified return image.</p></div>}</div></section>
      {agreement.return_url && <section className="passport-section"><div className="section-head"><div><div className="kicker">INSPECTION ROOM</div><h3>What changed between handoff and return?</h3></div></div><div className="inspection-panel"><InspectionRoom checkoutUrl={agreement.checkout_url} returnUrl={agreement.return_url} mode={mode} onModeChange={setMode}/><div className="result-box"><h4>GENLAYER INSPECTION</h4><div className="verdict">{agreement.verdict || 'PENDING'}</div><div className="result-list"><div className="result-row"><span>Same item</span><span>{agreement.same_item || '—'}</span></div><div className="result-row"><span>Identity confidence</span><span>{agreement.same_item_confidence || '—'}</span></div><div className="result-row"><span>New damage</span><span>{agreement.new_damage_present || '—'}</span></div><div className="result-row"><span>Damage level</span><span>{agreement.damage_level || '—'}</span></div><div className="result-row"><span>Region / reason</span><span>{agreement.damage_regions?.join('; ') || '—'}</span></div></div></div></div></section>}
      <section className="passport-section"><h3>03 / SETTLEMENT</h3>{settlement && <div className="settlement"><div className="allocation owner"><h4>OWNER · {Number(settlement.owner) * 100 / Number(agreement.deposit || 1)}%</h4><strong>{String(settlement.owner)}</strong><small>Allocation {vault.owner_claim ? 'AVAILABLE' : 'NONE'} · Claim {vault.owner_claimed ? 'FINALIZED' : 'PENDING'}</small></div><div className="allocation renter"><h4>RENTER · {Number(settlement.renter) * 100 / Number(agreement.deposit || 1)}%</h4><strong>{String(settlement.renter)}</strong><small>Allocation {vault.renter_claim ? 'AVAILABLE' : 'NONE'} · Claim {vault.renter_claimed ? 'FINALIZED' : 'PENDING'}</small></div></div>}<p className="subhead">Vault remaining: <strong>{String(vault?.credited || 0)}</strong>. Allocations and claims are shown from authoritative Vault state.</p></section>
      <section className="passport-section"><h3>04 / PROOF MODE</h3><button className="button secondary" onClick={() => setProof(!proof)}>{proof ? 'PRODUCT VIEW' : 'PROOF VIEW'}</button>{proof && <div className="proof-grid proof-output"><div className="proof-item"><label>DEFINITION HASH</label><HashDNA hash={agreement.definition_hash}/><code>{agreement.definition_hash}</code></div><div className="proof-item"><label>RETURN HASH</label><code>{agreement.return_hash || '—'}</code></div><div className="proof-item"><label>CHAIN</label><code>GENLAYER STUDIONET · 61999</code></div></div>}</section>
    </>}
    {error && <div className="tx-banner"><strong>CANONICAL ERROR</strong>{error}</div>}
    {tx.hash && <div className="tx-banner"><strong>{txLabel(tx.phase)}</strong><a className="mono" href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">{tx.hash}</a><a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">OPEN IN STUDIONET EXPLORER →</a>{tx.error && <span>{tx.error}</span>}</div>}
    {action === 'accept' && <section className="form-card"><h2>Seal the baseline.</h2><label className="form-label">CANONICAL DEFINITION HASH<input className="plate" value={value} onChange={e => setValue(e.target.value)} placeholder="0x + 64-character definition hash"/></label><button className="button" onClick={run}>{tx.phase === 'IDLE' ? 'ACCEPT BASELINE →' : tx.phase}</button></section>}
    {action === 'fund' && <section className="form-card"><h2>Fund the exact security.</h2><p className="subhead">Deposit exactly {String(agreement?.deposit || '—')} wei. Funding confirmation waits for Agreement and Vault state to agree.</p><button className="button" onClick={run}>{tx.phase === 'IDLE' ? 'FUND AGREEMENT →' : tx.phase}</button></section>}
    {action === 'return' && <section className="form-card"><h2>Verify the return image.</h2><label className="form-label">LOCAL RETURN IMAGE<input className="plate" type="file" accept="image/*" onChange={e => {setLocal(e.target.files?.[0]); setMatch(undefined); setHash('');}}/></label><label className="form-label">PUBLIC HTTPS RETURN URL<input className="plate" value={value} onChange={e => setValue(e.target.value)}/></label><button className="button secondary" onClick={verifyReturn}>VERIFY BYTES</button>{hash && <p className="mono">REMOTE HASH {hash} · {match ? 'MATCH' : 'MISMATCH'}</p>}<button className="button" onClick={run}>{tx.phase === 'IDLE' ? 'SUBMIT RETURN →' : tx.phase}</button></section>}
    {action === 'inspect' && <section className="form-card"><h2>Run the evidence pair.</h2><p className="subhead">GenLayer will fetch the committed bytes, compare the images, and return a bounded semantic result.</p><button className="button" onClick={run}>{tx.phase === 'IDLE' ? 'START INSPECTION →' : tx.phase}</button></section>}
    {agreement && Number(agreement.deadline) < now && !['SETTLED', 'CANCELLED'].includes(status) && <button className="button secondary" onClick={expire}>EXPIRE AGREEMENT</button>}
  </div></main>;
}
