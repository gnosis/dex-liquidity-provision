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
const { proceedAnyways } = require("./utils/user_interface_helpers")
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
  .option("baseToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
    demandOption: true,
  })
  .option("investmentBaseToken", {
    type: "string",
    describe: "Amount to be invested into the baseToken",
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
  })
  .option("verify", {
    type: "boolean",
    default: false,
    describe: "Do not actually send transactions, just simulate their submission",
  })
  .option("nonce", {
    type: "int",
    describe: "Use this specific nonce instead of the next available one",
  }).argv

module.exports = async (callback) => {
  try {
    // Init params
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    const exchange = await BatchExchange.deployed()

    const baseTokenId = argv.baseToken
    const stableTokenId = argv.stableToken
    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [baseTokenId, stableTokenId])
    const baseTokenData = await tokenInfoPromises[baseTokenId]
    const stableTokenData = await tokenInfoPromises[stableTokenId]
    const { instance: baseToken, decimals: baseTokenDecimals } = baseTokenData
    const { instance: stableToken, decimals: stableTokenDecimals } = stableTokenData

    const investmentBaseToken = toErc20Units(argv.investmentBaseToken, baseTokenDecimals)
    const investmentStableToken = toErc20Units(argv.investmentStableToken, stableTokenDecimals)

    if (argv.brackets) {
      assert(argv.fleetSize === argv.brackets.length, "Please ensure fleetSize equals number of brackets")
    }
    assert(argv.fleetSize % 2 === 0, "Fleet size must be a even number for easy deployment script")

    console.log("==> Performing safety checks")
    if (!(await checkSufficiencyOfBalance(baseToken, masterSafe.address, investmentBaseToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${baseToken.address}.`)
    }
    if (!(await checkSufficiencyOfBalance(stableToken, masterSafe.address, investmentStableToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${stableToken.address}.`)
    }
    // check price against dex.ag's API
    const priceCheck = await isPriceReasonable(baseTokenData, stableTokenData, argv.currentPrice)
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
      await Promise.all(
        bracketAddresses.map(async (safeAddr) => {
          if (!(await isOnlySafeOwner(masterSafe.address, safeAddr))) {
            callback(`Error: Bracket ${safeAddr} is not owned (or at least not solely) by master safe ${masterSafe.address}`)
          }
        })
      )
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
      assert(!argv.verify, "Trading Brackets need to be provided via --brackets when verifying a transaction")
      console.log(`==> Deploying ${argv.fleetSize} trading brackets`)
      bracketAddresses = await deployFleetOfSafes(masterSafe.address, argv.fleetSize)
      // Sleeping for 3 seconds to make sure Infura nodes have processed
      // all newly deployed contracts so they can be awaited.
      await sleep(3000)
    }

    console.log("==> Building orders and deposits")
    const orderTransaction = await buildOrders(
      masterSafe.address,
      bracketAddresses,
      argv.baseToken,
      argv.stableToken,
      argv.lowestLimit,
      argv.highestLimit,
      true
    )
    const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
      masterSafe.address,
      bracketAddresses,
      baseToken.address,
      stableToken.address,
      argv.lowestLimit,
      argv.highestLimit,
      argv.currentPrice,
      investmentStableToken,
      investmentBaseToken,
      true
    )

    console.log(
      "==> Sending the order placing transaction to gnosis-safe interface.\n    Attention: This transaction MUST be executed first!"
    )
    let nonce = argv.nonce
    if (nonce === undefined) {
      nonce = (await masterSafe.nonce()).toNumber()
    }
    await signAndSend(masterSafe, orderTransaction, argv.network, nonce, argv.verify)

    console.log(
      "==> Sending the funds transferring transaction.\n    Attention: This transaction can only be executed after the one above!"
    )
    await signAndSend(masterSafe, bundledFundingTransaction, argv.network, nonce + 1, argv.verify)

    if (!argv.verify) {
      console.log(
        `To verify the transactions run the same script with --verify --nonce=${nonce} --brackets=${bracketAddresses.join()}`
      )
    }

    callback()
  } catch (error) {
    callback(error)
  }
}
