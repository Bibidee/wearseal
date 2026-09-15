import './globals.css';import {WalletProvider} from '../lib/wallet/provider';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><WalletProvider>{children}</WalletProvider></body></html>}
