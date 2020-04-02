const { getOrdersPaginated } = require("../node_modules/@gnosis.pm/dex-contracts/src/onchain_reading")
const { isOnlySafeOwner, fetchTokenInfoAtAddresses } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { getMasterCopy } = require("./utils/internals")(web3, artifacts)
const { toErc20Units, fromErc20Units } = require("./utils/printing_tools")
const { allElementsOnlyOnce } = require("./utils/js_helpers")
const assert = require("assert")

const argv = require("yargs")
  .option("brackets", {
    type: "string",
    describe:
      "Trader account addresses for displaying their information, they can be obtained via the script find_bracket_traders",
    coerce: str => {
      return str.split(",")
    },
  })
  .option("masterSafe", {
    type: "string",
    describe: "The masterSafe in control of the bracket-traders",
    coerce: str => {
      return str.split(",")
    },
  })
  .demand(["brackets", "masterSafe"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

const getAllowances = async function(owner, tokenInfo) {
  const allowances = {}
  await Promise.all(
    Object.entries(tokenInfo).map(async ([tokenAddress, tokenData]) => {
      const token = (await tokenData).instance
      const eventList = await token.getPastEvents("Approval", { fromBlock: 0, toBlock: "latest", filter: { owner: [owner] } })
      const spenders = allElementsOnlyOnce(eventList.map(event => event.returnValues.spender))
      const tokenAllowances = {}
      // TODO: replace with web3 batch request if we need to reduce number of calls. This may require using web3 directly instead of Truffle contracts
      await Promise.all(
        spenders.map(async spender => {
          tokenAllowances[spender] = await token.allowance(owner, spender)
        })
      )
      allowances[tokenAddress] = tokenAllowances
    })
  )
  return allowances
}

const assertNoAllowances = async function(address, tokenInfo) {
  const allowances = await getAllowances(address, tokenInfo)
  for (const [tokenAddress, tokenAllowances] of Object.entries(allowances)) {
    for (const spender in tokenAllowances) {
      assert.equal(
        tokenAllowances[spender].toString(),
        "0",
        address +
          " allows address " +
          spender +
          " to spend " +
          (await tokenInfo[tokenAddress]).symbol +
          " (amount: " +
          fromErc20Units(tokenAllowances[spender], (await tokenInfo[tokenAddress]).decimals) +
          ")"
      )
    }
  }
}

module.exports = async callback => {
  try {
    const BatchExchangeArtifact = require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange")
    const networkId = await web3.eth.net.getId()
    const BatchExchange = new web3.eth.Contract(BatchExchangeArtifact.abi, BatchExchangeArtifact.networks[networkId].address)

    const auctionElementsDecoded = await getOrdersPaginated(BatchExchange, 100)
    const bracketTraderAddresses = argv.brackets.map(address => address.toLowerCase())

    // 1. verify that the owner of the brackets is the masterSafe
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert(await isOnlySafeOwner(argv.masterSafe, bracketTrader, artifacts))
      })
    )

    // 2. verify that all proxies of the brackets are pointing to the right gnosis-safe proxy:
    const GnosisSafe = artifacts.require("GnosisSafe")
    const gnosisSafe = await GnosisSafe.deployed()
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert(await getMasterCopy(bracketTrader), gnosisSafe.address)
      })
    )

    // 3. verify that each bracket has only two orders
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)
        assert(relevantOrders.length == 2)
      })
    )

    // 4. verify that each bracket can not loose tokens by consecutive selling and buying via the two orders
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)

        // Checks that selling an initial amount and then re-buying it with the second order is profitable.
        const initialAmount = toErc20Units(1, 18)
        const amountAfterSelling = initialAmount.mul(relevantOrders[0].priceNumerator).div(relevantOrders[0].priceDenominator)
        const amountAfterBuying = amountAfterSelling
          .mul(relevantOrders[1].priceNumerator)
          .div(relevantOrders[1].priceDenominator)
        assert.equal(amountAfterBuying.gt(initialAmount), true, "Brackets are not profitable")
        // If the last equation holds, the inverse trade must be profitable as well
      })
    )

    // TODO: extract addresses of traded tokens from previous checks
    const tradedTokenAddresses = []
    const tokenInfo = fetchTokenInfoAtAddresses(tradedTokenAddresses)
    // 5. verify that no allowances are currently set
    await assertNoAllowances(argv.masterSafe[0], tokenInfo)
    // TODO: test if following line can be parallelized with Infura
    for (const bracketTrader of bracketTraderAddresses) await assertNoAllowances(bracketTrader, tokenInfo)

    callback()
  } catch (error) {
    callback(error)
  }
}
