const BigNumber = require("bignumber.js")
const fs = require("fs").promises
const path = require("path")

const { toErc20Units } = require("./utils/printing_tools")
// const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { signAndExecute } = require("./utils/internals")(web3, artifacts)
const { buildBundledTransaction } = require("./utils/internals")(web3, artifacts)
const { parseCsvFile } = require("./utils/parse_csv")
const { promptUser } = require("./utils/user_interface_helpers")
const { default_yargs } = require("./utils/default_yargs")
const argv = default_yargs
  .option("fundAccount", {
    type: "string",
    describe: "Address of Gnosis Safe transferring funds",
    demandOption: true,
  })
  .option("transferFile", {
    type: "string",
    describe: "file name (and path) to the list transfers",
    demandOption: true,
  })
  .option("batchSize", {
    type: "number",
    describe: "Partition width of each transfer bundle",
    default: 10,
  })
  .option("nonce", {
    type: "number",
    describe:
      "Nonce used in the transaction submitted to the web interface. If omitted, the first available nonce considering all pending transactions will be used.",
    default: null,
  }).argv

const CALL = 0

const toPayment = function (csvRow) {
  const { receiver, amount } = csvRow
  return {
    receiver,
    amount: new BigNumber(amount),
  }
}

const parseTransferFile = async function (filename) {
  const ext = path.extname(filename).toLowerCase()
  let results
  if (ext === ".csv") {
    results = await parseCsvFile(filename)
    results = results.map(({ amount, receiver }) => ({
      amount,
      receiver,
    }))
  } else if (ext === ".json") {
    results = JSON.parse(await fs.readFile(filename, "utf8"))
  } else {
    throw new Error(`unsupported file type ${ext}`)
  }
  const payments = results.map(toPayment).filter((payment) => !payment.amount.isZero())
  return payments.map(({ amount, receiver }) => ({
    amount: amount.toString(10),
    receiver,
  }))
}

const partitionedTransfers = function (payments, size) {
  const numBatches = Math.ceil(payments.length / size)
  console.log(`Splitting ${payments.length} transfers into ${numBatches} batches of size ${size}`)
  const output = []

  for (let i = 0; i < payments.length; i += size) {
    output[output.length] = payments.slice(i, i + size)
  }

  return output
}

module.exports = async (callback) => {
  try {
    const transfers = await parseTransferFile(argv.transferFile)
    console.log(`Found ${transfers.length} valid elements in transfer file`)

    const { GnosisSafe } = require("./utils/dependencies")(web3, artifacts)
    const masterSafe = await GnosisSafe.at(argv.fundAccount)

    console.log("Preparing transaction data...")
    const partition = partitionedTransfers(transfers, argv.batchSize)
    const transactionLists = partition.map((transferBatch) => {
      return transferBatch.map((transfer) => {
        const weiAmount = toErc20Units(transfer.amount, 18).toString(10)
        return {
          operation: CALL,
          to: transfer.receiver,
          value: weiAmount,
          data: "0x",
        }
      })
    })
    const numBundles = transactionLists.length
    console.log(
      `Prepared ${numBundles} bundles of size ${argv.batchSize} (last one having ${
        transfers.length - (numBundles - 1) * argv.batchSize
      })`
    )

    const answer = await promptUser("Are you sure you want to send these transactions to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      let nonce = argv.nonce
      for (const transactions of transactionLists) {
        const transaction = await buildBundledTransaction(transactions)
        nonce = await signAndExecute(masterSafe, transaction, nonce)
        nonce = nonce + 1
      }
    }
    callback()
  } catch (error) {
    console.error(error)
    callback(error)
  }
}
