import {describe, expect, it} from 'vitest';
import {nextRecoveryAction, RecoveryState} from '../../lib/escrow/recovery';

const base = (overrides: Partial<RecoveryState> = {}): RecoveryState => ({agreement: 'BASELINE_ACCEPTED', credited: 0n, settled: false, payoutSet: false, ownerClaimed: false, renterClaimed: false, ...overrides});

describe('authoritative transaction recovery', () => {
  it('continues after registration without a duplicate deposit', () => expect(nextRecoveryAction(base({fundingTx: '0xfund'}), 'renter')).toBe('funding_ack'));
  it('does not require another funding transaction after acknowledgement', () => expect(nextRecoveryAction(base({agreement: 'FUNDED', credited: 10n, fundingTx: '0xfund'}), 'renter')).toBe('complete'));
  it('retries only allocation after GenLayer settlement', () => expect(nextRecoveryAction(base({agreement: 'SETTLED', credited: 0n, settled: true}), 'owner')).toBe('allocate'));
  it('does not allocate twice after a lost API response', () => expect(nextRecoveryAction(base({agreement: 'SETTLED', credited: 0n, settled: true, payoutSet: true}), 'owner')).toBe('claim_owner'));
  it('continues from refund authorization without authorizing twice', () => expect(nextRecoveryAction(base({agreement: 'CANCELLED', credited: 10n, authorizationTx: '0xauth'}), 'renter')).toBe('claim_refund'));
  it('retries only refund acknowledgement after Base payment', () => expect(nextRecoveryAction(base({agreement: 'CANCELLED', credited: 10n, refundTx: '0xrefund'}), 'renter')).toBe('refund_ack'));
  it('retries only owner acknowledgement after a recovered claim event', () => expect(nextRecoveryAction(base({agreement: 'SETTLED', settled: true, payoutSet: true, ownerClaimTx: '0xowner'}), 'owner')).toBe('owner_ack'));
  it('retries only renter acknowledgement after a recovered claim event', () => expect(nextRecoveryAction(base({agreement: 'SETTLED', settled: true, payoutSet: true, renterClaimTx: '0xrenter'}), 'renter')).toBe('renter_ack'));
  it('marks an acknowledged payout complete', () => expect(nextRecoveryAction(base({agreement: 'SETTLED', settled: true, payoutSet: true, ownerClaimed: true}), 'owner')).toBe('complete'));
});
