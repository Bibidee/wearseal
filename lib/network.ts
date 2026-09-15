export const STUDIONET={name:'Studionet',chainId:61999,rpc:'https://studio.genlayer.com/api',explorer:'https://explorer-studio.genlayer.com'} as const;
export function explorerTx(hash:string){return `${STUDIONET.explorer}/tx/${hash}`}
