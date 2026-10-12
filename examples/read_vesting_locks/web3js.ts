// [IMPORTS]
import { Connection, PublicKey } from '@solana/web3.js'
// [/IMPORTS]

// [SETUP]
const connection = new Connection('https://api.mainnet-beta.solana.com')
const GENESIS_PROGRAM = new PublicKey('GNS1S5J5AspKXgpjz6SvKL66kPaKWAhaGRhCqPRxii2B')
const mint = new PublicKey('YOUR_TOKEN_MINT')

const NOT_TRIGGERED = 0x7fffffffffffffffn // i64::MAX

// A Condition is 64 bytes: type at +0, TimeAbsolute time at +48, triggered_timestamp at +56.
// Use the configured time for TimeAbsolute: the program only writes triggered_timestamp lazily.
function conditionTime(data: Buffer, offset: number): number | null {
  const triggered = data.readBigInt64LE(offset + 56)
  if (triggered !== NOT_TRIGGERED) return Number(triggered)
  return data[offset] === 1 ? Number(data.readBigInt64LE(offset + 48)) : null
}

// Decode a ClaimScheduleBucketV2 and return its vesting state at unix time `now`.
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
function readLock(data: Buffer, now: number) {
  const allocation = data.readBigUInt64LE(48)
  const failed = data[144] === 1
  const claimed = data.readBigUInt64LE(240)
  const start = conditionTime(data, 248)
  const duration = data.readBigUInt64LE(312)
  const period = data.readBigUInt64LE(320)
  const cliffTime = conditionTime(data, 328)
  const cliffBps = BigInt(data.readUInt16LE(392))
  const claimStart = conditionTime(data, 520)
  const endedAt = conditionTime(data, 584)
  const paused = data[648] === 1
  const pausedAt = Number(data.readBigInt64LE(656))
  const totalPaused = Number(data.readBigInt64LE(664))

  // Pause-adjusted clock, frozen at the end condition once cancelled or completed.
  const raw = endedAt ?? now
  const t = raw - totalPaused - (paused ? Math.max(0, raw - pausedAt) : 0)

  const cliff = (allocation * cliffBps) / 10_000n
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
  if (!ended && !paused && locked > 0n) {
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
    recipient: new PublicKey(data.subarray(208, 240)).toBase58(),
    allocation,
    vested,
    claimed,
    locked,
    claimableNow: claimStart !== null && now >= claimStart ? vested - claimed : 0n,
    status: failed ? 'failed' : endedAt !== null && vested < allocation ? 'cancelled' : paused ? 'paused' : locked === 0n ? 'fully vested' : vested === 0n ? 'not started' : 'vesting',
    schedule: {
      cliff: cliffTime,
      cliffPercent: Number(cliffBps) / 100,
      linearStart: start,
      linearEnd: start === null ? null : start + Number(duration),
      period: Number(period),
      claimOpens: claimStart,
      secondsPaused: totalPaused,
    },
    nextUnlock,
  }
}
// [/SETUP]

// [MAIN]
// Every ClaimScheduleBucketV2 (discriminator 29 = base58 "W") for this mint (bucket.base_mint at offset 80)
const accounts = await connection.getProgramAccounts(GENESIS_PROGRAM, {
  filters: [
    { memcmp: { offset: 0, bytes: 'W' } },
    { memcmp: { offset: 80, bytes: mint.toBase58() } },
  ],
})

const now = Math.floor(Date.now() / 1000)
const locks = accounts.map(({ pubkey, account }) => ({ address: pubkey.toBase58(), ...readLock(account.data, now) }))
const totalLocked = locks.reduce((sum, lock) => sum + lock.locked, 0n)
const { value: tokenSupply } = await connection.getTokenSupply(mint)
const supply = BigInt(tokenSupply.amount)
const decimals = tokenSupply.decimals
// [/MAIN]

// [OUTPUT]
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
// [/OUTPUT]
