const { deployFleetOfSafes } = require("./utils/trading_strategy_helpers")(web3, artifacts)

const { default_yargs } = require("./utils/default_yargs")
const argv = default_yargs
  .option("masterSafe", {
    type: "int",
    describe: "Address of Gnosis Safe that is going to own the new fleet",
    demandOption: true,
  })
  .option("numSafes", {
    type: "int",
    describe: "Number of (sub)safes to be deployed",
    demandOption: true,
  }).argv

module.exports = async (callback) => {
  try {
    console.log("Master Safe:", argv.masterSafe)
    console.log(`Deploying a fleet of Safes of size ${argv.numSafes}`)
    const fleet = await deployFleetOfSafes(argv.masterSafe, argv.numSafes)
    console.log(" Addresses", fleet.join())
    callback()
  } catch (error) {
    callback(error)
  }
}
