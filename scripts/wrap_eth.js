const Contract = require("@truffle/contract")

const { signAndSend, promptUser } = require("./utils/sign_and_send")(web3, artifacts)
const { CALL } = require("./utils/internals")(web3, artifacts)
const { toErc20Units, fromErc20Units } = require("./utils/printing_tools")

const argv = require("./utils/default_yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of the Gnosis Safe that holds the ETH to be wrapped",
    demandOption: true,
  })
  .option("amount", {
    type: "string",
    describe: "Amount of ETH to convert (in ETH, e.g. 3.14159)",
    demandOption: true,
  }).argv

module.exports = async callback => {
  try {
    const WETH = Contract(require("canonical-weth/build/contracts/WETH9"))
    WETH.setProvider(web3.currentProvider)

    const weth = await WETH.deployed()

    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    const decimals = await weth.decimals()
    const amountInWei = toErc20Units(argv.amount, decimals)

    const transactionData = await weth.contract.methods.deposit().encodeABI()
    const transaction = {
      to: weth.address,
      value: amountInWei,
      operation: CALL,
      data: transactionData,
    }

    console.log(await weth.name(), "at address", weth.address)
    console.log("Converting", fromErc20Units(transaction.value, decimals), "ETH into", await weth.symbol())

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
