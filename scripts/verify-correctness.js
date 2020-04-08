const { verifyCorrectSetup } = require("./utils/verify-scripts")(web3, artifacts)

const argv = require("yargs")
  .option("brackets", {
    type: "string",
    describe:
      "Trader account addresses for displaying their information, they can be obtained via the script find_bracket_traders",
    coerce: str => {
      return str.split(",")
    },
  })
  .option("masterSafe", {
    type: "string",
    describe: "The masterSafe in control of the bracket-traders",
  })
  .option("allowanceExceptions", {
    type: "string",
    describe: "Addresses that are authorized to have nonzero allowances on any tokens on the master Safe",
    coerce: str => {
      return str.split(",")
    },
  })
  .demand(["brackets", "masterSafe"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    await verifyCorrectSetup(argv.brackets, argv.masterSafe, argv.allowanceExceptions)
    callback()
  } catch (error) {
    callback(error)
  }
}
