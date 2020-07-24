const BigNumber = require("bignumber.js")
const path = require("path")

const { signAndSend, transactionExistsOnSafeServer } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { buildTransferDataFromList } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { promptUser, proceedAnyways } = require("./utils/user_interface_helpers")
const { parseCsvFile } = require("./utils/parse_csv")
const { default_yargs } = require("./utils/default_yargs")
const argv = default_yargs
  .option("fundAccount", {
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

const toPayment = function (leaderBoardItem) {
  const { receiver, amount, token_address: tokenAddress } = leaderBoardItem
  return {
    tokenAddress,
    receiver,
    amount: new BigNumber(amount),
  }
}

const parseTransferFile = async function (filename) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === ".csv") {
    const results = await parseCsvFile(filename)

    const payments = results.map(toPayment).filter((payment) => !payment.amount.isZero())
    return payments.map(({ amount, receiver, tokenAddress }) => ({
      amount: amount.toString(10),
      receiver,
      tokenAddress,
    }))
  } else if (ext === ".json") {
    return JSON.parse(await fs.readFile(filename, "utf8"))
  } else {
    throw new Error(`unsupported file type .${ext}`)
  }
}

module.exports = async (callback) => {
  try {
    const transfers = await parseTransferFile(argv.transferFile)
    console.log(`Found ${transfers.length} elements in transfer file`)

    if (transfers.length > 200) {
      if (!(await proceedAnyways("It is not recommended to attempt more than 200 transfers."))) {
        callback("Error: Too many transfers!")
      }
    }

    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.fundAccount)

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
    console.error(error)
    callback(error)
  }
}
