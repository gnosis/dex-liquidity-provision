const assert = require("assert")
const Contract = require("@truffle/contract")

const {
  deployFleetOfSafes,
  fetchTokenInfoFromExchange,
  buildTransferApproveDepositFromOrders,
  buildOrders,
  checkSufficiencyOfBalance,
  hasExistingOrders,
} = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { isPriceReasonable, areBoundsReasonable } = require("./utils/price_utils")(web3, artifacts)
const { signAndSend } = require("./utils/sign_and_send")(web3, artifacts)
const { proceedAnyways } = require("./utils/user_interface_helpers")
const { toErc20Units } = require("./utils/printing_tools")
const { sleep } = require("./utils/js_helpers")
const { verifyBracketsWellFormed } = require("./utils/verify_scripts")(web3, artifacts)
const { DEFAULT_NUM_SAFES } = require("./utils/constants")
const { default_yargs, checkBracketsForDuplicate } = require("./utils/default_yargs")

const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
    demandOption: true,
  })
  .option("numBrackets", {
    type: "int",
    default: DEFAULT_NUM_SAFES,
    describe: "Number of brackets to be deployed",
  })
  .option("brackets", {
    type: "string",
    describe: "Trader account addresses to place orders on behalf of",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("baseTokenId", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
    demandOption: true,
  })
  .option("depositBaseToken", {
    type: "string",
    describe: "Amount to be invested into the baseToken",
    demandOption: true,
  })
  .option("quoteTokenId", {
    type: "int",
    describe: "Trusted Quote Token for which to open orders (i.e. DAI)",
    demandOption: true,
  })
  .option("depositQuoteToken", {
    type: "string",
    describe: "Amount to be invested into the quoteToken",
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
  })
  .check(checkBracketsForDuplicate).argv

module.exports = async (callback) => {
  try {
    const signer = (await web3.eth.getAccounts())[0]
    console.log("Using account:", signer)
    // Init params
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    const exchange = await BatchExchange.deployed()

    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [argv.baseTokenId, argv.quoteTokenId])
    const baseTokenData = await tokenInfoPromises[argv.baseTokenId]
    const quoteTokenData = await tokenInfoPromises[argv.quoteTokenId]
    const { instance: baseToken, decimals: baseTokenDecimals } = baseTokenData
    const { instance: quoteToken, decimals: quoteTokenDecimals } = quoteTokenData

    const depositBaseToken = toErc20Units(argv.depositBaseToken, baseTokenDecimals)
    const depositQuoteToken = toErc20Units(argv.depositQuoteToken, quoteTokenDecimals)

    assert((await masterSafe.getOwners()).includes(signer), `Please ensure signer account ${signer} is an owner of masterSafe`)

    if (argv.brackets) {
      assert(argv.numBrackets === argv.brackets.length, "Please ensure numBrackets equals number of brackets")
    }

    console.log("==> Performing safety checks")
    if (!(await checkSufficiencyOfBalance(baseToken, masterSafe.address, depositBaseToken))) {
      callback(`Error: MasterSafe ${masterSafe.address} has insufficient balance for base token ${baseToken.address}`)
    }
    if (!(await checkSufficiencyOfBalance(quoteToken, masterSafe.address, depositQuoteToken))) {
      callback(`Error: MasterSafe ${masterSafe.address} has insufficient balance for quote token ${quoteToken.address}`)
    }
    // check price against dex.ag's API
    const priceCheck = await isPriceReasonable(baseTokenData, quoteTokenData, argv.currentPrice)
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
    if (argv.numBrackets > 23) {
      callback("Error: Choose a smaller numBrackets, otherwise your payload will be to big for Infura nodes")
    }

    let bracketAddresses
    if (argv.brackets) {
      console.log("==> Skipping safe deployment and using brackets safeOwners")
      bracketAddresses = argv.brackets
      await verifyBracketsWellFormed(masterSafe.address, bracketAddresses, null, null, true)
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
      console.log(`==> Deploying ${argv.numBrackets} trading brackets`)
      bracketAddresses = await deployFleetOfSafes(masterSafe.address, argv.numBrackets)
      console.log("List of deployed brackets:", bracketAddresses.join())
      // Sleeping for 3 seconds to make sure Infura nodes have processed
      // all newly deployed contracts so they can be awaited.
      await sleep(3000)
    }

    console.log("==> Building orders and deposits")
    const orderTransaction = await buildOrders(
      masterSafe.address,
      bracketAddresses,
      argv.baseTokenId,
      argv.quoteTokenId,
      argv.lowestLimit,
      argv.highestLimit,
      true
    )
    const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
      masterSafe.address,
      bracketAddresses,
      baseToken.address,
      quoteToken.address,
      argv.lowestLimit,
      argv.highestLimit,
      argv.currentPrice,
      depositQuoteToken,
      depositBaseToken,
      true
    )

    if (!argv.verify) {
      console.log(
        "==> Sending the order placing transaction to gnosis-safe interface.\n    Attention: This transaction MUST be executed first!"
      )
    } else {
      console.log("==> Order placing transaction")
    }
    let nonce = argv.nonce
    if (nonce === undefined) {
      nonce = (await masterSafe.nonce()).toNumber()
    }
    await signAndSend(masterSafe, orderTransaction, argv.network, nonce, argv.verify)

    if (!argv.verify) {
      console.log(
        "==> Sending the funds transferring transaction.\n    Attention: This transaction can only be executed after the one above!"
      )
    } else {
      console.log("==> Funds transferring transaction")
    }
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
