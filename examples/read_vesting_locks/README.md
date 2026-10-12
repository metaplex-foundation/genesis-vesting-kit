# Read Genesis vesting locks

Three self-contained versions of the same reader. Each one finds every `ClaimScheduleBucketV2` lock for a token mint, computes its vesting state the same way the program does, and prints a report.

| File | Library | When to use |
|---|---|---|
| [`umi.ts`](umi.ts) | `@metaplex-foundation/genesis` + Umi | **Recommended.** Typed decoders with named fields, so there are no byte offsets |
| [`kit.ts`](kit.ts) | `@solana/kit` | Your stack can't add the Genesis SDK. Decodes with byte offsets |
| [`web3js.ts`](web3js.ts) | `@solana/web3.js` v1 | Same as Kit, for web3.js v1 codebases |

All three print exactly the same output.

## Run it

1. Replace `YOUR_TOKEN_MINT` with the token mint (and the RPC URL if you use devnet or your own node).
2. Run `npx tsx umi.ts`.

## Output fields

Amounts are whole tokens (raw base units divided by `10^decimals`). Times are UTC.

| Field | Meaning |
|---|---|
| Status | `not started`, `vesting`, `paused`, `fully vested`, `cancelled` or `failed` |
| Allocation | Tokens put into this lock when the launch was created |
| Vested | Tokens the schedule has released so far, claimed or not, and the share of the allocation |
| Claimed | Tokens the recipient has already withdrawn |
| Claimable now | Vested tokens not yet claimed. Stays `0` until the claim window opens |
| Locked | Tokens that have not vested. **This is the non-circulating amount** |
| Cliff | Share of the allocation that unlocks at once, and when |
| Linear | Start, end and step size of the linear release of the remainder |
| Claims open | When the recipient can start claiming. `waiting for trigger` means it depends on an event that hasn't happened yet, such as graduation |
| Paused for | Only shown after a pause. Total paused time, which pushes the schedule dates back |
| Next unlock | The amount and time of the next vesting step |
| Supply | Total supply, the sum of `Locked` over all locks, and circulating supply (total minus locked) |

In code, `readLock` returns the same values as raw `bigint` base units and unix timestamps (see the comment above it), so you can index them without parsing the text.

`umi.ts` exports `readLock`, `fetchVestingLocks` and `printReport`, and only prints the report when you run it directly. The [test token scripts](../../scripts/) import it, so every claim check tests this exact code.

## Example output: mainnet

`VK2NancNtR9D7CsWoXze7r7pEbqfLXDr9AYjTJRPLEX` on 2026-10-12. One team lock that hasn't started vesting; claims open after graduation.

```text
1 vesting lock(s) for VK2NancNtR9D7CsWoXze7r7pEbqfLXDr9AYjTJRPLEX

Lock 4kGV5yv1PiR8BJzb8pDqY8C7bjttoy5Bsi84k2ZfnpC8
  Recipient      AdYFxCFyUWJzsLpFQwjE2RQKcsaDtW1dGRXc5s9APdzo
  Status         not started
  Allocation     800,000,000
  Vested         0 (0.00%)
  Claimed        0
  Claimable now  0
  Locked         800,000,000
  Cliff          12.5% at 2027-01-16T00:30:00Z
  Linear         2027-01-16T00:30:00Z to 2028-10-16T05:00:00Z, every 30.44d
  Claims open    waiting for trigger
  Next unlock    100,000,000 at 2027-01-16T00:30:00Z

Supply
  Total          1,000,000,000
  Locked         800,000,000 (80.00%)
  Circulating    200,000,000
```

## Example output: devnet test token

[The kit's test token](../../docs/test-token.md) `6LNGVeWcQVKDPNktwSJNFXe3Y5HYWVPWJFnggjSbTFYu` on 2026-10-12 (RPC `https://api.devnet.solana.com`). The team lock is fully vested and partly claimed. The advisor lock is partway through daily linear vesting, with everything vested so far already claimed. Your numbers will differ depending on when you run it.

```text
2 vesting lock(s) for 6LNGVeWcQVKDPNktwSJNFXe3Y5HYWVPWJFnggjSbTFYu

Lock 3stYhdiNaWx488MPzJEX5wMoSrBSyA1nfPxnrAhRHkuN
  Recipient      Tes1zkZkXhgTaMFqVgbgvMsVkRJpq4Y6g54SbDBeKVV
  Status         fully vested
  Allocation     400,000,000
  Vested         400,000,000 (100.00%)
  Claimed        141,666,666.666667
  Claimable now  258,333,333.333333
  Locked         0
  Cliff          25% at 2026-10-07T20:31:52Z
  Linear         2026-10-07T20:31:52Z to 2026-10-10T20:31:52Z, every 1h
  Claims open    2026-10-07T19:30:52Z
  Next unlock    none

Lock 6TBFGPeXKrPPKRSG7TXZgZQsYG22BjZkAEtGuSvUyR5b
  Recipient      Tes1zkZkXhgTaMFqVgbgvMsVkRJpq4Y6g54SbDBeKVV
  Status         vesting
  Allocation     200,000,000
  Vested         114,285,714.285715 (57.14%)
  Claimed        114,285,714.285715
  Claimable now  0
  Locked         85,714,285.714285
  Cliff          none
  Linear         2026-10-07T19:31:52Z to 2026-10-14T19:31:52Z, every 1d
  Claims open    2026-10-07T19:30:52Z
  Next unlock    28,571,428.571428 at 2026-10-12T19:31:52Z

Supply
  Total          1,000,000,000
  Locked         85,714,285.714285 (8.57%)
  Circulating    914,285,714.285715
```
