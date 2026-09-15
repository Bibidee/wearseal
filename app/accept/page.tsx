import LiveRoute from '../../components/live-route';
export default function Accept(){return <LiveRoute id={process.env.NEXT_PUBLIC_AGREEMENT_ADDRESS||''} action="accept"/>}
