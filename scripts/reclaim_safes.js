const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { getSafe } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { buildBundledTransaction } = require("./utils/internals")(web3, artifacts)
const { default_yargs } = require("./utils/default_yargs")
const { CALL } = require("./utils/constants")
const { promptUser } = require("./utils/user_interface_helpers")

const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "address of Gnosis Safe owning bracketSafes",
    demandOption: true,
  })
  .option("newOwner", {
    type: "string",
    describe: "address of Owner to add to child safes",
    demandOption: true,
  })
  .option("brackets", {
    type: "string",
    describe:
      "comma-separated list of brackets from which to withdraw the entire balance. Compatible with all valid combinations of --requestWithdraw, --withdraw, --transferFundsToMaster",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("nonce", {
    type: "number",
    describe:
      "Nonce used in the transaction submitted to the web interface. If omitted, the first available nonce considering all pending transactions will be used.",
    default: null,
  })

const prepareAddOwner = async function (argv, printOutput = false) {
  const log = printOutput ? (...a) => console.log(...a) : () => {}

  log(`building add ${argv.brackets.length} owner transaction...`)
  const transactions = argv.brackets.map((bracket) => {
    const bracketSafe = getSafe(bracket)
    const transaction = {
      to: bracketSafe.address,
      value: 0,
      // We keep the original owner so that undesired outcomes still result in master safe as
      data: bracketSafe.contract.methods.addOwnerWithThreshold(argv.newOwner, 1).encodeABI(),
      operation: CALL,
    }
    log(`Adding owner ${argv.newOwner} to child safe ${transaction.to}`)
    return transaction
  })
  return buildBundledTransaction(transactions)
}

module.exports = async (callback) => {
  try {
    const masterSafe = getSafe(argv.masterSafe)
    const transaction = await prepareAddOwner(argv, true)

    const answer = await promptUser("Are you sure you want to send these transactions to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(masterSafe, transaction, argv.network, argv.nonce)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
