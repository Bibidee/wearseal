export async function sha256Hex(file:Blob){const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function fetchAndHash(url:string){const r=await fetch(url);if(!r.ok)throw new Error(`Fetch failed: ${r.status}`);return sha256Hex(await r.blob())}
