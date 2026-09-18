import LiveRoute from '../../../../components/live-route';
export const revalidate=11;
export default async function Baseline({params}:{params:Promise<{id:string}>}){return <LiveRoute id={(await params).id} action="accept"/>}
