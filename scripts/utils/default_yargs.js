module.exports = require("yargs")
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