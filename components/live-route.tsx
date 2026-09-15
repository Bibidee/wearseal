'use client'; /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {readAgreement,readVault,requireAddress} from '../lib/genlayer/contracts';
import {addresses} from '../lib/genlayer/contracts';
import {submitAndConfirm,TxState} from '../lib/genlayer/transaction';
import {useWallet} from '../lib/wallet/provider';

type Action='accept'|'fund'|'return'|'inspect'|'receipt';
export default function LiveRoute({id,action}:{id:string;action:Action}){
  const wallet=useWallet(); const [agreement,setAgreement]=useState<any>(); const [vault,setVault]=useState<any>(); const [value,setValue]=useState(''); const [hash,setHash]=useState(''); const [tx,setTx]=useState<TxState>({phase:'IDLE'}); const [error,setError]=useState('');
  const agreementAddress=useMemo(()=>{try{return requireAddress(id,'Agreement')}catch{return ''}},[id]);
  const vaultAddress=useMemo(()=>{try{return requireAddress(addresses.vault,'Vault')}catch{return ''}},[]);
  const refresh=async()=>{if(!agreementAddress)return false;const [a,v]=await Promise.all([readAgreement(agreementAddress),vaultAddress?readVault(vaultAddress):Promise.resolve(null)]);setAgreement(a);setVault(v);return true};
  useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[agreementAddress]);
  const run=async()=>{try{setError('');if(!wallet?.client)throw Error('Connect a Studionet wallet first.');if(!wallet.onStudionet)throw Error('Switch wallet to Studionet 61999.');if(!agreementAddress)throw Error('Enter a valid Agreement address.');const call:any=action==='accept'?{address:agreementAddress,functionName:'accept_baseline',args:[value]}:action==='fund'?{address:vaultAddress,functionName:'deposit',args:[],value:BigInt(agreement.deposit)}:action==='return'?{address:agreementAddress,functionName:'submit_return',args:[value,hash]}:action==='inspect'?{address:agreementAddress,functionName:'inspect',args:[]}:null;if(!call)throw Error('This page is read-only.');await submitAndConfirm(wallet.client,call,refresh,setTx);}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const title={accept:'Accept the exact passport.',fund:'Deposit the exact security.',return:'Pin the return.',inspect:'Compare the exact pair.',receipt:'Settlement receipt.'}[action];
  return <main className="wrap"><nav className="nav"><Link className="wordmark" href={`/a/${id}`}>WEARSEAL<span className="orange">/</span></Link><span className="mono">{action.toUpperCase()} · STUDIONET 61999</span></nav><section style={{maxWidth:760,margin:'60px auto'}}><div className="mono orange">AUTHORITATIVE CONTRACT STATE</div><h1>{title}</h1>{error&&<p className="orange">{error}</p>}<div className="plate card mono">{agreement?<>STATUS: {agreement.status}<br/>OWNER: {agreement.owner}<br/>RENTER: {agreement.renter}<br/>DEPOSIT: {String(agreement.deposit)}<br/>VERDICT: {agreement.verdict||'—'}{vault&&<><br/>VAULT: {vault.settled?'SETTLED':String(vault.credited)}</>}</>: 'READING LIVE STATE…'}</div>{action==='accept'&&<input className="plate" placeholder="0x + 64-character definition hash" value={value} onChange={e=>setValue(e.target.value)}/>} {action==='return'&&<><input className="plate" placeholder="Return HTTPS image URL" value={value} onChange={e=>setValue(e.target.value)}/><input className="plate" placeholder="0x + 64-character SHA-256" value={hash} onChange={e=>setHash(e.target.value)}/></>} {action!=='receipt'&&<button className="button" onClick={run} disabled={tx.phase==='AWAITING_SIGNATURE'||tx.phase==='CONSENSUS_RUNNING'}>{tx.phase==='IDLE'?'EXECUTE + CONFIRM':tx.phase}</button>}{tx.hash&&<p className="mono">TX: {tx.hash}</p>}<p><Link href={`/a/${id}`}>← BACK TO PASSPORT</Link></p></section></main>;
}
