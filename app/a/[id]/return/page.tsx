import LiveRoute from '../../../../components/live-route';
export const revalidate=14;
export default async function ReturnProof({params}:{params:Promise<{id:string}>}){return <LiveRoute id={(await params).id} action="return"/>}
