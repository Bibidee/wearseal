const PRIVATE=/^(localhost|.*\.(local|internal)|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|fc|fd)/i;
export function validateEvidenceUrl(value:string){try{const u=new URL(value);if(u.protocol!=='https:'||value.length>500||u.username||u.password||u.port||u.hash||/[\\\u0000-\u001f]/.test(value)||PRIVATE.test(u.hostname))return false;return !!u.hostname&&u.hostname.split('.').every(p=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(p))}catch{return false}}
export function validSha256(value:string){return /^0x[a-f0-9]{64}$/.test(value)}
