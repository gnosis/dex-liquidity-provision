const axios = require("axios")

const { signAndSend } = require("./sign_and_send")
const { signTransaction, createLightwallet } = require("../test/utils")
const { transferApproveDeposit, DELEGATECALL, ADDRESS_0 } = require("./trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes",
  })
  .option("depositFile", {
    type: "string",
    describe: "file name (and path) to the list of deposits.",
  })
  .demand(["masterSafe", "depositFile"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    const deposits = require(argv.depositFile)
    console.log("Deposits", deposits)
    const transactionData = await transferApproveDeposit(masterSafe, deposits, web3, artifacts)
    
    await signAndSend(masterSafe, transactionData, web3)

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
