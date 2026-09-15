import LiveRoute from '../../../components/live-route';
export default async function Passport({params}:{params:Promise<{id:string}>}){return <LiveRoute id={(await params).id} action="receipt"/>}
