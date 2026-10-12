# Integrating Genesis Vesting

For wallets, explorers, aggregators, data APIs, trading terminals and risk scanners that need to show **locked supply, unlock schedules and circulating supply** for tokens launched with Metaplex Genesis.

## TL;DR

- Genesis vesting locks are on-chain accounts of type **`ClaimScheduleBucketV2`** owned by the Genesis program `GNS1S5J5AspKXgpjz6SvKL66kPaKWAhaGRhCqPRxii2B`.
- Locked tokens do **not** sit in a per-recipient wallet or escrow. Every bucket of a launch draws from one token account: the **Genesis account PDA's associated token account**. If you only look at token balances, you see a single large holder. You need to read the lock accounts to know how much of that balance is locked, and for whom.
- For any time `t`, a lock's vested amount is a cliff plus a stepped linear curve (formula below). **Locked = allocation − vested.**
- A copy-paste reader returns all of this for a mint: [`examples/read_vesting_locks/umi.ts`](../examples/read_vesting_locks/umi.ts) (Kit and web3.js versions next to it).

## 1. Account model

```
Token mint
 └─ GenesisAccountV2            PDA ["genesis_v2", mint, genesis_index: u16 LE]
     ├─ base token account     ATA(owner = GenesisAccountV2, mint): holds ALL undistributed tokens of the launch
     ├─ UnlockedBucketV2        PDA ["unlocked_v2", genesis, bucket_index: u8]   (team/treasury, no vesting)
     ├─ ClaimScheduleBucketV2   PDA ["claim_schedule_v2", genesis, bucket_index: u8]   ← vesting lock
     ├─ ClaimScheduleBucketV2   … one account per vesting lock (Team, Advisors, …)
     └─ LaunchPool / Presale / Raydium … buckets (sale + liquidity)
```

- One mint usually has one Genesis account (`genesis_index = 0`), but don't assume that. Find them by `baseMint`, as shown below.
- `GenesisAccountV2.bucket_count` is the total number of buckets across all types. Bucket indices are counted per type and start at 0. Each type has its own PDA prefix.
- Account discriminator: the first byte of the account data (`Key` enum). `GenesisAccountV2 = 18`, `ClaimScheduleBucketV2 = 29`.

### Finding every vesting lock for a mint

**Option A: derive the PDAs.** This is what the reference reader does.

1. `getProgramAccounts(GNS1…)` with filters `memcmp(offset 0, [18])` and `memcmp(offset 40, mint)` (offset 40 = `GenesisAccountV2.base_mint`). Or derive `["genesis_v2", mint, 0u16]` directly if you only care about index 0.
2. For `i in 0..bucket_count`, derive `["claim_schedule_v2", genesis, i]` and fetch with `getMultipleAccounts`. Skip addresses that don't exist.

**Option B: scan all locks.** This suits indexers.

`getProgramAccounts(GNS1…)` with filters `memcmp(offset 0, [29])` and `memcmp(offset 80, mint)`. Offset 80 is `bucket.base_mint`. You get every vesting lock for that mint in one call.

## 2. `ClaimScheduleBucketV2` layout

Fixed size **944 bytes**, plus 40 bytes for each attached end-behavior (so 984 bytes with one). Little-endian. Offsets were checked against live accounts.

| Offset | Field | Type | Notes |
|---|---|---|---|
| 0 | `key` | u8 | `29` |
| 16 | `bucket.genesis` | Pubkey | Parent Genesis account |
| 48 | `bucket.base_token_allocation` | u64 | **Total tokens in the lock** |
| 56 | `bucket.base_token_balance` | u64 | Remaining (allocation − claimed, minus any amount swept back on cancel) |
| 80 | `bucket.base_mint` | Pubkey | Token mint |
| 144 | `bucket.failed` | u8 | 1 = the sale this lock depends on failed. Nothing vests |
| 208 | `recipient` | Pubkey | Beneficiary (can change if transfer is enabled) |
| 240 | `amount_claimed` | u64 | Already sent to the recipient |
| 248 | `claim_schedule.start_condition` | Condition (64 B) | Start of the linear leg |
| 312 | `claim_schedule.duration` | u64 | Seconds of the linear leg |
| 320 | `claim_schedule.period` | u64 | Step size in seconds (unlocks happen in whole periods) |
| 328 | `claim_schedule.cliff_condition` | Condition (64 B) | Cliff instant |
| 392 | `claim_schedule.cliff_amount_bps` | u16 | Cliff share of the allocation, in basis points |
| 520 | `claim_start_condition` | Condition (64 B) | When claiming opens (for launches: graduation / TGE) |
| 584 | `claim_end_condition` | Condition (64 B) | Set by the program on cancel / completion. Freezes vesting |
| 648 | `paused` | u8 (bool) | Accrual frozen |
| 656 | `paused_at` | i64 | Valid while paused |
| 664 | `total_seconds_paused` | i64 | Total paused time so far |
| 768–772 | `pausable`, `cancelable`, `cancelable_by_recipient`, `transferable`, `transferable_by_recipient` | u8 ×5 | Policy flags. Show them so users know whether a schedule can change |
| 940 | `behavior_count` | u32 | Number of trailing 40-byte behaviors |

**Condition (64 bytes):** byte 0 = type (`1` TimeAbsolute, `2` TimeRelative, `3` Triggered, `4` Never). For TimeAbsolute, the configured `time` (i64) is at +48. The trailing `triggered_timestamp` (i64) is at +56, and `i64::MAX` means "not triggered yet".

> **Gotcha: `triggered_timestamp` is set lazily.** The program only stamps it when someone sends a transaction to the lock, for example a claim. A TimeAbsolute condition whose time has already passed can still read "not triggered". **Use the configured `time` for TimeAbsolute.** Use `triggered_timestamp` for TimeRelative and Triggered conditions. A TimeRelative condition that hasn't triggered depends on a launch event that hasn't happened yet, such as graduation. `Never` means that part of the allocation never unlocks.

## 3. Vesting math

Inputs: `A = base_token_allocation`, `bps = cliff_amount_bps`, `C = cliff time`, `S = linear start`, `D = duration`, `P = period`.

```
cliff      = floor(A * bps / 10_000)
remaining  = A - cliff

vested(t)  = (t >= C ? cliff : 0)
           + ( t >= S + D ? remaining
             : t >= S     ? ceil( remaining * floor((t - S) / P) * P / D )
             : 0 )
```

- The cliff and the linear leg are **independent**. The cliff can fire before, during or after the linear leg.
- Linear unlocks happen in **whole periods**. Between steps, `vested` doesn't change.
- The program rounds up (`div_ceil`). To match it exactly, use integer math (u128 / BigInt).

### Clock adjustments: pause and end

The program doesn't evaluate `vested` at wall-clock time. It uses an effective time:

```
raw = claim_end_condition triggered ? claim_end.triggered_timestamp : now
t   = raw - total_seconds_paused - (paused ? raw - paused_at : 0)
```

So:

- **Paused**: accrual stops. Tokens already vested stay claimable. When vesting resumes, every later unlock moves back by the paused time.
- **Ended** (cancelled, or fully vested): vesting is frozen at the end instant. On cancel, the unvested remainder (`A − vested(t_end)`) is swept back to the launch. It no longer belongs to the recipient.

## 4. What to display

| Value | Definition |
|---|---|
| **Locked** | `allocation − vested(t)`. **0 if cancelled or failed** |
| **Vested** | `vested(t)` (claimed + claimable) |
| **Claimed** | `amount_claimed` |
| **Claimable now** | `vested − claimed`, but only once the claim window is open (`claim_start_condition` met) |
| **Next unlock** | Next cliff or period boundary, moved back by any paused time |
| **Status** | not started / vesting / paused / fully vested / cancelled / failed |
| **Policy** | Whether the schedule can be paused, cancelled or transferred |

**Vesting accrual and claimability are separate.** For launchpool launches, `claim_start_condition` is relative to graduation (the TGE). The schedule can be accruing before the recipient is able to claim anything.

### Circulating supply

Recommended definition for vesting:

```
non-circulating (vesting) = Σ locked over all ClaimScheduleBucketV2 of the mint
```

Vested-but-unclaimed tokens are the recipient's to claim and sell at any time, so they count as circulating even though they still sit in the Genesis token account. Other Genesis-held balances, such as unclaimed sale tokens, aren't vesting and aren't covered here.

## 5. Changes to index

If you cache lock state, refresh a lock whenever a transaction includes one of these Genesis instructions with that account. The instruction discriminator is the first byte of the instruction data.

| Discriminator | Instruction | Effect |
|---|---|---|
| 108–110 | `AddClaimScheduleBucketV2` (+ `Base` / `Extensions`) | New lock |
| 111 | `SetClaimScheduleBucketV2Behaviors` | End behaviors changed |
| 112 | `UpdateClaimScheduleBucketV2` | Schedule changed (only possible before vesting starts) |
| 113 | `SetClaimSchedulePausedStateV2` | Pause / resume |
| 114 | `CancelClaimScheduleBucketV2` | Vesting frozen. Remainder will be swept back |
| 115 | `TransferRecipientClaimScheduleBucketV2` | New recipient |
| 116 | `ClaimClaimScheduleV2` | Tokens moved to the recipient |
| 44 | `TriggerBehaviorsV2` | Runs the sweep-back after a cancel |

Even without any instruction, `vested(t)` grows over time. Recompute it at read time rather than caching it.

## 6. Legacy: Streamflow locks

Older Genesis launches locked team tokens with Streamflow (`StreamflowBucketV2`). Those tokens sit in Streamflow contracts and show up through existing Streamflow integrations. New launches use `ClaimScheduleBucketV2`.

## 7. Test it

- **Test token (devnet):** see [`test-token.md`](./test-token.md). It has a cliff lock and a linear, pausable lock with known expected values.
- **Code examples:** [`examples/read_vesting_locks/`](../examples/read_vesting_locks/) has `umi.ts`, `kit.ts` and `web3js.ts`. Each is self-contained: replace `YOUR_TOKEN_MINT` and run it with `npx tsx`. **Start with `umi.ts`.** It uses the Genesis SDK's typed decoders, so there are no byte offsets to maintain. Use the Kit or web3.js versions only if you can't add `@metaplex-foundation/genesis`; they decode with the byte offsets from §2. The [examples README](../examples/read_vesting_locks/README.md) explains every output field and shows sample output for mainnet and the devnet test token.
- **Your own test token:** [`test-token.md`, Create your own test token](./test-token.md#create-your-own-test-token). The scripts create a token with the same layout and check real claims against the Umi example.
- **SDK:** `@metaplex-foundation/genesis` (Umi). `fetchClaimScheduleBucketV2`, `getClaimScheduleBucketV2GpaBuilder`, `findClaimScheduleBucketV2Pda`.
- **IDL:** see [Program and IDL](../README.md#program-and-idl) in the README.
