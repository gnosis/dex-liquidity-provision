const assert = require("assert")
const Contract = require("@truffle/contract")

const {
  deployFleetOfSafes,
  fetchTokenInfoFromExchange,
  buildTransferApproveDepositFromOrders,
  buildOrders,
  checkSufficiencyOfBalance,
  isOnlySafeOwner,
  hasExistingOrders,
} = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { isPriceReasonable, areBoundsReasonable } = require("./utils/price_utils")(web3, artifacts)
const { signAndSend } = require("./utils/sign_and_send")(web3, artifacts)
const { proceedAnyways } = require("./utils/user_interface_helpers")(web3, artifacts)
const { toErc20Units } = require("./utils/printing_tools")
const { sleep } = require("./utils/js_helpers")

const argv = require("./utils/default_yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
    demandOption: true,
  })
  .option("fleetSize", {
    type: "int",
    default: 20,
    describe: "Even number of brackets to be deployed",
  })
  .option("brackets", {
    type: "string",
    describe: "Trader account addresses to place orders on behalf of",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("targetToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
    demandOption: true,
  })
  .option("investmentTargetToken", {
    type: "string",
    describe: "Amount to be invested into the targetToken",
    demandOption: true,
  })
  .option("stableToken", {
    type: "int",
    describe: "Trusted Stable Token for which to open orders (i.e. DAI)",
    demandOption: true,
  })
  .option("investmentStableToken", {
    type: "string",
    describe: "Amount to be invested into the stableToken",
    demandOption: true,
  })
  .option("currentPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
    demandOption: true,
  })
  .option("lowestLimit", {
    type: "float",
    describe: "Price for the bracket buying with the lowest price",
  })
  .option("highestLimit", {
    type: "float",
    describe: "Price for the bracket selling at the highest price",
  }).argv

module.exports = async (callback) => {
  try {
    // Init params
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    const exchange = await BatchExchange.deployed()

    const targetTokenId = argv.targetToken
    const stableTokenId = argv.stableToken
    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [targetTokenId, stableTokenId])
    const targetTokenData = await tokenInfoPromises[targetTokenId]
    const stableTokenData = await tokenInfoPromises[stableTokenId]
    const { instance: targetToken, decimals: targetTokenDecimals } = targetTokenData
    const { instance: stableToken, decimals: stableTokenDecimals } = stableTokenData

    const investmentTargetToken = toErc20Units(argv.investmentTargetToken, targetTokenDecimals)
    const investmentStableToken = toErc20Units(argv.investmentStableToken, stableTokenDecimals)

    if (argv.brackets) {
      assert(argv.fleetSize === argv.brackets.length, "Please ensure fleetSize equals number of brackets")
    }
    assert(argv.fleetSize % 2 === 0, "Fleet size must be a even number for easy deployment script")

    console.log("==> Performing safety checks")
    if (!(await checkSufficiencyOfBalance(targetToken, masterSafe.address, investmentTargetToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${targetToken.address}.`)
    }
    if (!(await checkSufficiencyOfBalance(stableToken, masterSafe.address, investmentStableToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${stableToken.address}.`)
    }
    // check price against dex.ag's API
    const priceCheck = await isPriceReasonable(targetTokenData, stableTokenData, argv.currentPrice)
    if (!priceCheck) {
      if (!(await proceedAnyways("Price check failed!"))) {
        callback("Error: Price checks did not pass")
      }
    }
    const boundCheck = areBoundsReasonable(argv.currentPrice, argv.lowestLimit, argv.highestLimit)
    if (!boundCheck) {
      if (!(await proceedAnyways("Bound checks failed!"))) {
        callback("Error: Bound checks did not pass")
      }
    }
    if (argv.fleetSize > 23) {
      callback("Error: Choose a smaller fleetSize, otherwise your payload will be to big for Infura nodes")
    }

    let bracketAddresses
    if (argv.brackets) {
      console.log("==> Skipping safe deployment and using brackets safeOwners")
      bracketAddresses = argv.brackets
      // Ensure that safes are all owned solely by masterSafe
      const masterNotOnlyOwner = await Promise.all(
        bracketAddresses.map(async (safeAddr) => {
          return !(await isOnlySafeOwner(masterSafe.address, safeAddr))
        })
      )
      const badSafes = masterNotOnlyOwner.filter((_, i) => masterNotOnlyOwner[i])
      if (badSafes.some((t) => t)) {
        callback(
          `Error: Brackets ${badSafes.join()} is/are not owned (or at least not solely) by master safe ${masterSafe.address}`
        )
      }
      // Detect if provided brackets have existing orders.
      const existingOrders = await Promise.all(
        bracketAddresses.map(async (safeAddr) => {
          return hasExistingOrders(safeAddr, exchange)
        })
      )
      const dirtyBrackets = bracketAddresses.filter((_, i) => existingOrders[i] == true)
      if (
        existingOrders.some((t) => t) &&
        !(await proceedAnyways(`The following brackets have existing orders:\n  ${dirtyBrackets.join()}\n`))
      ) {
        callback("Error: Existing order verification failed.")
      }
    } else {
      console.log(`==> Deploying ${argv.fleetSize} trading brackets`)
      bracketAddresses = await deployFleetOfSafes(masterSafe.address, argv.fleetSize, true)
      console.log("List of bracket traders in one line:", bracketAddresses.join())
      // Sleeping for 3 seconds to make sure Infura nodes have processed
      // all newly deployed contracts so they can be awaited.
      await sleep(3000)
    }

    console.log("==> Building orders and deposits")
    const orderTransaction = await buildOrders(
      masterSafe.address,
      bracketAddresses,
      argv.targetToken,
      argv.stableToken,
      argv.lowestLimit,
      argv.highestLimit,
      true
    )
    const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
      masterSafe.address,
      bracketAddresses,
      targetToken.address,
      stableToken.address,
      argv.lowestLimit,
      argv.highestLimit,
      argv.currentPrice,
      investmentStableToken,
      investmentTargetToken,
      true
    )

    console.log(
      "==> Sending the order placing transaction to gnosis-safe interface.\n    Attention: This transaction MUST be executed first!"
    )
    const nonce = (await masterSafe.nonce()).toNumber()
    await signAndSend(masterSafe, orderTransaction, argv.network, nonce)

    console.log(
      "==> Sending the funds transferring transaction.\n    Attention: This transaction can only be executed after the one above!"
    )
    await signAndSend(masterSafe, bundledFundingTransaction, argv.network, nonce + 1)

    callback()
  } catch (error) {
    callback(error)
  }
}
