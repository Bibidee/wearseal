import LiveRoute from '../../../../components/live-route';
export const revalidate=12;
export default async function Fund({params}:{params:Promise<{id:string}>}){return <LiveRoute id={(await params).id} action="fund"/>}
