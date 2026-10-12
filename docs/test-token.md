# Genesis vesting test token

> **Devnet** for now. A mainnet test token will follow, so platforms can verify on their production UI.

## Devnet: `GVEST`

| | |
|---|---|
| Mint | [`6LNGVeWcQVKDPNktwSJNFXe3Y5HYWVPWJFnggjSbTFYu`](https://explorer.solana.com/address/6LNGVeWcQVKDPNktwSJNFXe3Y5HYWVPWJFnggjSbTFYu?cluster=devnet) |
| Decimals / supply | 6 / 1,000,000,000 |
| Genesis account | [`9BMM3hSm7s2v79qsPYAi7z8rVdDkddSRqC8tBY6TF59d`](https://explorer.solana.com/address/9BMM3hSm7s2v79qsPYAi7z8rVdDkddSRqC8tBY6TF59d?cluster=devnet) |
| Recipient (all buckets) | `Tes1zkZkXhgTaMFqVgbgvMsVkRJpq4Y6g54SbDBeKVV` |
| Created | 1791401512 (2026-10-07 19:31:52 UTC) |

### Buckets

| Bucket | Address | Allocation | Schedule |
|---|---|---|---|
| Unlocked #0 | [`8tAxTyFH…ZASPS`](https://explorer.solana.com/address/8tAxTyFHaic8yiAQu5XBU6CtSezcweadjs8BYVzZASPS?cluster=devnet) | 400,000,000 | Claimed at creation. Circulating |
| Vesting #0 "Team" | [`3stYhdiN…kuN`](https://explorer.solana.com/address/3stYhdiNaWx488MPzJEX5wMoSrBSyA1nfPxnrAhRHkuN?cluster=devnet) | 400,000,000 | 25% cliff at T+1h, then the remaining 75% linear over 3 days in **hourly** steps |
| Vesting #1 "Advisors" | [`6TBFGPeX…yR5b`](https://explorer.solana.com/address/6TBFGPeXKrPPKRSG7TXZgZQsYG22BjZkAEtGuSvUyR5b?cluster=devnet) | 200,000,000 | No cliff. Linear over 7 days in **daily** steps. Pausable + cancelable |

### Expected values

`*` Circulating = total supply − Σ locked (see the [guide](./integration-guide.md#circulating-supply)).

| Checkpoint | Unix | Team vested | Advisors vested | Total locked | Circulating* |
|---|---|---|---|---|---|
| Created (T) | 1791401512 | 0 | 0 | 600,000,000 | 400,000,000 |
| T + 1h (cliff) | 1791405112 | 100,000,000 | 0 | 500,000,000 | 500,000,000 |
| Cliff + 12h | 1791448312 | 150,000,000 | 0 | 450,000,000 | 550,000,000 |
| Cliff + 1d | 1791491512 | 200,000,000 | 28,571,428 | 371,428,571 | 628,571,428 |
| Cliff + 3d (team done) | 1791664312 | 400,000,000 | 85,714,285 | 114,285,714 | 885,714,285 |
| T + 7d (advisors done) | 1792006312 | 400,000,000 | 200,000,000 | 0 | 1,000,000,000 |

Reproduce: `npx tsx scripts/expectedValues.ts devnet`. It computes the table with the [Umi example's](../examples/read_vesting_locks/umi.ts) `fetchVestingLocks`.

If we pause or cancel the Advisors lock to demonstrate those states, the values after that point will change. Any such action will be listed below.

### Example transactions (devnet)

| Action | Signature |
|---|---|
| `InitializeV2` | [`2E4CNRdH…KX21`](https://explorer.solana.com/tx/2E4CNRdHY6BZrDDz5XVanBrXBTceYUxV1zRkphmu12oCARMy8aJ1cb4ykHMX87xJTZDJo3dh8vQSvQfiBSdKkX21?cluster=devnet) |
| `AddUnlockedBucketV2` | [`5Nunkpn6…TVR7`](https://explorer.solana.com/tx/5Nunkpn6tAGzMRqTc6d2fmS4mHjJQgCFH86QjtqFnsRGGp17NdLMUHDCXuyHJaWtTsRHcxGxDAEddVXGb5BvTVR7?cluster=devnet) |
| `AddClaimScheduleBucketV2` (Team) | [`2J4EL9b6…3f3X`](https://explorer.solana.com/tx/2J4EL9b66J5ceZH51tZjnFcqLsPi8yLUqsKLiaNSzcaMfPaaM6u8VqCF8LVhhXT8Y3EiJvVpyHX6XMM9rc8L3f3X?cluster=devnet) |
| `AddClaimScheduleBucketV2` (Advisors) | [`5MxVUoZg…bHJKQ`](https://explorer.solana.com/tx/5MxVUoZg6H8AE1jA7xm2JQ7MurdRtHRo7CbnBpokDStsM7bVYaEXBJhD6zYAGXFvyL23MTphCCnJyEnK4iEbHJKQ?cluster=devnet) |
| `FinalizeV2` | [`5NV35Yk2…SoCN`](https://explorer.solana.com/tx/5NV35Yk2qbPm3bAAWHe1RH6zfUMWiEntq9h3hoxGov2VtCXB1eNBQHptz5LFYYY1TaZJu3bLa3VC6whQW7bESoCN?cluster=devnet) |
| `ClaimUnlockedV2` | [`3X9D42S8…nAgTL`](https://explorer.solana.com/tx/3X9D42S8qF9Gm6fqGEUZ9rMniEH8tN8SWH7xGq2JXLRzseprxFEr3W98jobzGd3CvqDW9WnkReTohRFSLBpnAgTL?cluster=devnet) |
| `ClaimClaimScheduleV2` (Team, cliff + 10 full hours: 141,666,666.666667 claimed, matches the reader) | [`4mcMvPvB…AMZEeS37AMiL1`](https://explorer.solana.com/tx/4mcMvPvBDhZYMRaPo4sVXth6GY381tB6h9BGyQqE1e98W6fdPnBACBCgzcSSQ8T8fz3VzxUnMvG8AZcEZ37AMiL1?cluster=devnet) |
| `ClaimClaimScheduleV2` (Advisors, 4 full days: 114,285,714.285715 claimed, matches the reader) | [`3vkv4TWs…Pvct9U3`](https://explorer.solana.com/tx/3vkv4TWsxGh5eZ9CLcjxY22ySFn2nyLcR9k8X2vecieUYg9yvdg2pURPsF1RPMrXmNS7BGT8bQn6S7tq5Pvct9U3?cluster=devnet) |

## Create your own test token

To test against a token you control, for example to try pause and cancel or to test your indexer from creation onward, create your own with the same layout. The scripts are in [`scripts/`](../scripts/) and use the Umi example's reader, so the numbers they check are the ones your integration should produce.

You need Node 20+ and a devnet keypair with about 0.5 SOL (`solana airdrop 2`). Run these from the kit root after `npm install`:

1. **Create the token.** It has the same buckets as `GVEST` above, and your keypair is the recipient of every bucket:
   ```sh
   KEYPAIR=~/path/id.json RPC=https://api.devnet.solana.com npx tsx scripts/createTestToken.ts
   ```
   This prints and saves every address and signature to `out/test-token-devnet-<mint>.json` (or `out/test-token-devnet.json` if that file doesn't exist yet).
2. **Print its expected values** at the same checkpoints as the table above:
   ```sh
   npx tsx scripts/expectedValues.ts out/test-token-devnet-<mint>.json
   ```
3. **Claim and compare.** Sends a real claim, then checks that the program transferred exactly what the reader predicted at the transaction's block time:
   ```sh
   KEYPAIR=~/path/id.json RPC=https://api.devnet.solana.com npx tsx scripts/verifyClaim.ts <lock address> [label]
   ```
4. **Optional: pause and cancel.** Creates a separate token with a 10-minute schedule, pauses one lock and cancels another, then claims both and compares. It takes about 6 minutes:
   ```sh
   KEYPAIR=~/path/id.json npx tsx scripts/verifyEdgeCases.ts
   ```

Claim results are appended to `out/claims.jsonl`.

## Real mainnet locks (reference)

There are already `ClaimScheduleBucketV2` locks on mainnet. Example:

- Lock [`4kGV5yv1PiR8BJzb8pDqY8C7bjttoy5Bsi84k2ZfnpC8`](https://explorer.solana.com/address/4kGV5yv1PiR8BJzb8pDqY8C7bjttoy5Bsi84k2ZfnpC8): mint `VK2NancNtR9D7CsWoXze7r7pEbqfLXDr9AYjTJRPLEX`, 800M allocation, 12.5% cliff on 2027-01-16 00:30 UTC, then linear for ~21 months in monthly steps. Its claim window opens at graduation.
