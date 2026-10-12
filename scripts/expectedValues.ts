/**
 * Prints a markdown table of expected vesting values for a test token at checkpoints.
 * Usage: npx tsx scripts/expectedValues.ts [devnet | out/test-token-<...>.json]
 */
import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { genesis } from '@metaplex-foundation/genesis';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { publicKey } from '@metaplex-foundation/umi';
import { fetchVestingLocks } from '../examples/read_vesting_locks/umi.js';

const arg = process.argv[2] ?? 'devnet';
const t = JSON.parse(fs.readFileSync(arg.endsWith('.json') ? arg : `out/test-token-${arg}.json`, 'utf8'));
const cluster = t.cluster;
const umi = createUmi(process.env.RPC ?? `https://api.${cluster === 'mainnet' ? 'mainnet-beta' : cluster}.solana.com`).use(mplToolbox()).use(genesis());
const H = 3600, D = 86400, c = t.createdAt, cliff = t.buckets.team.cliffTime;
const points: [string, number][] = [
  ['Created (T)', c], ['T + 1h (cliff)', cliff], ['Cliff + 12h', cliff + 12 * H], ['Cliff + 1d', cliff + D],
  ['Cliff + 3d (team done)', cliff + 3 * D], ['T + 7d (advisors done)', c + 7 * D],
];
const fmt = (v: bigint) => (Number(v / 10n ** BigInt(t.decimals))).toLocaleString('en-US');
console.log('| Checkpoint | Unix | Team vested | Advisors vested | Total locked | Circulating* |\n|---|---|---|---|---|---|');
for (const [label, at] of points) {
  const s = await fetchVestingLocks(umi, publicKey(t.mint), at);
  const team = s.locks.find((l) => l.address === t.buckets.team.address)!;
  const adv = s.locks.find((l) => l.address === t.buckets.advisors.address)!;
  console.log(`| ${label} | ${at} | ${fmt(team.vested)} | ${fmt(adv.vested)} | ${fmt(s.totalLocked)} | ${fmt(s.supply - s.totalLocked)} |`);
}
