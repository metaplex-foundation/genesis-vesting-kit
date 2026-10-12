# Genesis Vesting Integration Kit

Tokens launched with **Metaplex Genesis** lock team, advisor and treasury allocations in on-chain vesting accounts (`ClaimScheduleBucketV2`). Everything you need to show them correctly is below.

## What we ask platforms to show

1. **Locked supply.** Tokens still under a vesting schedule. Exclude them from circulating supply.
2. **Unlock schedule.** Cliff date and amount, linear unlock rate, next unlock, end date.
3. **Circulating supply.** Total supply − locked.

Locked tokens sit in a single Genesis-owned token account, not in recipient wallets. Balance-based heuristics therefore get this wrong. You have to read the lock accounts.

## Kit contents

| | |
|---|---|
| 📘 [Integration guide](docs/integration-guide.md) | Account model, byte layout, vesting formula, edge cases (pause / cancel / failed sale), what to index |
| 🧩 [Program and IDL](#program-and-idl) | Program ID, pinned IDL ([`idl/`](idl/)), discriminators, TypeScript quick reference |
| 🧪 [Test token + example transactions](docs/test-token.md) | Live token with a cliff lock and a linear lock, plus expected values at fixed timestamps |
| 💻 [Code examples](examples/read_vesting_locks/) | Copy-paste readers for **Umi** (recommended), **@solana/kit** and **web3.js**: find every lock for a mint, then print status, locked / vested / claimed / claimable, the schedule, the next unlock and circulating supply. [Sample output and field guide](examples/read_vesting_locks/README.md) |
| 🛠️ [Test token scripts](scripts/) | [Create your own test token](docs/test-token.md#create-your-own-test-token) with the same layout, then check real claims against the Umi example |

## Key facts

- Program: `GNS1S5J5AspKXgpjz6SvKL66kPaKWAhaGRhCqPRxii2B` (mainnet + devnet)
- Vesting account: `ClaimScheduleBucketV2`, discriminator byte `29`, 944 bytes
- Find all locks for a mint: `getProgramAccounts` with `memcmp(0, [29])` + `memcmp(80, <mint>)`
- SDK: `npm i @metaplex-foundation/genesis`. **We recommend the Umi example**, which uses typed decoders instead of byte offsets

## Program and IDL

| | |
|---|---|
| Program ID (mainnet + devnet) | `GNS1S5J5AspKXgpjz6SvKL66kPaKWAhaGRhCqPRxii2B` |
| Source | Private repo (`metaplex-foundation/genesis`). The npm client is public under Apache-2.0 |
| Latest program release | `release/genesis@0.39.0` (2026-10-06) |
| IDL generator | Shank 0.4.8 (not Anchor: discriminators are a single `u8`, not 8-byte hashes) |

The deployed mainnet program should match `release/genesis@0.39.0`. If anything you decode doesn't match this IDL, contact us.

The program repo is private, so the IDL ships with the kit:

- [`idl/genesis_program-0.39.0.json`](idl/genesis_program-0.39.0.json), from `release/genesis@0.39.0`
- sha256 `e7f0d3caf45f536696d01bb50717364e40c04ea2c5e026414485fdbcd18f8dbb`

Relevant entries:

| Kind | Name | Discriminator |
|---|---|---|
| Account | `ClaimScheduleBucketV2` | `Key` = 29 (byte 0) |
| Account | `GenesisAccountV2` | `Key` = 18 (byte 0) |
| Type | `ClaimSchedule`, `Condition`, `ClaimScheduleV2Extensions`, `BucketBase` | — |
| Instruction | `AddClaimScheduleBucketV2` / `…Base` / `…Extensions` | 108 / 109 / 110 |
| Instruction | `SetClaimScheduleBucketV2Behaviors` | 111 |
| Instruction | `UpdateClaimScheduleBucketV2` | 112 |
| Instruction | `SetClaimSchedulePausedStateV2` | 113 |
| Instruction | `CancelClaimScheduleBucketV2` | 114 |
| Instruction | `TransferRecipientClaimScheduleBucketV2` | 115 |
| Instruction | `ClaimClaimScheduleV2` | 116 |
| Instruction | `TriggerBehaviorsV2` | 44 |

The byte offsets of every field you need are in the [integration guide, §2](docs/integration-guide.md#2-claimschedulebucketv2-layout). With those you can decode the account without any SDK.

### TypeScript quick reference

```ts
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  genesis,
  getClaimScheduleBucketV2GpaBuilder,
  fetchClaimScheduleBucketV2,
  Key,
} from '@metaplex-foundation/genesis';

const umi = createUmi(RPC_URL).use(genesis());

// Every vesting lock on the program (indexers):
const locks = await getClaimScheduleBucketV2GpaBuilder(umi)
  .whereField('key', Key.ClaimScheduleBucketV2)
  .getDeserialized();

// One lock:
const lock = await fetchClaimScheduleBucketV2(umi, lockAddress);
lock.bucket.baseTokenAllocation; // total
lock.amountClaimed;              // claimed
lock.claimSchedule;              // { startCondition, duration, period, cliffCondition, cliffAmountBps }
```

The SDK doesn't include a helper for the vested / locked math. Use `readLock` and `fetchVestingLocks` from the [Umi example](examples/read_vesting_locks/umi.ts). Both are exported.

## Contact

- Mark Sackerberg and Tony Boyle (Metaplex DevRel). We'll pull in Genesis engineering when needed.

## Changelog

- 2026-10-12: first release (devnet test token)
