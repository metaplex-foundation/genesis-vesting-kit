/**
 * Cross-checks the reader against the program: sends a real claim, then checks that
 * the tokens the program transferred equal what the Umi example's `readLock` predicts at the
 * claim transaction's block time.
 * Usage: KEYPAIR=... RPC=... npx tsx scripts/verifyClaim.ts <bucket> [label]
 */
import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { claimClaimScheduleV2, fetchClaimScheduleBucketV2, genesis, WRAPPED_SOL_MINT } from '@metaplex-foundation/genesis';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { keypairIdentity, publicKey, PublicKey, Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { readLock } from '../examples/read_vesting_locks/umi.js';

export async function claimAndVerify(umi: Umi, bucketAddr: PublicKey, label: string) {
  const before = await fetchClaimScheduleBucketV2(umi, bucketAddr, { commitment: 'confirmed' });
  const mint = publicKey((before.bucket.baseMint as any).value);
  const { signature } = await claimClaimScheduleV2(umi, {
    genesisAccount: before.bucket.genesis, bucket: bucketAddr, baseMint: mint, quoteMint: WRAPPED_SOL_MINT, recipient: before.recipient,
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
  const sig58 = base58.deserialize(signature)[0];
  const tx = await umi.rpc.call<{ blockTime: number }>('getTransaction', [sig58, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  const blockTime = Number(tx.blockTime);
  const after = await fetchClaimScheduleBucketV2(umi, bucketAddr, { commitment: 'confirmed' });
  const actual = after.amountClaimed - before.amountClaimed;
  // Predict from the PRE-claim state at the tx's block time (the program's Clock).
  const predicted = readLock(before, blockTime).vested - before.amountClaimed;
  const result = { label, bucket: bucketAddr, blockTime, predicted: predicted.toString(), actual: actual.toString(), match: predicted === actual, signature: sig58 };
  console.log(JSON.stringify(result));
  fs.mkdirSync('out', { recursive: true });
  fs.appendFileSync('out/claims.jsonl', JSON.stringify(result) + '\n');
  return result;
}

export function makeUmi() {
  const umi = createUmi(process.env.RPC ?? 'https://api.devnet.solana.com').use(mplToolbox()).use(genesis());
  const secret = new Uint8Array(JSON.parse(fs.readFileSync(process.env.KEYPAIR!.replace(/^~/, process.env.HOME!), 'utf8')));
  return umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));
}

if (process.argv[1]?.endsWith('verifyClaim.ts')) {
  await claimAndVerify(makeUmi(), publicKey(process.argv[2]), process.argv[3] ?? 'claim');
}
