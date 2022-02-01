const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { getSafe } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { buildBundledTransaction, buildExecTransaction } = require("./utils/internals")(web3, artifacts)
const { default_yargs } = require("./utils/default_yargs")
const { CALL } = require("./utils/constants")
const { promptUser } = require("./utils/user_interface_helpers")

const argv = default_yargs
  .option("parentSafe", {
    type: "string",
    describe: "address of Gnosis Safe owning bracketSafes",
    demandOption: true,
  })
  .option("newOwner", {
    type: "string",
    describe: "address of Owner to add to child safes",
    demandOption: true,
  })
  .option("childSafes", {
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
  }).argv

const prepareAddOwner = async function (parentSafe, childSafes, newOwner) {
  console.log(`building ${argv.childSafes.length} add owner transaction for execution on ${parentSafe}...`)

  const transactions = await Promise.all(
    childSafes.map(async (safe) => {
      // console.log(`Adding owner ${newOwner} to child safe ${safe.address}`)
      const addOwnerTransaction = {
        to: safe.address,
        value: 0,
        // We keep the original owner so that undesired outcomes still result in master safe as
        data: await safe.contract.methods.addOwnerWithThreshold(newOwner, 1).encodeABI(),
        operation: CALL,
      }
      const transaction = await buildExecTransaction(parentSafe, safe.address, addOwnerTransaction)
      return transaction
    })
  )
  return transactions
}

module.exports = async (callback) => {
  try {
    const parentSafe = await getSafe(argv.parentSafe)
    const childSafes = await Promise.all(
      argv.childSafes.map(async (childAddress) => {
        return getSafe(childAddress)
      })
    )
    const transactions = await prepareAddOwner(argv.parentSafe, childSafes, argv.newOwner)
    const transaction = await buildBundledTransaction(transactions)
    const answer = await promptUser("Are you sure you want to send these transactions to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(parentSafe, transaction, argv.network, argv.nonce)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
