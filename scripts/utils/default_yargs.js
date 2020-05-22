const default_yargs = require("yargs")
  .version(false)
  .strict()
  .help("help")
  .epilog(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .option("network", {
    type: "string",
    describe: "network where the script is executed",
    choices: ["rinkeby", "mainnet"],
  })

const checkNoDuplicate = function (array) {
  return new Set(array).size !== array.length
}

/**
 * Ensure brackets (as an array) contains only unique elements.
 *
 * @param {object} argv script arguments.
 * @returns {boolean} true always.
 */
function checkBracketsForDuplicate(argv) {
  if (argv.brackets && checkNoDuplicate(argv.brackets))
    throw new Error("the parameter --brackets is not supposed to have duplicated entries")
  return true
}

module.exports = {
  default_yargs,
  checkBracketsForDuplicate,
}
