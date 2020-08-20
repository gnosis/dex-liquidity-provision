const createCsvWriter = require("csv-writer").createObjectCsvWriter
const { sleep } = require("./utils/js_helpers")
const { decodeOrders } = require("@gnosis.pm/dex-contracts")
const { fetchTokenInfoFromExchange, getExchange, getSafe, isOnlySafeOwner } = require("./utils/trading_strategy_helpers")(
  web3,
  artifacts
)
const { default_yargs } = require("./utils/default_yargs")

const GnosisSafeProxyFactory = artifacts.require("GnosisSafeProxyFactory")

const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
    demandOption: true,
  })
  .option("outputFile", {
    type: "string",
    describe: "Path and file name for the output of the script",
    demandOption: false,
  }).argv

module.exports = async (callback) => {
  try {
    const proxyFactory = await GnosisSafeProxyFactory.deployed()

    const events = await proxyFactory.getPastEvents("ProxyCreation", {
      fromBlock: 0,
      toBlock: "latest",
    })
    const allDeployedGnosisProxies = events.map((object) => object.returnValues.proxy)

    const bracketAddresses = []
    const totalProxies = allDeployedGnosisProxies.length
    let step = 0
    for (const proxy of allDeployedGnosisProxies) {
      if (await isOnlySafeOwner(argv.masterSafe, proxy)) {
        console.log(step, "out of", totalProxies, "owned by master safe, added to list")
        bracketAddresses.push(proxy)
      } else {
        console.log(step, "out of", totalProxies, "not owned by master safe")
      }
      step++
    }

    console.log("The following addresses have been deployed from your MASTER SAFE: ", bracketAddresses.join())

    // writing the brackets into a csv file
    const csvWriter = createCsvWriter({
      path: argv.outputFile || "./bracket-addresses.csv",
      header: [
        { id: "Address", title: "Address" },
        { id: "Type", title: "Type" },
        { id: "Description", title: "Description" },
        { id: "Tags", title: "Tags" },
      ],
    })

    const exchange = await getExchange(web3)
    const records = []
    const totalBrackets = bracketAddresses.length
    step = 0
    for (const bracketAddress of bracketAddresses) {
      sleep(1000) // sleep 1s to avoid Infura rate limit
      console.log("Reading orders of bracket", step, "out of", totalBrackets)
      const orders = decodeOrders(await exchange.getEncodedUserOrders.call(bracketAddress))
      let tradingPair
      if (orders.length > 0) {
        const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [orders[0].buyToken, orders[0].sellToken])
        tradingPair =
          (await tokenInfoPromises[orders[0].sellToken]).symbol + " - " + (await tokenInfoPromises[orders[0].buyToken]).symbol
      } else {
        tradingPair = " - not yet defined -"
      }
      return {
        Address: bracketAddress,
        Type: "liquidity",
        Description: "bracket-strategy on the pair " + tradingPair + " controlled by master safe: " + argv.masterSafe,
        Tags: "bracket-strategy",
      }
    }
    await csvWriter.writeRecords(records)

    callback()
  } catch (error) {
    callback(error)
  }
}
