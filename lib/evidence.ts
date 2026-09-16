export function validateEvidenceUrl(value:string){
 try{
  const u=new URL(value);const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(u.protocol!=='https:'||value.length>500||u.username||u.password||u.port||/^[^:]+:\/\/[^/]+:\d+(?:\/|$)/.test(value)||u.hash||/[\\\u0000-\u001f]/.test(value)||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal'))return false;
  const parts=host.split('.');if(!host||parts.some(p=>!p||p.length>63||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)))return false;
  if(/^\d+(?:\.\d+){3}$/.test(host)){const o=host.split('.').map(Number);const blocked=o.some(x=>x>255)||o[0]===0||o[0]===10||o[0]===127||(o[0]===169&&o[1]===254)||(o[0]===192&&o[1]===168)||(o[0]===172&&o[1]>=16&&o[1]<=31)||o[0]>=224;if(blocked)return false}
  if(host==='::1'||host.startsWith('fc')||host.startsWith('fd')||host.startsWith('fe80:'))return false;return true;
 }catch{return false}
}
export function validSha256(value:string){return /^0x[a-f0-9]{64}$/.test(value)}
