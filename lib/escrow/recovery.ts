export type RecoveryState = {
  agreement: string;
  credited: bigint;
  settled: boolean;
  payoutSet: boolean;
  fundingTx?: string | null;
  authorizationTx?: string | null;
  refundTx?: string | null;
  ownerClaimTx?: string | null;
  renterClaimTx?: string | null;
  ownerClaimed: boolean;
  renterClaimed: boolean;
};

export type RecoveryAction = 'fund' | 'funding_ack' | 'settle' | 'allocate' | 'authorize_refund' | 'claim_refund' | 'refund_ack' | 'claim_owner' | 'owner_ack' | 'claim_renter' | 'renter_ack' | 'complete';

export function nextRecoveryAction(state: RecoveryState, role: 'owner' | 'renter'): RecoveryAction {
  if (state.agreement === 'CANCELLED') {
    if (state.refundTx && !state.renterClaimed) return 'refund_ack';
    if (state.authorizationTx && !state.renterClaimed) return 'claim_refund';
    if (state.renterClaimed) return 'complete';
    return 'authorize_refund';
  }
  if (state.agreement === 'BASELINE_ACCEPTED' && state.credited === 0n) return state.fundingTx ? 'funding_ack' : 'fund';
  if (state.agreement === 'DECIDED' && state.settled) return state.payoutSet ? (role === 'owner' ? 'claim_owner' : 'claim_renter') : 'allocate';
  if (state.agreement === 'SETTLED' && !state.payoutSet) return 'allocate';
  if (state.agreement === 'SETTLED' && role === 'owner') {
    if (state.ownerClaimed) return 'complete';
    return state.ownerClaimTx ? 'owner_ack' : 'claim_owner';
  }
  if (state.agreement === 'SETTLED') {
    if (state.renterClaimed) return 'complete';
    return state.renterClaimTx ? 'renter_ack' : 'claim_renter';
  }
  if (state.agreement === 'FUNDED') return 'complete';
  return 'settle';
}
