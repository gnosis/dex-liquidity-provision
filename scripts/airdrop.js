const fs = require("fs").promises

const { signAndSend, transactionExistsOnSafeServer } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { buildTransferDataFromList } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { promptUser } = require("./utils/user_interface_helpers")
const { default_yargs } = require("./utils/default_yargs")
const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe transfering funds",
    demandOption: true,
  })
  .option("transferFile", {
    type: "string",
    describe: "file name (and path) to the list transfers",
    demandOption: true,
  })
  .option("verify", {
    type: "boolean",
    default: false,
    describe: "Do not actually send transactions, just simulate their submission",
  }).argv

module.exports = async (callback) => {
  try {
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    const transfers = JSON.parse(await fs.readFile(argv.transferFile, "utf8"))

    console.log("Preparing transaction data...")
    const transaction = await buildTransferDataFromList(masterSafe.address, transfers, false, true)

    if (!argv.verify) {
      const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
      if (answer == "y" || answer.toLowerCase() == "yes") {
        await signAndSend(masterSafe, transaction, argv.network)
      }
    } else {
      console.log("Verifying transaction")
      await transactionExistsOnSafeServer(masterSafe, transaction, argv.network, (await masterSafe.nonce()).toNumber())
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
