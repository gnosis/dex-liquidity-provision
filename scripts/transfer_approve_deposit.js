const { signAndSend, promptUser } = require("./utils/sign_and_send")(web3, artifacts)
const { buildTransferApproveDepositFromList } = require("./utils/trading_strategy_helpers")(web3, artifacts)

const argv = require("./utils/default_yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning the brackets",
  })
  .option("depositFile", {
    type: "string",
    describe: "file name (and path) to the list of deposits.",
  })
  .demand(["masterSafe", "depositFile"])
  .argv

module.exports = async callback => {
  try {
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    const deposits = require(argv.depositFile)
    // TODO - make a simpler to construct deposit file style
    console.log("Preparing transaction data...")
    const transaction = await buildTransferApproveDepositFromList(masterSafe.address, deposits, true)

    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(masterSafe, transaction, argv.network)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
