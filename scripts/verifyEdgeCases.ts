/**
 * Edge-case check of the reader's pause / cancel math against the program, on a
 * throwaway devnet token with a 10-minute schedule (no cliff, 60s steps).
 *   Lock A (pausable):  pause at ~T+130s, resume ~120s later, claim  → compare
 *   Lock B (cancelable): cancel at ~T+250s, claim                   → compare, status cancelled
 * Usage: KEYPAIR=... npx tsx scripts/verifyEdgeCases.ts
 */
import {
  addClaimScheduleBucketV2,
  cancelClaimScheduleBucketV2,
  ConditionArgs,
  FEE_WALLET,
  fetchClaimScheduleBucketV2,
  finalizeV2,
  findClaimScheduleBucketV2Pda,
  findGenesisAccountV2Pda,
  initializeV2,
  setClaimSchedulePausedStateV2,
  WRAPPED_SOL_MINT,
} from '@metaplex-foundation/genesis';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { generateSigner } from '@metaplex-foundation/umi';
import { claimAndVerify, makeUmi } from './verifyClaim.js';
import { readLock } from '../examples/read_vesting_locks/umi.js';

const umi = makeUmi().use(mplTokenMetadata());
const me = umi.identity.publicKey;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const ALLOC = 600_000_000n; // 600 tokens @ 6 decimals per lock
const now = BigInt(Math.floor(Date.now() / 1000));
const timeAbs = (time: bigint): ConditionArgs => ({ __kind: 'TimeAbsolute', padding: Array(47).fill(0), time, triggeredTimestamp: null });
const never: ConditionArgs = { __kind: 'Never', padding: Array(55).fill(0), triggeredTimestamp: null };

const baseMint = generateSigner(umi);
const [genesisAccount] = findGenesisAccountV2Pda(umi, { baseMint: baseMint.publicKey, genesisIndex: 0 });
const [lockA] = findClaimScheduleBucketV2Pda(umi, { genesisAccount, bucketIndex: 0 });
const [lockB] = findClaimScheduleBucketV2Pda(umi, { genesisAccount, bucketIndex: 1 });
const opts = { confirm: { commitment: 'confirmed' as const } };

await initializeV2(umi, {
  baseMint, quoteMint: WRAPPED_SOL_MINT, decimals: 6, genesisIndex: 0, fundingMode: 0,
  totalSupplyBaseToken: 2n * ALLOC, name: 'Genesis Vesting Edge Cases', symbol: 'GVEDGE', uri: '',
}).prepend(setComputeUnitLimit(umi, { units: 400_000 })).sendAndConfirm(umi, opts);

for (const [i, policy] of [{ pausable: true, cancelable: false }, { pausable: false, cancelable: true }].entries()) {
  await addClaimScheduleBucketV2(umi, {
    genesisAccount, baseMint: baseMint.publicKey, quoteMint: WRAPPED_SOL_MINT, recipient: me, feeWallet: FEE_WALLET,
    bucketIndex: i, baseTokenAllocation: ALLOC,
    claimSchedule: { startCondition: timeAbs(now), duration: 600n, period: 60n, cliffCondition: never, cliffAmountBps: 0, reserved: Array(126).fill(0) },
    claimStartCondition: timeAbs(now - 60n),
    cancelableByRecipient: false, transferable: false, transferableByRecipient: false, ...policy,
    padding: [0], backendSigner: null, reserved: [0, 0, 0, 0], endBehaviors: [],
  } as any).sendAndConfirm(umi, opts);
}
await finalizeV2(umi, { baseMint: baseMint.publicKey, genesisAccount })
  .addRemainingAccounts([lockA, lockB].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
  .sendAndConfirm(umi, opts);
console.log('mint', baseMint.publicKey, 'lockA', lockA, 'lockB', lockB);

await sleep(130);
await setClaimSchedulePausedStateV2(umi, { genesisAccount, bucket: lockA, signer: umi.identity, paused: true, padding: Array(6).fill(0) }).sendAndConfirm(umi, opts);
console.log('paused A; reader:', readLock(await fetchClaimScheduleBucketV2(umi, lockA), Math.floor(Date.now() / 1000)).status);

await sleep(120);
await cancelClaimScheduleBucketV2(umi, { genesisAccount, bucket: lockB, signer: umi.identity, padding: Array(7).fill(0) }).sendAndConfirm(umi, opts);
await setClaimSchedulePausedStateV2(umi, { genesisAccount, bucket: lockA, signer: umi.identity, paused: false, padding: Array(6).fill(0) }).sendAndConfirm(umi, opts);

const b = readLock(await fetchClaimScheduleBucketV2(umi, lockB, { commitment: 'confirmed' }), Math.floor(Date.now() / 1000));
console.log('B after cancel:', b.status, 'vested', b.vested, 'forfeited', b.allocation - b.vested, 'locked', b.locked);
await claimAndVerify(umi, lockB, 'edge:cancelled');

await sleep(60);
const a = await fetchClaimScheduleBucketV2(umi, lockA, { commitment: 'confirmed' });
console.log('A totalSecondsPaused', a.totalSecondsPaused);
await claimAndVerify(umi, lockA, 'edge:after-pause');
