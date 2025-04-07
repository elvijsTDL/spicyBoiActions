import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import csv from "csv-parser";
import fs from "fs";
import { createObjectCsvWriter } from "csv-writer";
import dotenv from "dotenv";
import rewardController from "./abis/rewardController.json" assert { type: "json" };

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

async function unstakeFromChannels(channelAddress) {
  try {
    console.log(`Processing transaction for address: ${channelAddress}`);

    const afStakedToChannel = await publicClient.readContract({
      address: REWARDCONTROLLER_ADDRESS,
      abi: REWARDCONTROLLER_ABI,
      functionName: "stakedBalanceOf",
      args: [account.address, channelAddress],
    });

    console.log(`Staked balance: ${afStakedToChannel}`);

    // Skip if no balance staked
    if (afStakedToChannel <= 0) {
      console.warn(`No balance staked for ${channelAddress}, skipping`);
      return {
        unstakeTxHash: null,
        unstakeReceipt: null,
        status: "NO_BALANCE_STAKED",
      };
    }

    const unstakeTxHash = await walletClient.writeContract({
      address: REWARDCONTROLLER_ADDRESS,
      abi: REWARDCONTROLLER_ABI,
      functionName: "unstake",
      args: [channelAddress, afStakedToChannel],
    });

    console.log(`Transaction sent: ${unstakeTxHash}`);
    const unstakeReceipt = await publicClient.waitForTransactionReceipt({
      hash: unstakeTxHash,
    });

    return {
      unstakeTxHash,
      unstakeReceipt,
      status: "SUCCESS",
    };
  } catch (error) {
    console.error(`Error executing transactions for ${channelAddress}:`, error);
    return {
      unstakeTxHash: null,
      unstakeReceipt: null,
      status: `ERROR: ${error.message}`,
    };
  }
}

async function processAddresses(csvFilePath) {
  const results = [];
  const txResults = [];
  const outputCsvPath = `unstake_results_${Date.now()}.csv`;

  const csvWriter = createObjectCsvWriter({
    path: outputCsvPath,
    header: [
      { id: "channelAddress", title: "CHANNEL_ADDRESS" },
      { id: "unstakeTxHash", title: "UNSTAKE_TX_HASH" },
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
            unstakeTxHash: "",
            status: "SKIPPED",
          };

          if (!channelAddress || !channelAddress.startsWith("0x")) {
            console.warn("Skipping invalid address:", channelAddress);
            resultRow.status = "INVALID_ADDRESS";
            txResults.push(resultRow);
            continue;
          }

          try {
            const result = await unstakeFromChannels(channelAddress);
            resultRow.unstakeTxHash = result.unstakeTxHash || "";
            resultRow.status = result.status;

            if (result.status === "SUCCESS") {
              console.log(`Successfully unstaked from ${channelAddress}`);
            } else {
              console.warn(
                `Failed to unstake from ${channelAddress}: ${result.status}`
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
