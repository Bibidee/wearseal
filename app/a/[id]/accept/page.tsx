import {redirect} from 'next/navigation';

export default async function AcceptAlias({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  redirect(`/a/${id}/baseline`);
}
