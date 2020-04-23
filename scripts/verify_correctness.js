/**
 * The purpose of the verification script is to ensure that the setup of liquidity-strategy
 * (i.e the GnosisSafes and the Proxies) was done successfully, such that
 * - only the masterSafe can modify the setup
 * - only the masterSafe can withdraw funds
 * - the brackets do not offer profitable orders
 *
 * Unfortunately, there are limitations of the script. For example, we can not ensure
 * that during the deployment no additional owners were added to the safes, as the owners do
 * not necessarily need to be within the "owner-loop". This means that the loop in here:
 * https://github.com/gnosis/safe-contracts/blob/development/contracts/base/OwnerManager.sol#L148
 * is not required to reveal all owners approved here:
 * https://github.com/gnosis/safe-contracts/blob/development/contracts/base/OwnerManager.sol#L15
 */

const { verifyCorrectSetup } = require("./utils/verify_scripts")(web3, artifacts)

const argv = require("yargs")
  .option("brackets", {
    type: "string",
    describe:
      "Trader account addresses for displaying their information, they can be obtained via the script find_bracket_traders",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("masterSafe", {
    type: "string",
    describe: "The masterSafe in control of the bracket-traders",
  })
  .option("masterOwners", {
    type: "string",
    describe: "Addresses that are authorized to have nonzero allowances on any tokens on the master Safe",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("masterThreshold", {
    type: "number",
    describe: "Addresses that are authorized to have nonzero allowances on any tokens on the master Safe",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("allowanceExceptions", {
    type: "string",
    describe: "Addresses that are authorized to have nonzero allowances on any tokens on the master Safe",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .check(function (argv) {
    if ((!argv.masterOwners && argv.masterThreshold) || (argv.masterOwners && !argv.masterThreshold))
      throw new Error("Master owners and master threshold must be either both absent or both specified")
    return true
  })
  .demand(["brackets", "masterSafe"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async (callback) => {
  try {
    await verifyCorrectSetup(
      argv.brackets,
      argv.masterSafe,
      argv.masterThreshold,
      argv.masterOwners,
      argv.allowanceExceptions,
      {},
      true
    )
    callback()
  } catch (error) {
    callback(error)
  }
}
