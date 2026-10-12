// [IMPORTS]
import {
  ClaimScheduleBucketV2,
  Condition,
  genesis,
  getClaimScheduleBucketV2GpaBuilder,
  Key,
} from '@metaplex-foundation/genesis'
import { isSome, publicKey, type PublicKey, type Umi } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { pathToFileURL } from 'node:url'
// [/IMPORTS]

// [SETUP]
// Use the configured time for TimeAbsolute: the program only writes triggeredTimestamp lazily.
function conditionTime(c: Condition): number | null {
  if (isSome(c.triggeredTimestamp)) return Number(c.triggeredTimestamp.value)
  return c.__kind === 'TimeAbsolute' ? Number(c.time) : null
}

// Vesting state of one ClaimScheduleBucketV2 at unix time `now`.
// Amounts are raw base units (divide by 10^decimals); times are unix seconds.
//   allocation    tokens put into this lock
//   vested        released by the schedule so far, claimed or not
//   claimed       already withdrawn by the recipient
//   claimableNow  vested but not yet claimed, once the claim window is open (0 before)
//   locked        not vested yet: count this as non-circulating supply
//   status        not started | vesting | paused | fully vested | cancelled | failed
//   schedule      cliff time and %, linear start/end/period, claim window open time,
//                 pause offset (null = waiting for a trigger such as graduation)
//   nextUnlock    when the next tokens vest and how many (null if nothing more vests)
export function readLock(lock: ClaimScheduleBucketV2, now: number) {
  const allocation = lock.bucket.baseTokenAllocation
  const failed = lock.bucket.failed
  const claimed = lock.amountClaimed
  const { duration, period, cliffAmountBps } = lock.claimSchedule
  const start = conditionTime(lock.claimSchedule.startCondition)
  const cliffTime = conditionTime(lock.claimSchedule.cliffCondition)
  const claimStart = conditionTime(lock.claimStartCondition)
  const endedAt = conditionTime(lock.claimEndCondition)
  const totalPaused = Number(lock.totalSecondsPaused)

  // Pause-adjusted clock, frozen at the end condition once cancelled or completed.
  const raw = endedAt ?? now
  const t = raw - totalPaused - (lock.paused ? Math.max(0, raw - Number(lock.pausedAt)) : 0)

  const cliff = (allocation * BigInt(cliffAmountBps)) / 10_000n
  const vestedAt = (at: number) => {
    let v = cliffTime !== null && at >= cliffTime ? cliff : 0n
    if (start !== null) {
      if (at >= start + Number(duration)) v += allocation - cliff
      else if (at >= start) {
        const steps = (BigInt(at - start) / period) * period
        v += ((allocation - cliff) * steps + duration - 1n) / duration // round up, like the program
      }
    }
    return v
  }

  const vested = failed ? claimed : vestedAt(t)
  const ended = failed || (endedAt !== null && vested < allocation)
  const locked = ended ? 0n : allocation - vested

  let nextUnlock: { time: number; amount: bigint } | null = null
  if (!ended && !lock.paused && locked > 0n) {
    const steps = [cliffTime ?? Infinity]
    if (start !== null) {
      const p = Number(period)
      const end = start + Number(duration)
      steps.push(t < start ? start + p : Math.min(start + (Math.floor((t - start) / p) + 1) * p, end))
    }
    const next = Math.min(...steps.filter((s) => s > t))
    if (Number.isFinite(next)) nextUnlock = { time: next + totalPaused, amount: vestedAt(next) - vested }
  }

  return {
    recipient: lock.recipient,
    allocation,
    vested,
    claimed,
    locked,
    claimableNow: claimStart !== null && now >= claimStart ? vested - claimed : 0n,
    status: failed ? 'failed' : endedAt !== null && vested < allocation ? 'cancelled' : lock.paused ? 'paused' : locked === 0n ? 'fully vested' : vested === 0n ? 'not started' : 'vesting',
    schedule: {
      cliff: cliffTime,
      cliffPercent: cliffAmountBps / 100,
      linearStart: start,
      linearEnd: start === null ? null : start + Number(duration),
      period: Number(period),
      claimOpens: claimStart,
      secondsPaused: totalPaused,
    },
    nextUnlock,
  }
}

// Find every vesting lock for a mint and compute its state at unix time `now`.
export async function fetchVestingLocks(umi: Umi, mint: PublicKey, now = Math.floor(Date.now() / 1000)) {
  // Every ClaimScheduleBucketV2 (discriminator 29) for this mint (bucket.base_mint at offset 80)
  const accounts = await getClaimScheduleBucketV2GpaBuilder(umi)
    .whereField('key', Key.ClaimScheduleBucketV2)
    .where(80, mint)
    .getDeserialized()

  const locks = accounts.map((lock) => ({ address: lock.publicKey, ...readLock(lock, now) }))
  const totalLocked = locks.reduce((sum, lock) => sum + lock.locked, 0n)
  const { value: tokenSupply } = await umi.rpc.call<{ value: { amount: string; decimals: number } }>('getTokenSupply', [mint])
  return { mint, locks, totalLocked, supply: BigInt(tokenSupply.amount), decimals: tokenSupply.decimals }
}

// Print a readable report of fetchVestingLocks' result.
export function printReport({ mint, locks, totalLocked, supply, decimals }: Awaited<ReturnType<typeof fetchVestingLocks>>) {
  const amount = (raw: bigint) => {
    const units = 10n ** BigInt(decimals)
    const fraction = (raw % units).toString().padStart(decimals, '0').replace(/0+$/, '')
    return (raw / units).toLocaleString('en-US') + (fraction ? `.${fraction}` : '')
  }
  const percent = (part: bigint, whole: bigint) => (whole === 0n ? '0%' : `${(Number((part * 10_000n) / whole) / 100).toFixed(2)}%`)
  const date = (unix: number | null, pending = 'waiting for trigger') =>
    unix === null ? pending : new Date(unix * 1000).toISOString().replace('.000Z', 'Z')
  const span = (s: number) =>
    s >= 86_400 ? `${+(s / 86_400).toFixed(2)}d` : s >= 3_600 ? `${+(s / 3_600).toFixed(2)}h` : `${s}s`

  console.log(`${locks.length} vesting lock(s) for ${mint}`)
  for (const lock of locks) {
    const s = lock.schedule
    console.log(`
Lock ${lock.address}
  Recipient      ${lock.recipient}
  Status         ${lock.status}
  Allocation     ${amount(lock.allocation)}
  Vested         ${amount(lock.vested)} (${percent(lock.vested, lock.allocation)})
  Claimed        ${amount(lock.claimed)}
  Claimable now  ${amount(lock.claimableNow)}
  Locked         ${amount(lock.locked)}
  Cliff          ${s.cliffPercent ? `${s.cliffPercent}% at ${date(s.cliff)}` : 'none'}
  Linear         ${s.linearStart === null ? 'waiting for trigger' : `${date(s.linearStart)} to ${date(s.linearEnd)}, every ${span(s.period)}`}
  Claims open    ${date(s.claimOpens)}${s.secondsPaused ? `\n  Paused for     ${span(s.secondsPaused)} (dates above shift by this)` : ''}
  Next unlock    ${lock.nextUnlock ? `${amount(lock.nextUnlock.amount)} at ${date(lock.nextUnlock.time)}` : 'none'}`)
  }
  console.log(`
Supply
  Total          ${amount(supply)}
  Locked         ${amount(totalLocked)} (${percent(totalLocked, supply)})
  Circulating    ${amount(supply - totalLocked)}`)
}
// [/SETUP]

// [MAIN]
// Runs when you execute this file (`npx tsx umi.ts`). The kit's test-token scripts
// import readLock and fetchVestingLocks from here instead, so they test this exact code.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const umi = createUmi('https://api.mainnet-beta.solana.com').use(genesis())
  printReport(await fetchVestingLocks(umi, publicKey('YOUR_TOKEN_MINT')))
}
// [/MAIN]
