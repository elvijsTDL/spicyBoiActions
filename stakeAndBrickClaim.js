import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import csv from "csv-parser";
import fs from "fs";
import { createObjectCsvWriter } from "csv-writer";
import dotenv from "dotenv";
import fetch from "node-fetch";
import rewardController from "./abis/rewardController.json" assert { type: "json" };
import channelABI from "./abis/channelABI.json" assert { type: "json" };
dotenv.config();

const RPC_URL = "https://rpc-endpoints.superfluid.dev/base-mainnet";
const account = privateKeyToAccount(process.env.PRIVATE_KEY || "0x");
const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(RPC_URL),
});

const REWARDCONTROLLER_ADDRESS = "0x1fd7aee0321e31c7c47c4da183dc1054e1196b5f";
const REWARDCONTROLLER_ABI = rewardController;

async function fetchDataFromAPI(address) {
  try {
    const response = await fetch(
      "https://www.alfafrens.com/api/v0/getTradingAddresses",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          users_addresses: [address],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (
      data.users_tradable_addresses &&
      data.users_tradable_addresses.length > 0
    ) {
      return data.users_tradable_addresses[0].tradingAddress;
    } else {
      console.warn(`No trading address found for ${address}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching data for ${address}:`, error);
    return null;
  }
}

async function brickClaimAndStake(channelAddress) {
  try {
    console.log(`Processing transaction for address: ${channelAddress}`);

    const { hash: brickTransaction } = await walletClient.writeContract({
      address: REWARDCONTROLLER_ADDRESS,
      abi: REWARDCONTROLLER_ABI,
      functionName: "blockClaimForChannel",
      args: [channelAddress],
    });

    const { hash: stakeTx } = await walletClient.writeContract({
      address: REWARDCONTROLLER_ADDRESS,
      abi: REWARDCONTROLLER_ABI,
      functionName: "stake",
      args: [channelAddress, BigInt(process.env.STAKE_AMOUNT * 1e18)],
    });

    console.log(`Brick tx sent: ${brickTransaction}`);
    console.log(`Stake tx sent: ${stakeTx}`);
    const brickReceipt = await publicClient.waitForTransactionReceipt({
      hash: brickTransaction,
    });
    const stakeReceipt = await publicClient.waitForTransactionReceipt({
      hash: stakeTx,
    });

    return {
      brickTxHash: brickTransaction,
      stakeTxHash: stakeTx,
      brickReceipt,
      stakeReceipt,
    };
  } catch (error) {
    console.error(`Error executing transactions for ${channelAddress}:`, error);
    return null;
  }
}

async function processAddresses(csvFilePath) {
  const results = [];
  const txResults = [];
  const outputCsvPath = `results_${Date.now()}.csv`;

  const csvWriter = createObjectCsvWriter({
    path: outputCsvPath,
    header: [
      { id: "channelAddress", title: "CHANNEL_ADDRESS" },
      { id: "profileAddress", title: "PROFILE_ADDRESS" },
      { id: "tradingAddress", title: "TRADING_ADDRESS" },
      { id: "brickTxHash", title: "BRICK_TX_HASH" },
      { id: "stakeTxHash", title: "STAKE_TX_HASH" },
      { id: "status", title: "STATUS" },
    ],
  });

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", async () => {
        console.log(`Processing ${results.length} addresses from CSV...`);

        for (const row of results) {
          const channelAddress = row.channelAddress;
          const resultRow = {
            channelAddress,
            profileAddress: "",
            tradingAddress: "",
            brickTxHash: "",
            stakeTxHash: "",
            status: "SKIPPED",
          };

          if (!channelAddress || !channelAddress.startsWith("0x")) {
            console.warn("Skipping invalid address:", channelAddress);
            resultRow.status = "INVALID_ADDRESS";
            txResults.push(resultRow);
            continue;
          }

          try {
            const channelOwner = await publicClient.readContract({
              address: channelAddress,
              abi: channelABI,
              functionName: "owner",
            });

            resultRow.profileAddress = channelOwner;

            const tradingAddress = await fetchDataFromAPI(channelOwner);
            if (tradingAddress) {
              resultRow.tradingAddress = tradingAddress;

              const receipt = await brickClaimAndStake(tradingAddress);
              if (receipt) {
                resultRow.brickTxHash = receipt.brickTxHash;
                resultRow.stakeTxHash = receipt.stakeTxHash;
                resultRow.status = "SUCCESS";

                console.log(
                  `Processed trading address ${tradingAddress} for profile ${channelOwner}`
                );
              } else {
                resultRow.status = "TX_FAILED";
                console.warn(
                  `Transaction failed for ${channelOwner} with trading address ${tradingAddress}`
                );
              }
            } else {
              resultRow.status = "NO_TRADING_ADDRESS";
              console.warn(
                `Skipping address ${channelOwner} - no trading address found`
              );
            }
          } catch (error) {
            resultRow.status = `ERROR: ${error.message}`;
            console.error(`Error processing ${channelAddress}:`, error);
          }

          txResults.push(resultRow);
        }

        try {
          await csvWriter.writeRecords(txResults);
          console.log(
            `All addresses processed successfully! Results saved to ${outputCsvPath}`
          );
          resolve();
        } catch (error) {
          console.error("Failed to write results to CSV:", error);
          reject(error);
        }
      })
      .on("error", (error) => {
        console.error("CSV parsing error:", error);
        reject(error);
      });
  });
}

const csvFilePath = process.argv[2];
if (!csvFilePath) {
  console.error("Please provide a CSV file path as an argument");
  process.exit(1);
}

processAddresses(csvFilePath).catch((error) => {
  console.error("Failed to process addresses:", error);
  process.exit(1);
});
