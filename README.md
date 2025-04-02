# Superfluid Staking Scripts

This repository contains scripts for managing Superfluid channel stake operations on Base network.

## Setup

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
PRIVATE_KEY=your_private_key_here
STAKE_AMOUNT=10 # Amount to stake in ETH (will be multiplied by 10^18)
```

## Available Scripts

### 1. Stake on Channels (`stakeAndBrickClaim.js`)

This script reads a list of channel addresses from a CSV file, fetches their trading addresses from the Alfafrens API, and stakes tokens on them.

#### Usage:
```bash
node stakeAndBrickClaim.js path/to/input.csv
```

#### Input CSV Format:
```
channelAddress,
0x123...,
0x456...,
```

The CSV must have a `channelAddress` column containing valid Ethereum addresses.

#### Output:
- Console logs of operations
- Results CSV file (`results_[timestamp].csv`) with the following columns:
  - `CHANNEL_ADDRESS`: The channel address from the input CSV
  - `PROFILE_ADDRESS`: The owner of the channel
  - `TRADING_ADDRESS`: The trading address from Alfafrens API
  - `BRICK_TX_HASH`: Transaction hash for the brick claim operation
  - `STAKE_TX_HASH`: Transaction hash for the stake operation
  - `STATUS`: Operation status (SUCCESS, TX_FAILED, NO_TRADING_ADDRESS, etc.)

### 2. Unstake from Channels (`unstakeChannels.js`)

This script reads a list of channel addresses from a CSV file and unstakes tokens from them.

#### Usage:
```bash
node unstakeChannels.js path/to/input.csv
```

#### Input CSV Format:
```
channelAddress,
0x123...,
0x456...,
```

The CSV must have a `channelAddress` column containing valid Ethereum addresses.

#### Output:
- Console logs of operations
- Results CSV file (`unstake_results_[timestamp].csv`) with the following columns:
  - `CHANNEL_ADDRESS`: The channel address from the input CSV
  - `UNSTAKE_TX_HASH`: Transaction hash for the unstake operation
  - `STATUS`: Operation status (SUCCESS, NO_BALANCE_STAKED, ERROR, etc.)