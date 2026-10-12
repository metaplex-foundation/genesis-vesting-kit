/**
 * Creates a Genesis test token with live vesting locks for integration testing.
 *
 * Usage: KEYPAIR=~/path/id.json RPC=https://api.devnet.solana.com npx tsx scripts/createTestToken.ts
 *
 * Layout (1,000,000,000 tokens, 6 decimals):
 *   Unlocked bucket #0       400,000,000  circulating from the start (claimed immediately)
 *   ClaimSchedule #0 "Team"  400,000,000  25% cliff at T+1h, then linear over 3 days, hourly steps
 *   ClaimSchedule #1 "Adv."  200,000,000  no cliff, linear over 7 days, daily steps; pausable + cancelable
 *
 * Writes every address and signature to out/test-token-<cluster>.json, or to
 * out/test-token-<cluster>-<mint>.json if that file already exists.
 */
import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  addClaimScheduleBucketV2,
  addUnlockedBucketV2,
  claimUnlockedV2,
  ConditionArgs,
  FEE_WALLET,
  finalizeV2,
  findClaimScheduleBucketV2Pda,
  findGenesisAccountV2Pda,
  findUnlockedBucketV2Pda,
  genesis,
  initializeV2,
  WRAPPED_SOL_MINT,
} from '@metaplex-foundation/genesis';
import { mplToolbox, setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  TransactionBuilder,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

const RPC = process.env.RPC ?? 'https://api.devnet.solana.com';
const cluster = RPC.includes('devnet') ? 'devnet' : RPC.includes('mainnet') ? 'mainnet' : 'custom';
const keypairPath = (process.env.KEYPAIR ?? '').replace(/^~/, process.env.HOME!);
const NAME = process.env.TOKEN_NAME ?? 'Genesis Vesting Test';
const SYMBOL = process.env.TOKEN_SYMBOL ?? 'GVEST';
const URI = process.env.TOKEN_URI ?? '';

const umi = createUmi(RPC).use(mplToolbox()).use(mplTokenMetadata()).use(genesis());
const secret = new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf8')));
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));
const me = umi.identity.publicKey;

const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const TOTAL = 1_000_000_000n * UNIT;
const UNLOCKED = 400_000_000n * UNIT;
const TEAM = 400_000_000n * UNIT;
const ADVISORS = 200_000_000n * UNIT;

const HOUR = 3600n;
const DAY = 86_400n;
const now = BigInt(Math.floor(Date.now() / 1000));

const timeAbs = (time: bigint): ConditionArgs => ({
  __kind: 'TimeAbsolute',
  padding: Array(47).fill(0),
  time,
  triggeredTimestamp: null,
});
const never: ConditionArgs = { __kind: 'Never', padding: Array(55).fill(0), triggeredTimestamp: null };

const sigs: Record<string, string> = {};
async function send(label: string, b: TransactionBuilder) {
  const { signature } = await b.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
  sigs[label] = base58.deserialize(signature)[0];
  console.log(label, sigs[label]);
}

const baseMint = generateSigner(umi);
const [genesisAccount] = findGenesisAccountV2Pda(umi, { baseMint: baseMint.publicKey, genesisIndex: 0 });
const [unlocked] = findUnlockedBucketV2Pda(umi, { genesisAccount, bucketIndex: 0 });
const [team] = findClaimScheduleBucketV2Pda(umi, { genesisAccount, bucketIndex: 0 });
const [advisors] = findClaimScheduleBucketV2Pda(umi, { genesisAccount, bucketIndex: 1 });

await send(
  'initializeV2',
  initializeV2(umi, {
    baseMint,
    quoteMint: WRAPPED_SOL_MINT,
    decimals: DECIMALS,
    genesisIndex: 0,
    fundingMode: 0,
    totalSupplyBaseToken: TOTAL,
    name: NAME,
    symbol: SYMBOL,
    uri: URI,
  }).prepend(setComputeUnitLimit(umi, { units: 400_000 }))
);

await send(
  'addUnlockedBucketV2',
  addUnlockedBucketV2(umi, {
    genesisAccount,
    baseMint: baseMint.publicKey,
    quoteMint: WRAPPED_SOL_MINT,
    recipient: me,
    bucketIndex: 0,
    baseTokenAllocation: UNLOCKED,
    claimStartCondition: timeAbs(now - 60n),
    claimEndCondition: timeAbs(now + 365n * DAY),
  } as any)
);

const commonPolicy = {
  cancelable: false,
  cancelableByRecipient: false,
  transferable: false,
  transferableByRecipient: false,
  pausable: false,
};

// Team: 25% cliff at T+1h, remaining 75% linear from T+1h over 3 days in hourly steps.
await send(
  'addClaimScheduleBucketV2:team',
  addClaimScheduleBucketV2(umi, {
    genesisAccount,
    baseMint: baseMint.publicKey,
    quoteMint: WRAPPED_SOL_MINT,
    recipient: me,
    feeWallet: FEE_WALLET,
    bucketIndex: 0,
    baseTokenAllocation: TEAM,
    claimSchedule: {
      startCondition: timeAbs(now + HOUR),
      duration: 3n * DAY,
      period: HOUR,
      cliffCondition: timeAbs(now + HOUR),
      cliffAmountBps: 2500,
      reserved: Array(126).fill(0),
    },
    claimStartCondition: timeAbs(now - 60n),
    ...commonPolicy,
    padding: [0],
    backendSigner: null,
    reserved: [0, 0, 0, 0],
    endBehaviors: [],
  } as any)
);

// Advisors: no cliff, linear from T over 7 days in daily steps; authority can pause/cancel.
await send(
  'addClaimScheduleBucketV2:advisors',
  addClaimScheduleBucketV2(umi, {
    genesisAccount,
    baseMint: baseMint.publicKey,
    quoteMint: WRAPPED_SOL_MINT,
    recipient: me,
    feeWallet: FEE_WALLET,
    bucketIndex: 1,
    baseTokenAllocation: ADVISORS,
    claimSchedule: {
      startCondition: timeAbs(now),
      duration: 7n * DAY,
      period: DAY,
      cliffCondition: never,
      cliffAmountBps: 0,
      reserved: Array(126).fill(0),
    },
    claimStartCondition: timeAbs(now - 60n),
    ...commonPolicy,
    pausable: true,
    cancelable: true,
    padding: [0],
    backendSigner: null,
    reserved: [0, 0, 0, 0],
    endBehaviors: [],
  } as any)
);

await send(
  'finalizeV2',
  finalizeV2(umi, { baseMint: baseMint.publicKey, genesisAccount }).addRemainingAccounts(
    [unlocked, team, advisors].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))
  )
);

await send(
  'claimUnlockedV2',
  claimUnlockedV2(umi, {
    genesisAccount,
    bucket: unlocked,
    baseMint: baseMint.publicKey,
    quoteMint: WRAPPED_SOL_MINT,
    recipient: me,
  })
);

const out = {
  cluster,
  createdAt: Number(now),
  mint: baseMint.publicKey,
  decimals: DECIMALS,
  totalSupply: TOTAL.toString(),
  genesisAccount,
  recipient: me,
  buckets: {
    unlocked: { address: unlocked, allocation: UNLOCKED.toString() },
    team: {
      address: team,
      allocation: TEAM.toString(),
      cliffTime: Number(now + HOUR),
      cliffBps: 2500,
      linearStart: Number(now + HOUR),
      durationSeconds: Number(3n * DAY),
      periodSeconds: Number(HOUR),
    },
    advisors: {
      address: advisors,
      allocation: ADVISORS.toString(),
      cliffTime: null,
      linearStart: Number(now),
      durationSeconds: Number(7n * DAY),
      periodSeconds: Number(DAY),
      pausable: true,
      cancelable: true,
    },
  },
  signatures: sigs,
};
fs.mkdirSync('out', { recursive: true });
const outFile = fs.existsSync(`out/test-token-${cluster}.json`) ? `out/test-token-${cluster}-${baseMint.publicKey}.json` : `out/test-token-${cluster}.json`;
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(`Saved to ${outFile}`);
void publicKey;
