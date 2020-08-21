const createCsvWriter = require("csv-writer").createObjectCsvWriter
const { sleep, uniqueItems } = require("./utils/js_helpers")
const { decodeOrders } = require("@gnosis.pm/dex-contracts")
const { fetchTokenInfoFromExchange, getExchange } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const BatchRequest = require("./utils/batch_request")(web3)

const { default_yargs } = require("./utils/default_yargs")

const GnosisSafeProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const GnosisSafe = artifacts.require("GnosisSafe")

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

const findOwnedBracketsAmong = async function (proxies, debug = false) {
  const log = debug ? (...a) => console.log(...a) : () => {}
  const errorLog = debug ? (...a) => console.error(...a) : () => {}

  log("Creating batch request")
  const batch = new BatchRequest()
  const bracketAddresses = []

  let i = 0
  for (const proxy of proxies) {
    i++
    log("Adding proxy", i, "out of", proxies.length, "to batch, address", proxy)
    // can't use Truffle's GnosisSafe.deployed().contract because the .deployed() step is an extra request
    const safe = new web3.eth.Contract(GnosisSafe.abi, proxy)
    batch.add(safe.methods.getOwners().call)
  }
  log("Executing batch request")
  const responses = await Promise.allSettled(batch.execute())
  log("Batch request executed")

  let errorCount = 0
  for (const [i, proxy] of Object.entries(proxies)) {
    if (responses[i].status === "fulfilled") {
      const owners = responses[i].value
      log(proxy, owners)
      if (owners.length === 1 && owners[0].toLowerCase() === argv.masterSafe.toLowerCase()) {
        log("Proxy", i, "(", proxy, ")", "is owned.")
        bracketAddresses.push(proxy)
      }
    } else {
      errorCount += 1
      console.error(responses[i].reason)
    }
  }

  if (errorCount !== 0) {
    errorLog("Error count:", errorCount)
  }

  return bracketAddresses
}

const ordersOf = async function (brackets, exchange, debug = false) {
  const log = debug ? (...a) => console.log(...a) : () => {}
  //const errorLog = debug ? (...a) => console.error(...a) : () => {}

  log("Creating batch request")
  const batch = new BatchRequest()
  const ordersPerBracket = []

  let i = 0
  for (const bracket of brackets) {
    i++
    log("Adding bracket", i, "out of", brackets.length, "to batch, address", bracket)
    batch.add(exchange.contract.methods.getEncodedUserOrders(bracket).call)
  }
  log("Executing batch request")
  const responses = await Promise.all(batch.execute())
  log("Batch request executed")

  for (const response of responses) {
    ordersPerBracket.push(decodeOrders(response))
  }

  return ordersPerBracket
}

module.exports = async (callback) => {
  try {
    const latestBlock = await web3.eth.getBlockNumber()
    const proxyFactory = await GnosisSafeProxyFactory.deployed()

    // NOTE: the events captured by the following line are only those created
    // in a direct interaction with the contract. The addresses created with
    // FleetFactory do not appear here.
    const events = await proxyFactory.getPastEvents("ProxyCreation", {
      fromBlock: 0,
      toBlock: latestBlock,
    })
    const allDeployedGnosisProxies = events.map((object) => object.returnValues.proxy)

    const bracketAddresses = []

    // Infura can't handle too many bundled requests
    let bundleSize = 500
    let bundleStart = 0
    // Intentionally inefficient to pound less harshly on Infura
    while (bundleStart < allDeployedGnosisProxies.length) {
      sleep(10000)
      bracketAddresses.push(
        ...(await findOwnedBracketsAmong(allDeployedGnosisProxies.slice(bundleStart, bundleStart + bundleSize)))
      )
      bundleStart += bundleSize
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
    const bracketOrders = []

    bundleSize = 50
    bundleStart = 0
    while (bundleStart < bracketAddresses.length) {
      sleep(10000)
      bracketOrders.push(...(await ordersOf(bracketAddresses.slice(bundleStart, bundleStart + bundleSize), exchange)))
      bundleStart += bundleSize
    }

    let tokensInvolved = []
    bracketOrders.forEach((orders) => {
      if (orders && orders.length > 1) {
        tokensInvolved.push(orders[0].buyToken, orders[0].sellToken)
      }
    })
    tokensInvolved = uniqueItems(tokensInvolved)
    console.log("Tokens used in some brackets:", tokensInvolved)

    sleep(10000)
    fetchTokenInfoFromExchange(exchange, tokensInvolved)

    const records = []
    const totalBrackets = bracketAddresses.length
    let step = 0
    for (const [i, bracketAddress] of Object.entries(bracketAddresses)) {
      step++
      console.log("Reading orders of bracket", step, "out of", totalBrackets)
      const orders = bracketOrders[i]
      let tradingPair
      if (orders.length > 0) {
        const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [orders[0].buyToken, orders[0].sellToken])
        tradingPair =
          (await tokenInfoPromises[orders[0].sellToken]).symbol + " - " + (await tokenInfoPromises[orders[0].buyToken]).symbol
      } else {
        tradingPair = " - not yet defined -"
      }
      records.push({
        Address: bracketAddress,
        Type: "liquidity",
        Description: "bracket-strategy on the pair " + tradingPair + " controlled by master safe: " + argv.masterSafe,
        Tags: "bracket-strategy",
      })
    }

    await csvWriter.writeRecords(records)

    callback()
  } catch (error) {
    callback(error)
  }
}
