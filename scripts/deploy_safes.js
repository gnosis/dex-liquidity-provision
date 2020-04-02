const { deployFleetOfSafes } = require("./utils/trading_strategy_helpers")(web3, artifacts)

const argv = require("./utils/default_yargs")
  .option("masterSafe", {
    type: "int",
    describe: "Address of Gnosis Safe that is going to own the new fleet",
  })
  .option("fleetSize", {
    type: "int",
    describe: "Number of (sub)safes to be deployed",
  })
  .demand(["masterSafe", "fleetSize"])
  .argv

module.exports = async callback => {
  try {
    console.log("Master Safe:", argv.masterSafe)
    console.log(`Deploying a fleet of Safes of size ${argv.fleetSize}`)
    const fleet = await deployFleetOfSafes(argv.masterSafe, argv.fleetSize, true)
    console.log(" Addresses", fleet.join())
    callback()
  } catch (error) {
    callback(error)
  }
}
