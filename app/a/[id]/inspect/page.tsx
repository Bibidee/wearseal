import LiveRoute from '../../../../components/live-route';
export const revalidate=13;
export default async function Inspect({params}:{params:Promise<{id:string}>}){return <LiveRoute id={(await params).id} action="inspect"/>}
