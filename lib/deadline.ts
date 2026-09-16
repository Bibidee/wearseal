export const DEFAULT_DEADLINE_DAYS=7;
export function deadlineFromDate(value:string,now=Math.floor(Date.now()/1000)){const timestamp=Math.floor(new Date(`${value}T23:59:59Z`).getTime()/1000);if(!Number.isSafeInteger(timestamp)||timestamp<=now||timestamp>now+366*24*60*60)throw new Error('Choose a future deadline within one year.');return BigInt(timestamp)}
export function defaultDeadline(now=new Date()){const d=new Date(now);d.setUTCDate(d.getUTCDate()+DEFAULT_DEADLINE_DAYS);return d.toISOString().slice(0,10)}
