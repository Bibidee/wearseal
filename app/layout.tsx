import './globals.css';import './inspection-room.css';import {WalletProvider} from '../lib/wallet/provider';
export const metadata={title:'WearSeal — Condition Protocol',description:'Hash-bound equipment condition records and rental escrow on GenLayer Studionet.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><WalletProvider>{children}</WalletProvider></body></html>}
