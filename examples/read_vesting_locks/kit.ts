// [IMPORTS]
import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getBase64Encoder,
  type Base58EncodedBytes,
} from '@solana/kit'
// [/IMPORTS]

// [SETUP]
const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com')
const GENESIS_PROGRAM = address('GNS1S5J5AspKXgpjz6SvKL66kPaKWAhaGRhCqPRxii2B')
const mint = address('YOUR_TOKEN_MINT')

const NOT_TRIGGERED = 0x7fffffffffffffffn // i64::MAX

// A Condition is 64 bytes: type at +0, TimeAbsolute time at +48, triggered_timestamp at +56.
// Use the configured time for TimeAbsolute: the program only writes triggered_timestamp lazily.
function conditionTime(view: DataView, offset: number): number | null {
  const triggered = view.getBigInt64(offset + 56, true)
  if (triggered !== NOT_TRIGGERED) return Number(triggered)
  return view.getUint8(offset) === 1 ? Number(view.getBigInt64(offset + 48, true)) : null
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
function readLock(data: Uint8Array, now: number) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const allocation = view.getBigUint64(48, true)
  const failed = view.getUint8(144) === 1
  const claimed = view.getBigUint64(240, true)
  const start = conditionTime(view, 248)
  const duration = view.getBigUint64(312, true)
  const period = view.getBigUint64(320, true)
  const cliffTime = conditionTime(view, 328)
  const cliffBps = BigInt(view.getUint16(392, true))
  const claimStart = conditionTime(view, 520)
  const endedAt = conditionTime(view, 584)
  const paused = view.getUint8(648) === 1
  const pausedAt = Number(view.getBigInt64(656, true))
  const totalPaused = Number(view.getBigInt64(664, true))

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
    recipient: getAddressDecoder().decode(data.subarray(208, 240)),
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
const accounts = await rpc
  .getProgramAccounts(GENESIS_PROGRAM, {
    encoding: 'base64',
    filters: [
      { memcmp: { offset: 0n, bytes: 'W' as Base58EncodedBytes, encoding: 'base58' } },
      { memcmp: { offset: 80n, bytes: mint as string as Base58EncodedBytes, encoding: 'base58' } },
    ],
  })
  .send()

const now = Math.floor(Date.now() / 1000)
const locks = accounts.map(({ pubkey, account }) => ({
  address: pubkey,
  ...readLock(new Uint8Array(getBase64Encoder().encode(account.data[0])), now),
}))
const totalLocked = locks.reduce((sum, lock) => sum + lock.locked, 0n)
const { value: tokenSupply } = await rpc.getTokenSupply(mint).send()
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
