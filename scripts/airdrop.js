const fs = require("fs").promises

const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { buildTransferDataFromList } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { promptUser } = require("./utils/user_interface_helpers")
const { default_yargs } = require("./utils/default_yargs")
const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning the brackets",
    demandOption: true,
  })
  .option("transferFile", {
    type: "string",
    describe: "file name (and path) to the list transfers",
    demandOption: true,
  })
  .option("useWei", {
    type: "string",
    describe: "file name (and path) to the list transfers",
    demandOption: false,
  }).argv

module.exports = async (callback) => {
  try {
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    const transfers = JSON.parse(await fs.readFile(argv.transferFile, "utf8"))

    console.log("Preparing transaction data...")
    const transaction = await buildTransferDataFromList(masterSafe.address, transfers, argv.useWei, false, true)

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
