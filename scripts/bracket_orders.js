const safeUtils = require("@gnosis.pm/safe-contracts/test/utils/general")
const { buildOrderTransactionData, DELEGATECALL } = require("./trading_strategy_helpers")
const ADDRESS_0 = "0x0000000000000000000000000000000000000000"

const argv = require("yargs")
  .option("targetToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
  })
  .option("stableToken", {
    describe: "Trusted Stable Token for which to open orders (i.e. DAI)",
  })
  .option("targetPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
  })
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes",
  })
  .option("slaves", {
    type: "string",
    describe: "Trader account addresses to place orders on behalf of.",
    coerce: str => {
      return str.split(",")
    },
  })
  .option("priceRange", {
    type: "float",
    describe: "Percentage above and below the target price for which orders are to be placed",
    default: 20,
  })
  .option("validFrom", {
    type: "int",
    describe: "Number of batches (from current) until order become valid",
    default: 3,
  })
  .option("expiry", {
    type: "int",
    describe: "Maximum auction batch for which these orders are valid",
    default: 2 ** 32 - 1,
  })
  .demand(["targetToken", "stableToken", "targetPrice", "masterSafe", "slaves"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    console.log("Preparing Order Data")
    console.log("Master Safe:", argv.masterSafe)
    console.log("Slave Safes:", argv.slaves)
    const transactionData = await buildOrderTransactionData(
      argv.masterSafe,
      argv.slaves,
      argv.targetToken,
      argv.stableToken,
      argv.targetPrice,
      web3,
      artifacts,
      true,
      argv.priceRange,
      argv.validFrom,
      argv.expiry
    )

    console.log(`Transaction Data for Order Placement: \n    To: ${transactionData.to}\n\n    Hex:\n${transactionData.data}`)
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = GnosisSafe.at(argv.masterSafe)

    const nonce = await masterSafe.nonce()
    const transactionHash = await masterSafe.getTransactionHash(
      transactionData.to,
      0,
      transactionData.data,
      DELEGATECALL,
      0,
      0,
      0,
      ADDRESS_0,
      ADDRESS_0,
      nonce
    )
    console.log(transactionHash)
    // const sigs = safeUtils.signTransaction(web3.accounts[0], [web3.accounts[0]], transactionHash)

    callback()
  } catch (error) {
    callback(error)
  }
}
