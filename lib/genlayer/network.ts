export const STUDIONET={id:61999,name:'Studionet',rpcUrl:'https://studio.genlayer.com/api',explorer:'https://explorer-studio.genlayer.com',currency:'GEN',decimals:18} as const;
export const explorerTx=(hash:string)=>`${STUDIONET.explorer}/tx/${hash}`;
export const isStudionet=(id?:string)=>id?.toLowerCase()===`0x${STUDIONET.id.toString(16)}`;
