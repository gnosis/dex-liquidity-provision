const { signAndSend, promptUser } = require("./utils/sign_and_send")(web3, artifacts)
const { getSafe } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const prepareWithdraw = require("./wrapper/withdraw")(web3, artifacts)

const argv = require("./utils/default_yargs")
  .option("masterSafe", {
    type: "string",
    describe: "address of Gnosis Safe owning bracketSafes",
    demandOption: true,
  })
  .option("withdrawalFile", {
    type: "string",
    describe: "file name (and path) to the list of withdrawals",
  })
  .option("brackets", {
    type: "string",
    describe:
      "comma-separated list of brackets from which to withdraw the entire balance. Compatible with all valid combinations of --requestWithdraw, --withdraw, --transferFundsToMaster",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("tokens", {
    type: "string",
    describe: "comma separated address list of tokens to withdraw, to use in combination with --brackets",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("tokenIds", {
    type: "string",
    describe: "comma separated list of exchange ids for the tokens to withdraw, to use in combination with --brackets",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("requestWithdraw", {
    type: "boolean",
    default: false,
    describe: "request withdraw from the exchange",
  })
  .option("withdraw", {
    type: "boolean",
    default: false,
    describe: "withdraw from the exchange. A withdraw request must always be made before withdrawing funds from the exchange",
  })
  .option("transferFundsToMaster", {
    type: "boolean",
    default: false,
    describe: "transfer back funds from brackets to master. Funds must be present in the bracket wallets",
  }).argv

module.exports = async (callback) => {
  try {
    const masterSafe = getSafe(argv.masterSafe)

    const transaction = await prepareWithdraw(argv, true)
    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(await masterSafe, transaction, argv.network)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
